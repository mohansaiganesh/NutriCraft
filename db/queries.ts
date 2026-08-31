import { and, asc, desc, eq, like } from 'drizzle-orm';
import { newId } from '@/lib/id';
import type { PerHundredBasis } from '@/lib/nutrition';
import type { MealType } from '@/constants/meals';
import { db } from './client';
import { dailyLogs, foodItems, mealItems, meals, settings } from './schema';

const now = () => new Date().toISOString();
const SETTINGS_ID = 'app';

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
    name: input.name.trim(),
    brand: input.brand?.trim() || 'Generic',
    barcode: input.barcode?.trim() || null,
    servingSizeG: input.servingSizeG ?? 100,
    ...basisColumns(input.basis),
    isCustom: input.isCustom ?? true,
  });
  return id;
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

/** Live-query builder: catalog list, optional name search. */
export function foodsQuery(search = '') {
  const term = search.trim().toLowerCase();
  const where = term
    ? and(eq(foodItems.deleted, false), like(foodItems.name, `%${term}%`))
    : eq(foodItems.deleted, false);
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
  await db.insert(meals).values({ id, name: name.trim(), notes: notes?.trim() || null });
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
  await db.insert(mealItems).values({ id, mealId, foodItemId, grams });
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
    .where(eq(meals.deleted, false))
    .orderBy(asc(meals.name));
}

/** A meal's line items joined to their food (for totals + editing). */
export function mealItemsQuery(mealId: string) {
  return db
    .select({ item: mealItems, food: foodItems })
    .from(mealItems)
    .innerJoin(foodItems, eq(mealItems.foodItemId, foodItems.id))
    .where(and(eq(mealItems.mealId, mealId), eq(mealItems.deleted, false)))
    .orderBy(asc(foodItems.name));
}

/** All meal line items (any meal) joined to their food — for list-level totals. */
export function allMealItemsQuery() {
  return db
    .select({ item: mealItems, food: foodItems })
    .from(mealItems)
    .innerJoin(foodItems, eq(mealItems.foodItemId, foodItems.id))
    .where(eq(mealItems.deleted, false));
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
  await db.insert(dailyLogs).values({ id, loggedDate, mealType, foodItemId, grams });
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

/** All log entries for a day, joined to their food. */
export function dayLogsQuery(loggedDate: string) {
  return db
    .select({ log: dailyLogs, food: foodItems })
    .from(dailyLogs)
    .innerJoin(foodItems, eq(dailyLogs.foodItemId, foodItems.id))
    .where(and(eq(dailyLogs.loggedDate, loggedDate), eq(dailyLogs.deleted, false)))
    .orderBy(desc(dailyLogs.createdAt));
}

// ---------------------------------------------------------------- Settings

export async function ensureSettings() {
  const rows = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID));
  if (rows.length === 0) {
    await db.insert(settings).values({ id: SETTINGS_ID });
    const created = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID));
    return created[0];
  }
  return rows[0];
}

export function settingsQuery() {
  return db.select().from(settings).where(eq(settings.id, SETTINGS_ID));
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
    .where(eq(settings.id, SETTINGS_ID));
}
