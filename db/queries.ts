import { and, asc, between, desc, eq, inArray, like, or, isNull } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { requireUserId } from '@/lib/currentUser';
import type { PerHundredBasis } from '@/lib/nutrition';
import type { RemoteFood } from '@/lib/foodSearch';
import type { MealType } from '@/constants/meals';
import { db } from './client';
import { assistantTraces, dailyLogs, foodItems, mealItems, meals, settings } from './schema';

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- Foods

export interface FoodInput {
  name: string;
  brand?: string;
  barcode?: string | null;
  servingSizeG?: number;
  basis: PerHundredBasis;
  isCustom?: boolean;
}

function basisColumns(basis: PerHundredBasis) {
  return {
    calories: basis.calories,
    proteinG: basis.proteinG,
    carbsG: basis.carbsG,
    fatG: basis.fatG,
    fiberG: basis.fiberG,
    sodiumMg: basis.sodiumMg,
    pricePer100: basis.pricePer100,
  };
}

export async function createFood(input: FoodInput): Promise<string> {
  const id = newId();
  await db.insert(foodItems).values({
    id,
    userId: requireUserId(), // private custom food owned by the current account
    name: input.name.trim(),
    brand: input.brand?.trim() || 'Generic',
    barcode: input.barcode?.trim() || null,
    servingSizeG: input.servingSizeG ?? 100,
    ...basisColumns(input.basis),
    isCustom: input.isCustom ?? true,
  });
  return id;
}

/**
 * Save a food found via an external source (Open Food Facts) as the current user's own
 * private food. Barcode is intentionally dropped: `food_items.barcode` is a GLOBAL unique,
 * so two accounts saving the same product would collide on sync — same reasoning as the
 * "Duplicate to my foods" path. The user can add price/adjust after it lands.
 */
export async function createFoodFromRemote(r: RemoteFood): Promise<string> {
  return createFood({
    name: r.name,
    brand: r.brand,
    barcode: null,
    servingSizeG: r.servingSizeG,
    basis: r.basis,
  });
}

export async function updateFood(id: string, input: FoodInput): Promise<void> {
  await db
    .update(foodItems)
    .set({
      name: input.name.trim(),
      brand: input.brand?.trim() || 'Generic',
      barcode: input.barcode?.trim() || null,
      servingSizeG: input.servingSizeG ?? 100,
      ...basisColumns(input.basis),
      updatedAt: now(),
    })
    .where(eq(foodItems.id, id));
}

export async function softDeleteFood(id: string): Promise<void> {
  await db
    .update(foodItems)
    .set({ deleted: true, updatedAt: now() })
    .where(eq(foodItems.id, id));
}

/**
 * Live-query builder: catalog list, optional name search.
 * Shows the shared/global catalog (`user_id IS NULL`, admin-curated, read-only) plus the
 * current user's own private foods.
 */
export function foodsQuery(search = '') {
  const term = search.trim().toLowerCase();
  const owned = or(isNull(foodItems.userId), eq(foodItems.userId, requireUserId()));
  const where = term
    ? and(eq(foodItems.deleted, false), owned, like(foodItems.name, `%${term}%`))
    : and(eq(foodItems.deleted, false), owned);
  return db
    .select()
    .from(foodItems)
    .where(where)
    .orderBy(asc(foodItems.name));
}

export async function getFood(id: string) {
  const rows = await db.select().from(foodItems).where(eq(foodItems.id, id));
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- Meals

export async function createMeal(name: string, notes?: string): Promise<string> {
  const id = newId();
  await db
    .insert(meals)
    .values({ id, userId: requireUserId(), name: name.trim(), notes: notes?.trim() || null });
  return id;
}

export async function updateMeal(
  id: string,
  patch: { name?: string; notes?: string }
): Promise<void> {
  await db
    .update(meals)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() || null } : {}),
      updatedAt: now(),
    })
    .where(eq(meals.id, id));
}

export async function softDeleteMeal(id: string): Promise<void> {
  const t = now();
  await db.update(meals).set({ deleted: true, updatedAt: t }).where(eq(meals.id, id));
  await db
    .update(mealItems)
    .set({ deleted: true, updatedAt: t })
    .where(eq(mealItems.mealId, id));
}

