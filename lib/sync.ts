import AsyncStorage from '@react-native-async-storage/async-storage';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { dailyLogs, foodItems, mealItems, meals, settings } from '@/db/schema';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  EPOCH,
  advanceCursorAll,
  advanceCursorPartial,
  fromRemote as mapFromRemote,
  isRowLevelError,
  shouldApplyRemote,
  toRemote as mapToRemote,
} from '@/lib/syncCore';

/**
 * Delta-sync engine (local-first, last-write-wins).
 *
 * Local SQLite stays the source of truth for the UI; this module pushes the current
 * user's local changes up to Supabase and pulls remote changes down, both bounded by
 * a per-table cursor (the max `updated_at` seen so far). `updated_at` is always
 * client-generated (see `db/queries.ts`), so it's a consistent LWW clock across
 * devices and immune to server-clock skew. Rows are never hard-deleted — the
 * `deleted` flag propagates like any other column.
 *
 * Known limitation (accepted tradeoff): resolution is per-row last-write-wins by
 * `updatedAt`. If the SAME row is edited offline on two devices, the edit with the later
 * `updatedAt` wins and the other is silently discarded — there is no field-level merge.
 * For a single-user personal tracker this is fine; a future multi-editor scenario would
 * need CRDT/merge semantics instead.
 *
 * The pure decision logic (row mapping, cursor-advance math, the LWW rule, row-level error
 * classification) lives in `@/lib/syncCore` so it can be unit-tested without RN/network
 * (see `__tests__/sync.test.ts`); this module wires it to the real DB and Supabase.
 *
 * Column names differ by store: local Drizzle keys are camelCase, Postgres columns
 * are snake_case (and `pricePer100` → `price_per_100` breaks naive converters), so
 * each table carries an explicit field map.
 */

interface SyncTable {
  /** Supabase (Postgres) table name. */
  remote: string;
  /** Drizzle table object. */
  table: any;
  /** localKey -> remoteColumn. */
  fields: Record<string, string>;
  /**
   * true  → row has a `user_id` column; push filters `user_id = me`.
   * false → `settings`, whose PK `id` IS the userId; push filters `id = me`.
   */
  scoped: boolean;
}

const AUDIT = { createdAt: 'created_at', updatedAt: 'updated_at', deleted: 'deleted' };

const TABLES: SyncTable[] = [
  {
    remote: 'food_items',
    table: foodItems,
    scoped: true,
    fields: {
      id: 'id',
      userId: 'user_id',
      name: 'name',
      brand: 'brand',
      barcode: 'barcode',
      servingSizeG: 'serving_size_g',
      calories: 'calories',
      proteinG: 'protein_g',
      carbsG: 'carbs_g',
      fatG: 'fat_g',
      fiberG: 'fiber_g',
      sodiumMg: 'sodium_mg',
      pricePer100: 'price_per_100',
      isCustom: 'is_custom',
      ...AUDIT,
    },
  },
  {
    remote: 'meals',
    table: meals,
    scoped: true,
    fields: { id: 'id', userId: 'user_id', name: 'name', notes: 'notes', ...AUDIT },
  },
  {
    remote: 'meal_items',
    table: mealItems,
    scoped: true,
    fields: {
      id: 'id',
      userId: 'user_id',
      mealId: 'meal_id',
      foodItemId: 'food_item_id',
      grams: 'grams',
      ...AUDIT,
    },
  },
  {
    remote: 'daily_logs',
    table: dailyLogs,
    scoped: true,
    fields: {
      id: 'id',
      userId: 'user_id',
      loggedDate: 'logged_date',
      mealType: 'meal_type',
      foodItemId: 'food_item_id',
      grams: 'grams',
      ...AUDIT,
    },
  },
  {
    remote: 'settings',
    table: settings,
    scoped: false,
    fields: {
      id: 'id',
      targetCalories: 'target_calories',
      targetProteinG: 'target_protein_g',
      targetCarbsG: 'target_carbs_g',
      targetFatG: 'target_fat_g',
      targetFiberG: 'target_fiber_g',
      targetSodiumMg: 'target_sodium_mg',
      currency: 'currency',
      tdee: 'tdee',
      updatedAt: 'updated_at',
    },
  },
];

