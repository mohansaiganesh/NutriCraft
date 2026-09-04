import { and, asc, desc, eq, like, or, isNull } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { requireUserId } from '@/lib/currentUser';
import type { PerHundredBasis } from '@/lib/nutrition';
import type { RemoteFood } from '@/lib/foodSearch';
import type { MealType } from '@/constants/meals';
import { db } from './client';
import { dailyLogs, foodItems, mealItems, meals, settings } from './schema';

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

export async function updateLog(
  id: string,
  patch: { grams?: number; mealType?: MealType }
): Promise<void> {
  await db
    .update(dailyLogs)
    .set({ ...patch, updatedAt: now() })
    .where(eq(dailyLogs.id, id));
}

export async function removeLog(id: string): Promise<void> {
  await db
    .update(dailyLogs)
    .set({ deleted: true, updatedAt: now() })
    .where(eq(dailyLogs.id, id));
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
    .where(and(eq(mealItems.mealId, mealId), eq(mealItems.deleted, false)));
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
  }>
): Promise<void> {
  await db
    .update(settings)
    .set({ ...patch, updatedAt: now() })
    .where(eq(settings.id, requireUserId()));
}
