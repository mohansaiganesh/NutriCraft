import AsyncStorage from '@react-native-async-storage/async-storage';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db, deviceId } from '@/db/client';
import { dailyLogs, foodItems, mealItems, meals, settings } from '@/db/schema';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

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
 * Column names differ by store: local Drizzle keys are camelCase, Postgres columns
 * are snake_case (and `pricePer100` → `price_per_100` breaks naive converters), so
 * each table carries an explicit field map.
 */

const EPOCH = '1970-01-01T00:00:00.000Z';

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

/** Reset every cursor for a user (used on sign-out so the next login re-pulls fully). */
export async function resetSyncCursors(userId: string): Promise<void> {
  try {
    await AsyncStorage.multiRemove(TABLES.map((t) => cursorKey(userId, t.remote)));
  } catch {
    // ignore
  }
}

// --- row mapping --------------------------------------------------------------

function toRemote(t: SyncTable, local: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [localKey, remoteCol] of Object.entries(t.fields)) {
    out[remoteCol] = local[localKey];
  }
  return out;
}

function fromRemote(t: SyncTable, remote: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [localKey, remoteCol] of Object.entries(t.fields)) {
    out[localKey] = remote[remoteCol];
  }
  return out;
}

const maxIso = (a: string, b: string) => (a > b ? a : b);

// --- push / pull --------------------------------------------------------------

/** A Postgres integrity-constraint error (class 23, e.g. 23503 FK) is a per-row data
 * problem — isolating the bad row lets the rest push. Anything else (network, auth) is
 * not row-specific, so we don't bother retrying row-by-row. */
function isRowLevelError(error: any): boolean {
  return typeof error?.code === 'string' && error.code.startsWith('23');
}

async function pushTable(t: SyncTable, userId: string): Promise<string> {
  const cursor = await getCursor(userId, t.remote);
  // Only the user's own rows since the cursor. For food_items this naturally excludes
  // shared (user_id IS NULL) catalog rows — RLS would reject writing them anyway.
  const ownerCond = t.scoped ? eq(t.table.userId, userId) : eq(t.table.id, userId);
  const rows: Record<string, any>[] = await db
    .select()
    .from(t.table)
    .where(and(ownerCond, gt(t.table.updatedAt, cursor)));

  if (rows.length === 0) return cursor;

  // Fast path: one batch upsert for the whole table.
  const { error } = await supabase.from(t.remote).upsert(rows.map((r) => toRemote(t, r)));
  if (!error) {
    return rows.reduce((mx, r) => maxIso(mx, r.updatedAt as string), cursor);
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
    const { error: rowError } = await supabase.from(t.remote).upsert(toRemote(t, r));
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
  return succeeded.reduce(
    (mx, at) => (minFailed !== null && at >= minFailed ? mx : maxIso(mx, at)),
    cursor
  );
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

  let newCursor = cursor;
  for (const remoteRow of data) {
    const remoteUpdatedAt = remoteRow.updated_at as string;
    newCursor = maxIso(newCursor, remoteUpdatedAt);

    // Last-write-wins: skip if our local copy is the same age or newer.
    const localRows = await db
      .select({ updatedAt: t.table.updatedAt })
      .from(t.table)
      .where(eq(t.table.id, remoteRow.id));
    if (localRows.length && (localRows[0].updatedAt as string) >= remoteUpdatedAt) {
      continue;
    }

    const localRow = fromRemote(t, remoteRow);
    await db
      .insert(t.table)
      .values(localRow)
      .onConflictDoUpdate({ target: t.table.id, set: localRow });
  }
  return newCursor;
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
 * One-time claim of any pre-account local rows for the now-signed-in user, so data created
 * before this account existed carries in and syncs up. This is the upgrade path from the
 * old single-install era: private rows carry a NULL owner (before `user_id` existed) or, on
 * a device that once ran a pre-account build, a `deviceId` owner. Foods with a NULL owner
 * are the SHARED catalog and are intentionally left alone.
 */
export async function claimLocalData(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const stamp = { userId, updatedAt: now };
  // Defensive: `userId` is always a real account id now (login is required), but guard the
  // legacy shape where the device id was itself the owner so we don't self-claim.
  const isLegacyDeviceOwner = userId === deviceId;

  // Rows to adopt: NULL owner (pre-`user_id` private rows) and, for a real account,
  // deviceId-owned rows left by an older build. All updates are idempotent — after the
  // first claim there's nothing left to match.
  const unclaimed = (col: any) =>
    isLegacyDeviceOwner ? isNull(col) : or(isNull(col), eq(col, deviceId));
  await db.update(meals).set(stamp).where(unclaimed(meals.userId));
  await db.update(mealItems).set(stamp).where(unclaimed(mealItems.userId));
  await db.update(dailyLogs).set(stamp).where(unclaimed(dailyLogs.userId));

  // A NULL-owner food that is_custom is a PRIVATE food from a pre-account build — claim it
  // so it syncs (otherwise it's stranded: never pushed, not in the seed, and any meal_item /
  // daily_log referencing it FK-fails on push forever). NULL-owner CATALOG rows
  // (is_custom = false) are the shared seed and are intentionally left alone.
  await db
    .update(foodItems)
    .set(stamp)
    .where(and(isNull(foodItems.userId), eq(foodItems.isCustom, true)));
  if (!isLegacyDeviceOwner) {
    // Custom foods left by an older build were owned by deviceId.
    await db.update(foodItems).set(stamp).where(eq(foodItems.userId, deviceId));
  }

  // Carry prior settings to this account if it has none yet (legacy deviceId or 'app' row).
  const mine = await db.select({ id: settings.id }).from(settings).where(eq(settings.id, userId));
  if (mine.length === 0) {
    const prior = isLegacyDeviceOwner
      ? (await db.select().from(settings).where(eq(settings.id, 'app')))[0]
      : (await db.select().from(settings).where(eq(settings.id, deviceId)))[0] ??
        (await db.select().from(settings).where(eq(settings.id, 'app')))[0];
    if (prior) {
      const { id: _drop, ...vals } = prior as Record<string, any>;
      await db.insert(settings).values({ ...vals, id: userId, updatedAt: now });
    }
  }
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
