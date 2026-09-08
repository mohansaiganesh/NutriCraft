/**
 * Local tombstone purge — bounded, sync-safe hard-deletion of aged, already-synced soft-deleted
 * rows, so the on-device SQLite file stays tidy over years of logging. This is hygiene only: it
 * NEVER touches live rows or real history, and the server keeps its own tombstones (see the
 * "Server side" note in the plan / `lib/sync.ts`).
 *
 * Two independent safety layers gate every deletion:
 *   1. The pure predicate `isTombstonePurgeable` (`lib/syncCore.ts`): the row is `deleted`, its
 *      deletion has been PUSHED (`updatedAt <= pushCursor`, read from the same durable cursor the
 *      sync engine advances), and it is AGED past the retention window. Below the cursor a row can
 *      never be re-pulled, so it can't resurrect; a never-synced device purges nothing.
 *   2. Referential safety here (PRAGMA foreign_keys = ON): leaf tombstones (`daily_logs`,
 *      `meal_items`) are always FK-clear, but a `meals`/`food_items` tombstone is purged only when
 *      nothing physically references it. A soft-deleted-but-still-referenced food (the historical
 *      logs case) therefore stays — which is exactly what keeps past reports resolving.
 *
 * Children are purged before parents so a parent can become unreferenced within one pass.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { dailyLogs, foodItems, mealItems, meals } from '@/db/schema';
import { getCursor } from '@/lib/sync';
import { isTombstonePurgeable } from '@/lib/syncCore';

const DAY_MS = 24 * 60 * 60 * 1000;
/** SQLite caps bound-variable count per statement; chunk id lists well under it. */
const CHUNK = 500;

export interface PurgeResult {
  mealItems: number;
  dailyLogs: number;
  meals: number;
  foodItems: number;
}

export interface PurgeOptions {
  /** Grace window: tombstones younger than this are kept regardless of sync state. Default 30. */
  retentionDays?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

/** Any table we purge exposes `id`, `userId`, `deleted`, `updatedAt`. */
type PurgeTable = typeof dailyLogs | typeof mealItems | typeof meals | typeof foodItems;

/** Ids of this user's tombstones in `table` that pass the pure purge predicate. */
async function eligibleIds(
  table: PurgeTable,
  remote: string,
  userId: string,
  cutoffIso: string
): Promise<string[]> {
  const cursor = await getCursor(userId, remote);
  const rows = await db
    .select({ id: table.id, updatedAt: table.updatedAt })
    .from(table)
    .where(and(eq(table.deleted, true), eq(table.userId, userId)));
  return rows
    .filter((r) => isTombstonePurgeable({ deleted: true, updatedAt: r.updatedAt }, cursor, cutoffIso))
    .map((r) => r.id);
}

/** Hard-delete rows by id in chunks (bound-variable safety). Returns how many were deleted. */
async function deleteByIds(table: PurgeTable, ids: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    await db.delete(table).where(inArray(table.id, slice));
    n += slice.length;
  }
  return n;
}

/** Subset of `ids` still physically referenced by some `column` (deleted flag irrelevant to FKs). */
async function referencedBy(
  table: typeof mealItems | typeof dailyLogs,
  column: typeof mealItems.foodItemId | typeof mealItems.mealId | typeof dailyLogs.foodItemId,
  ids: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await db.select({ ref: column }).from(table).where(inArray(column, slice));
    for (const r of rows) if (r.ref) found.add(r.ref as string);
  }
  return found;
}

/**
 * Purge this user's eligible tombstones from local SQLite. Fire-and-forget from the session
 * (`lib/session.tsx`); each table is isolated in its own try/catch so one failure can't wedge the
 * rest (mirrors `syncNow`). Returns per-table deletion counts for logging.
 */
export async function purgeTombstones(userId: string, opts: PurgeOptions = {}): Promise<PurgeResult> {
  const retentionDays = opts.retentionDays ?? 30;
  const now = opts.now ?? new Date();
  const cutoffIso = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  const result: PurgeResult = { mealItems: 0, dailyLogs: 0, meals: 0, foodItems: 0 };

  // 1. meal_items — leaf, always FK-clear.
  try {
    result.mealItems = await deleteByIds(mealItems, await eligibleIds(mealItems, 'meal_items', userId, cutoffIso));
  } catch (e) {
    console.warn('[purge] meal_items skipped this run', e);
  }

  // 2. daily_logs — leaf, always FK-clear (the user's main volume table).
  try {
    result.dailyLogs = await deleteByIds(dailyLogs, await eligibleIds(dailyLogs, 'daily_logs', userId, cutoffIso));
  } catch (e) {
    console.warn('[purge] daily_logs skipped this run', e);
  }

  // 3. meals — only if no meal_item references it (a cascade delete would drop live children).
  try {
    const ids = await eligibleIds(meals, 'meals', userId, cutoffIso);
    const referenced = await referencedBy(mealItems, mealItems.mealId, ids);
    result.meals = await deleteByIds(meals, ids.filter((id) => !referenced.has(id)));
  } catch (e) {
    console.warn('[purge] meals skipped this run', e);
  }

  // 4. food_items — only if nothing references it (FK restrict). Deleted foods kept alive by
  // historical daily_logs correctly never qualify, so past reports keep resolving.
  try {
    const ids = await eligibleIds(foodItems, 'food_items', userId, cutoffIso);
    const referenced = new Set<string>([
      ...(await referencedBy(mealItems, mealItems.foodItemId, ids)),
      ...(await referencedBy(dailyLogs, dailyLogs.foodItemId, ids)),
    ]);
    result.foodItems = await deleteByIds(foodItems, ids.filter((id) => !referenced.has(id)));
  } catch (e) {
    console.warn('[purge] food_items skipped this run', e);
  }

  return result;
}

const LAST_RUN_KEY = (userId: string) => `purge:${userId}:lastRun`;
const PURGE_INTERVAL_MS = DAY_MS; // at most once per 24h

/**
 * Run `purgeTombstones` at most once per 24h per user, fire-and-forget. Safe to call on every
 * session `prepare` — safety comes from the durable push cursor, not from following a sync, so the
 * throttle is purely to avoid needless work. Swallows all errors (hygiene must never break startup).
 */
export async function purgeTombstonesThrottled(userId: string, opts: PurgeOptions = {}): Promise<void> {
  // Local require so the module stays importable in pure-Jest contexts that don't stub AsyncStorage.
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  try {
    const now = (opts.now ?? new Date()).getTime();
    const last = Number((await AsyncStorage.getItem(LAST_RUN_KEY(userId))) ?? 0);
    if (Number.isFinite(last) && now - last < PURGE_INTERVAL_MS) return;
    await AsyncStorage.setItem(LAST_RUN_KEY(userId), String(now));
    const result = await purgeTombstones(userId, opts);
    const total = result.mealItems + result.dailyLogs + result.meals + result.foodItems;
    if (total > 0) console.log('[purge] removed tombstones', result);
  } catch (e) {
    console.warn('[purge] throttled run skipped', e);
  }
}