export async function addMealItem(
  mealId: string,
  foodItemId: string,
  grams: number
): Promise<string> {
  const id = newId();
  await db.insert(mealItems).values({ id, userId: requireUserId(), mealId, foodItemId, grams });
  return id;
}

export async function updateMealItemGrams(id: string, grams: number): Promise<void> {
  await db
    .update(mealItems)
    .set({ grams, updatedAt: now() })
    .where(eq(mealItems.id, id));
}

export async function removeMealItem(id: string): Promise<void> {
  await db
    .update(mealItems)
    .set({ deleted: true, updatedAt: now() })
    .where(eq(mealItems.id, id));
}

export function mealsQuery() {
  return db
    .select()
    .from(meals)
    .where(and(eq(meals.deleted, false), eq(meals.userId, requireUserId())))
    .orderBy(asc(meals.name));
}

/** A meal's line items joined to their food (for totals + editing).
 * Filters out deleted foods so a removed (or admin-deleted shared) food drops out of the meal. */
export function mealItemsQuery(mealId: string) {
  return db
    .select({ item: mealItems, food: foodItems })
    .from(mealItems)
    .innerJoin(foodItems, eq(mealItems.foodItemId, foodItems.id))
    .where(
      and(
        eq(mealItems.mealId, mealId),
        eq(mealItems.deleted, false),
        eq(foodItems.deleted, false)
      )
    )
    .orderBy(asc(foodItems.name));
}

/** All meal line items (any meal) joined to their food — for list-level totals.
 * Deleted foods are excluded so they no longer count toward any meal's totals. */
export function allMealItemsQuery() {
  return db
    .select({ item: mealItems, food: foodItems })
    .from(mealItems)
    .innerJoin(foodItems, eq(mealItems.foodItemId, foodItems.id))
    .where(
      and(
        eq(mealItems.deleted, false),
        eq(foodItems.deleted, false),
        eq(mealItems.userId, requireUserId())
      )
    );
}