// Lookup from remote table name -> its SyncTable (for parent backfill on pull).
const byRemote: Record<string, SyncTable> = Object.fromEntries(TABLES.map((t) => [t.remote, t]));

/**
 * Foreign keys a pulled child row must satisfy locally (`PRAGMA foreign_keys = ON`). Keyed by the
 * child's remote table; each entry is a remote FK column -> the parent table it references. Used to
 * backfill a missing parent by id when a child insert fails, closing the referential gap that opens
 * when the child's pull cursor runs ahead of its parent's (foods/meals have no FKs of their own, so
 * one level is enough).
 */
const FK_PARENTS: Record<string, { col: string; parent: string }[]> = {
  meal_items: [
    { col: 'meal_id', parent: 'meals' },
    { col: 'food_item_id', parent: 'food_items' },
  ],
  daily_logs: [{ col: 'food_item_id', parent: 'food_items' }],
};

// --- cursor persistence -------------------------------------------------------

const cursorKey = (userId: string, remote: string) => `sync:${userId}:${remote}`;

async function getCursor(userId: string, remote: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(cursorKey(userId, remote))) ?? EPOCH;
  } catch {
    return EPOCH;
  }
}

async function setCursor(userId: string, remote: string, iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(cursorKey(userId, remote), iso);
  } catch {
    // Non-fatal: a lost cursor just means a wider (still-correct) delta next time.
  }
}

// --- push / pull --------------------------------------------------------------
// Row mapping, cursor-advance math, LWW decision, and row-level error classification are
// pure and live in `@/lib/syncCore` (unit-tested in `__tests__/sync.test.ts`).

async function pushTable(t: SyncTable, userId: string): Promise<string> {
  const cursor = await getCursor(userId, t.remote);
  // Only the user's own rows since the cursor. For food_items this naturally excludes shared
  // (user_id IS NULL) catalog rows — those are admin-curated server-side and RLS rejects client
  // writes to them anyway.
  const ownerCond = t.scoped ? eq(t.table.userId, userId) : eq(t.table.id, userId);
  const rows: Record<string, any>[] = await db
    .select()
    .from(t.table)
    .where(and(ownerCond, gt(t.table.updatedAt, cursor)));

  if (rows.length === 0) return cursor;

  // Fast path: one batch upsert for the whole table.
  const { error } = await supabase.from(t.remote).upsert(rows.map((r) => mapToRemote(t.fields, r)));
  if (!error) {
    return advanceCursorAll(cursor, rows.map((r) => r.updatedAt as string));
  }
  // A non-row-level failure (offline, auth) isn't one bad row — let syncNow log it once
  // and leave the cursor so the whole batch retries next cycle.
  if (!isRowLevelError(error)) throw error;

  // Slow path: a constraint violation (e.g. a meal_item referencing a food not on the
  // server). Retry row-by-row so only the genuinely orphaned rows fail and everything
  // else in this table — and every later table — still syncs.
  let minFailed: string | null = null;
  const succeeded: string[] = [];
  for (const r of rows) {
    const { error: rowError } = await supabase.from(t.remote).upsert(mapToRemote(t.fields, r));
    const at = r.updatedAt as string;
    if (rowError) {
      if (minFailed === null || at < minFailed) minFailed = at;
      console.warn(`[sync] push ${t.remote} row ${r.id} failed; will retry next cycle`, rowError);
    } else {
      succeeded.push(at);
    }
  }
  // Advance the cursor only past rows that succeeded AND precede the earliest failure, so
  // every failed row stays > cursor and is re-selected (and retried) next cycle.
  return advanceCursorPartial(cursor, succeeded, minFailed);
}

/**
 * A pulled child row (meal_item / daily_log) failed its local FK because a referenced parent isn't
 * present locally yet — the child's pull cursor ran ahead of the parent's, so the parent fell outside
 * this cycle's parent-table window. Fetch each missing parent directly by id (no cursor filter) and
 * insert it, so the child can be retried. Returns true if any parent was newly fetched. A parent the
 * server doesn't return (soft-deleted rows still come back; a truly-missing/inaccessible one does not)
 * is a genuine dangling reference — logged and left for the caller to skip.
 */
