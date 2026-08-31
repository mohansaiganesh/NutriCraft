import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Schema is defined ONCE here so the same table shapes can target Postgres later
 * for cloud sync. Portability rules baked in from day one:
 *   - UUID text primary keys (no cross-device collisions)
 *   - UTC ISO-8601 timestamp strings
 *   - `updated_at` + `deleted` soft-delete flag on every row (sync reconciliation)
 *
 * All nutrition/price values are stored on a PER-100 (g or ml) BASIS. Actual amounts
 * are computed on demand from grams.
 */

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Columns shared by every syncable table. */
const auditColumns = {
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
};

/** GLOBAL FOOD ITEMS CATALOG — the food catalog. */
export const foodItems = sqliteTable('food_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').notNull().default('Generic'),
  barcode: text('barcode').unique(),
  servingSizeG: real('serving_size_g').notNull().default(100),
  // per-100 basis
  calories: real('calories').notNull().default(0),
  proteinG: real('protein_g').notNull().default(0),
  carbsG: real('carbs_g').notNull().default(0),
  fatG: real('fat_g').notNull().default(0),
  fiberG: real('fiber_g').notNull().default(0),
  sodiumMg: real('sodium_mg').notNull().default(0),
  pricePer100: real('price_per_100').notNull().default(0),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(true),
  ...auditColumns,
});

/** Reusable meal templates. */
export const meals = sqliteTable('meals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  notes: text('notes'),
  ...auditColumns,
});

/** Lines within a meal template: a food + gram weight. */
export const mealItems = sqliteTable('meal_items', {
  id: text('id').primaryKey(),
  mealId: text('meal_id')
    .notNull()
    .references(() => meals.id, { onDelete: 'cascade' }),
  foodItemId: text('food_item_id')
    .notNull()
    .references(() => foodItems.id, { onDelete: 'restrict' }),
  grams: real('grams').notNull().default(0),
  ...auditColumns,
});

/** What was actually eaten on a given day. */
export const dailyLogs = sqliteTable('daily_logs', {
  id: text('id').primaryKey(),
  loggedDate: text('logged_date').notNull(), // 'YYYY-MM-DD' (local day)
  mealType: text('meal_type').notNull(), // breakfast | lunch | dinner | snack
  foodItemId: text('food_item_id')
    .notNull()
    .references(() => foodItems.id, { onDelete: 'restrict' }),
  grams: real('grams').notNull().default(0),
  ...auditColumns,
});

/** Single-row settings: daily targets, currency, and a reserved TDEE slot. */
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(), // always 'app'
  targetCalories: real('target_calories').notNull().default(2000),
  targetProteinG: real('target_protein_g').notNull().default(150),
  targetCarbsG: real('target_carbs_g').notNull().default(200),
  targetFatG: real('target_fat_g').notNull().default(65),
  targetFiberG: real('target_fiber_g').notNull().default(30),
  targetSodiumMg: real('target_sodium_mg').notNull().default(2300),
  currency: text('currency').notNull().default('$'),
  // reserved for the future adaptive TDEE engine
  tdee: real('tdee'),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

export type FoodItem = typeof foodItems.$inferSelect;
export type NewFoodItem = typeof foodItems.$inferInsert;
export type Meal = typeof meals.$inferSelect;
export type MealItem = typeof mealItems.$inferSelect;
export type DailyLog = typeof dailyLogs.$inferSelect;
export type Settings = typeof settings.$inferSelect;