export async function getMeal(id: string) {
  const rows = await db.select().from(meals).where(eq(meals.id, id));
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- Daily logs

export async function addLog(
  loggedDate: string,
  mealType: MealType,
  foodItemId: string,
  grams: number
): Promise<string> {
  const id = newId();
  await db
    .insert(dailyLogs)
    .values({ id, userId: requireUserId(), loggedDate, mealType, foodItemId, grams });
  return id;
}

// Both scope the write to the current user (not id alone) so a caller acting on an externally
// supplied id — the assistant's edit/remove tools — can never touch another account's log even if
// the account switches between resolving the entry and running the mutation.
export async function updateLog(
  id: string,
  patch: { grams?: number; mealType?: MealType }
): Promise<void> {
  await db
    .update(dailyLogs)
    .set({ ...patch, updatedAt: now() })
    .where(and(eq(dailyLogs.id, id), eq(dailyLogs.userId, requireUserId())));
}

export async function removeLog(id: string): Promise<void> {
  await db
    .update(dailyLogs)
    .set({ deleted: true, updatedAt: now() })
    .where(and(eq(dailyLogs.id, id), eq(dailyLogs.userId, requireUserId())));
}

/**
 * One log entry (joined to its food), scoped to the current user — the ownership guard for the
 * assistant's edit/remove write tools. `updateLog`/`removeLog` scope only by `id`, so callers that
 * act on a caller-supplied id (the assistant) must resolve it through THIS first and refuse a miss.
 */
export async function getLogEntry(id: string) {
  const rows = await db
    .select({ log: dailyLogs, food: foodItems })
    .from(dailyLogs)
    .innerJoin(foodItems, eq(dailyLogs.foodItemId, foodItems.id))
    .where(
      and(
        eq(dailyLogs.id, id),
        eq(dailyLogs.deleted, false),
        eq(dailyLogs.userId, requireUserId())
      )
    );
  return rows[0] ?? null;
}

/** Expand a meal template into individual log entries for a given day/meal. */
export async function applyMealToDay(
  mealId: string,
  loggedDate: string,
  mealType: MealType
): Promise<number> {
  const items = await db
    .select()
    .from(mealItems)
    .where(
      and(
        eq(mealItems.mealId, mealId),
        eq(mealItems.deleted, false),
        eq(mealItems.userId, requireUserId())
      )
    );
  for (const it of items) {
    await addLog(loggedDate, mealType, it.foodItemId, it.grams);
  }
  return items.length;
}

/** All log entries for a day, joined to their food.
 * Intentionally does NOT filter `foodItems.deleted`: a log is a historical fact and must keep
 * resolving its food (and computing nutrition) even after that food is deleted, so past days and
 * future reports stay correct. This is the deliberate counterpart to `mealItemsQuery`, which does
 * drop deleted foods. */
export function dayLogsQuery(loggedDate: string) {
  return db
    .select({ log: dailyLogs, food: foodItems })
    .from(dailyLogs)
    .innerJoin(foodItems, eq(dailyLogs.foodItemId, foodItems.id))
    .where(
      and(
        eq(dailyLogs.loggedDate, loggedDate),
        eq(dailyLogs.deleted, false),
        eq(dailyLogs.userId, requireUserId())
      )
    )
    .orderBy(desc(dailyLogs.createdAt));
}

/** All log entries within an inclusive date range, joined to their food — the backbone of the
 * Reports dashboard. Like `dayLogsQuery`, it deliberately does NOT filter `foodItems.deleted`: a
 * log is a historical fact and must keep resolving its food (and computing nutrition) even after
 * that food is deleted, so past periods stay correct. Dates are 'YYYY-MM-DD' strings, so the range
 * is a plain lexical `between`. Ordered ascending by day for series/chart building. */
export function logsInRangeQuery(startISO: string, endISO: string) {
  return db
    .select({ log: dailyLogs, food: foodItems })
    .from(dailyLogs)
    .innerJoin(foodItems, eq(dailyLogs.foodItemId, foodItems.id))
    .where(
      and(
        between(dailyLogs.loggedDate, startISO, endISO),
        eq(dailyLogs.deleted, false),
        eq(dailyLogs.userId, requireUserId())
      )
    )
    .orderBy(asc(dailyLogs.loggedDate));
}

// ---------------------------------------------------------------- Settings

// The auto-created default settings row is stamped with the epoch so it loses every
// last-write-wins comparison and is NOT pushed by sync (cursor starts at epoch, and
// `updatedAt > cursor` is false). This prevents a fresh/offline device's defaults from
// clobbering the account's real cloud settings. The moment the user saves targets,
// `updateSettings` bumps `updatedAt` to now and it syncs normally.
const SETTINGS_EPOCH = '1970-01-01T00:00:00.000Z';

/** Create the current user's settings row (id = userId) if it doesn't exist yet. */
export async function ensureSettings() {
  const uid = requireUserId();
  const rows = await db.select().from(settings).where(eq(settings.id, uid));
  if (rows.length === 0) {
    await db.insert(settings).values({ id: uid, updatedAt: SETTINGS_EPOCH });
    const created = await db.select().from(settings).where(eq(settings.id, uid));
    return created[0];
  }
  return rows[0];
}

export function settingsQuery() {
  return db.select().from(settings).where(eq(settings.id, requireUserId()));
}

export async function updateSettings(
  patch: Partial<{
    targetCalories: number;
    targetProteinG: number;
    targetCarbsG: number;
    targetFatG: number;
    targetFiberG: number;
    targetSodiumMg: number;
    currency: string;
    displayName: string | null;
    age: number | null;
    country: string | null;
    phone: string | null;
  }>
): Promise<void> {
  await db
    .update(settings)
    .set({ ...patch, updatedAt: now() })
    .where(eq(settings.id, requireUserId()));
}

/**
 * Hard-delete every local row belonging to a user — used only by the account-deletion flow
 * AFTER the server-side auth user is gone. The soft-delete rule is deliberately skipped here:
 * the account no longer exists, so there's nothing left to sync a tombstone to, and leaving
 * scoped rows behind would surface stale data if a different account signs in on this device.
 * The shared catalog (`user_id IS NULL`) is left untouched — it belongs to no user.
 */
export async function wipeLocalUserData(uid: string): Promise<void> {
  // FK-safe order: leaf rows (logs, meal items) before their parents (meals, foods).
  await db.delete(dailyLogs).where(eq(dailyLogs.userId, uid));
  await db.delete(mealItems).where(eq(mealItems.userId, uid));
  await db.delete(meals).where(eq(meals.userId, uid));
  await db.delete(foodItems).where(eq(foodItems.userId, uid));
  await db.delete(assistantTraces).where(eq(assistantTraces.userId, uid));
  await db.delete(settings).where(eq(settings.id, uid));
}

// ---------------------------------------------------------------- Assistant traces

/** How many traces to keep per user. Older ones are soft-deleted on each save (so the pruning
 * propagates through sync) — this is a diagnostics log, not permanent history. */
export const TRACE_RETENTION = 100;

export interface TraceInput {
  question: string;
  answer: string;
  status: 'ok' | 'error' | 'stopped_early';
  errorKind?: string | null;
  stopReason?: string | null;
  model: string;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  startedAt: string;
  steps: string; // pre-serialized JSON (TraceStep[])
}

/**
 * Persist one completed assistant request, then prune: soft-delete any of this user's traces beyond
 * the newest TRACE_RETENTION. Pruning is a soft-delete (not a DELETE) so the removal syncs like every
 * other tombstone. Intended to be called from a try/catch — a failure here must never break the chat.
 */
export async function saveTrace(input: TraceInput): Promise<void> {
  const uid = requireUserId();
  await db.insert(assistantTraces).values({
    id: newId(),
    userId: uid,
    question: input.question,
    answer: input.answer,
    status: input.status,
    errorKind: input.errorKind ?? null,
    stopReason: input.stopReason ?? null,
    model: input.model,
    llmCalls: input.llmCalls,
    toolCalls: input.toolCalls,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedTokens: input.cachedTokens,
    durationMs: input.durationMs,
    startedAt: input.startedAt,
    steps: input.steps,
  });

  // Find rows beyond the newest N and tombstone them (SQLite needs a LIMIT alongside OFFSET).
  const stale = await db
    .select({ id: assistantTraces.id })
    .from(assistantTraces)
    .where(and(eq(assistantTraces.deleted, false), eq(assistantTraces.userId, uid)))
    .orderBy(desc(assistantTraces.createdAt))
    .limit(1_000_000)
    .offset(TRACE_RETENTION);
  if (stale.length > 0) {
    await db
      .update(assistantTraces)
      .set({ deleted: true, updatedAt: now() })
      .where(inArray(assistantTraces.id, stale.map((r) => r.id)));
  }
}

/** Live-query builder for the history list — summary columns only (the `steps` blob is omitted so the
 * list stays light); newest first, scoped to the current user. */
export function tracesQuery() {
  return db
    .select({
      id: assistantTraces.id,
      question: assistantTraces.question,
      status: assistantTraces.status,
      model: assistantTraces.model,
      llmCalls: assistantTraces.llmCalls,
      toolCalls: assistantTraces.toolCalls,
      inputTokens: assistantTraces.inputTokens,
      outputTokens: assistantTraces.outputTokens,
      cachedTokens: assistantTraces.cachedTokens,
      durationMs: assistantTraces.durationMs,
      startedAt: assistantTraces.startedAt,
      createdAt: assistantTraces.createdAt,
    })
    .from(assistantTraces)
    .where(and(eq(assistantTraces.deleted, false), eq(assistantTraces.userId, requireUserId())))
    .orderBy(desc(assistantTraces.createdAt));
}

/** One trace (full row, including the `steps` JSON), scoped to the current user. */
export async function getTrace(id: string) {
  const rows = await db
    .select()
    .from(assistantTraces)
    .where(and(eq(assistantTraces.id, id), eq(assistantTraces.userId, requireUserId())))
    .limit(1);
  return rows[0] ?? null;
}

/** Soft-delete all of the current user's traces (the viewer's "Clear history"). */
export async function clearTraces(): Promise<void> {
  await db
    .update(assistantTraces)
    .set({ deleted: true, updatedAt: now() })
    .where(and(eq(assistantTraces.deleted, false), eq(assistantTraces.userId, requireUserId())));
}

/** Soft-delete one trace (scoped to the current user) — powers the per-row delete in the history list. */
export async function deleteTrace(id: string): Promise<void> {
  await db
    .update(assistantTraces)
    .set({ deleted: true, updatedAt: now() })
    .where(and(eq(assistantTraces.id, id), eq(assistantTraces.userId, requireUserId())));
}