async function backfillParents(t: SyncTable, remoteRow: Record<string, any>): Promise<boolean> {
  const refs = FK_PARENTS[t.remote];
  if (!refs) return false;
  let fetchedAny = false;
  for (const { col, parent } of refs) {
    const parentId = remoteRow[col];
    if (!parentId) continue;
    const pt = byRemote[parent];
    const localParent = await db.select({ id: pt.table.id }).from(pt.table).where(eq(pt.table.id, parentId));
    if (localParent.length) continue; // parent already present locally — not the missing one

    const { data, error } = await supabase.from(parent).select('*').eq('id', parentId).limit(1);
    if (error || !data || data.length === 0) {
      console.warn(
        `[sync] pull ${t.remote} row ${remoteRow.id}: parent ${parent} ${parentId} not found on server (deleted or inaccessible)`
      );
      continue;
    }
    const parentRow = mapFromRemote(pt.fields, data[0]);
    await db.insert(pt.table).values(parentRow).onConflictDoUpdate({ target: pt.table.id, set: parentRow });
    fetchedAny = true;
  }
  return fetchedAny;
}

async function pullTable(t: SyncTable, userId: string): Promise<string> {
  const cursor = await getCursor(userId, t.remote);
  let query = supabase.from(t.remote).select('*').gt('updated_at', cursor);
  // settings is keyed by id = userId (no user_id column); RLS also enforces this,
  // but scoping the query keeps payloads minimal.
  if (!t.scoped) query = query.eq('id', userId);

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return cursor;

  // Row-resilient apply, mirroring pushTable's slow path: a single row that can't be written
  // locally (e.g. a meal_item whose parent meal/food hasn't arrived yet → FOREIGN KEY failure)
  // must NOT abort the whole table's pull. If it did, the cursor would never advance and the
  // exact same batch would re-pull and re-throw every cycle, permanently wedging the table and
  // blocking every newer row. Instead we skip the bad row, keep the cursor pinned just below it
  // (so it's re-selected and retried next cycle, once its parent lands), and apply everything else.
  const succeeded: string[] = [];
  let minFailed: string | null = null;
  for (const remoteRow of data) {
    const remoteUpdatedAt = remoteRow.updated_at as string;

    // Last-write-wins: skip if our local copy is the same age or newer. Nothing to write, so it's
    // safe to advance the cursor past this row.
    const localRows = await db
      .select({ updatedAt: t.table.updatedAt })
      .from(t.table)
      .where(eq(t.table.id, remoteRow.id));
    const localUpdatedAt = localRows.length ? (localRows[0].updatedAt as string) : undefined;
    if (!shouldApplyRemote(localUpdatedAt, remoteUpdatedAt)) {
      succeeded.push(remoteUpdatedAt);
      continue;
    }

    const localRow = mapFromRemote(t.fields, remoteRow);
    try {
      await db
        .insert(t.table)
        .values(localRow)
        .onConflictDoUpdate({ target: t.table.id, set: localRow });
      succeeded.push(remoteUpdatedAt);
    } catch (rowError) {
      // Most likely a missing FK parent (the child's cursor ran ahead of its parent's). Fetch the
      // referenced parent(s) by id and retry once before giving up on this row.
      let recovered = false;
      try {
        if (await backfillParents(t, remoteRow)) {
          await db
            .insert(t.table)
            .values(localRow)
            .onConflictDoUpdate({ target: t.table.id, set: localRow });
          recovered = true;
        }
      } catch {
        // Retry still failed (e.g. a second, genuinely-missing parent) — fall through to skip.
      }
      if (recovered) {
        succeeded.push(remoteUpdatedAt);
      } else {
        if (minFailed === null || remoteUpdatedAt < minFailed) minFailed = remoteUpdatedAt;
        console.warn(
          `[sync] pull ${t.remote} row ${remoteRow.id} skipped (unresolved FK parent), will retry next cycle`,
          rowError
        );
      }
    }
  }
  // Advance only past rows that succeeded AND precede the earliest failure, so every failed row
  // stays > cursor and is re-selected (and retried) next cycle.
  return advanceCursorPartial(cursor, succeeded, minFailed);
}

// --- public API ---------------------------------------------------------------

let inFlight: Promise<void> | null = null;
let inFlightUser: string | null = null;

/**
 * Run one full sync cycle for the given user: push local changes, then pull remote
 * ones, advancing each table's cursor. Coalesces concurrent calls FOR THE SAME USER.
 * Silently no-ops when Supabase isn't configured. Network failures reject — callers may
 * ignore (offline just defers to the next trigger).
 */
export function syncNow(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  // Only coalesce onto an in-flight cycle if it's for the SAME user. After an account
  // switch, user B must not receive user A's still-running promise.
  if (inFlight && inFlightUser === userId) return inFlight;

  inFlightUser = userId;
  inFlight = (async () => {
    for (const t of TABLES) {
      // Push then pull, per table, so a just-pushed row's cursor advances before pull.
      // One table failing (a network blip, or an unexpected error) must not stop the
      // others — settings/daily_logs shouldn't be held hostage by a meal_items problem.
      try {
        const afterPush = await pushTable(t, userId);
        await setCursor(userId, t.remote, afterPush);
        const afterPull = await pullTable(t, userId);
        await setCursor(userId, t.remote, afterPull);
      } catch (e) {
        console.warn(`[sync] table ${t.remote} did not fully sync this cycle`, e);
      }
    }
  })();

  const started = inFlight;
  started.finally(() => {
    // Only clear if no newer cycle (e.g. a different user's) has replaced this one.
    if (inFlight === started) {
      inFlight = null;
      inFlightUser = null;
    }
  });
  return started;
}

/** Fire-and-forget sync that swallows errors (offline / transient) — for post-write nudges. */
export function syncInBackground(userId: string): void {
  syncNow(userId).catch(() => {
    // offline or transient — the next foreground/login trigger will catch up
  });
}

let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced push after local writes. Wired to the SQLite change listener so any
 * mutation eventually syncs without threading a call through every query. Upserts made
 * by an in-progress pull are harmless here: their cursor is already advanced, so the
 * follow-up cycle finds nothing to push.
 */
export function nudgeSync(userId: string | null, delayMs = 1500): void {
  if (!userId || !isSupabaseConfigured) return;
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    syncInBackground(userId);
  }, delayMs);
}

/**
 * Cancel any debounced push waiting to fire. Called on sign-out so a queued nudge for the
 * signing-out user can't run against the torn-down (or a subsequently different) session.
 * Cursors are left untouched — a re-login resumes an incremental sync.
 */
export function cancelPendingSync(): void {
  if (nudgeTimer) {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
  }
}

/**
 * First-login claim of any pre-account local rows for the now-signed-in user, so private
 * data created before `user_id` existed carries in and syncs up. Such rows carry a NULL
 * owner; this stamps them with the account id. Idempotent — after the first claim there's
 * nothing left to match. NULL-owner CATALOG foods (is_custom = false) are the admin-curated
 * SHARED catalog and are intentionally left alone.
 */
export async function claimLocalData(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const stamp = { userId, updatedAt: now };

  await db.update(meals).set(stamp).where(isNull(meals.userId));
  await db.update(mealItems).set(stamp).where(isNull(mealItems.userId));
  await db.update(dailyLogs).set(stamp).where(isNull(dailyLogs.userId));

  // A NULL-owner food that is_custom is a PRIVATE food from a pre-account build — claim it so it
  // syncs. NULL-owner CATALOG rows (is_custom = false) are the shared admin catalog: they arrive
  // via the pull and stay unclaimed/read-only, so they are intentionally left alone.
  await db
    .update(foodItems)
    .set(stamp)
    .where(and(isNull(foodItems.userId), eq(foodItems.isCustom, true)));
}

/**
 * Subscribe to realtime changes on the user's rows and pull when they arrive, for
 * near-instant cross-device updates. Best-effort: requires Realtime replication to be
 * enabled on the tables in Supabase. Returns an unsubscribe function.
 */
export function subscribeRealtime(userId: string): () => void {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase
    .channel(`sync:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      syncInBackground(userId);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
