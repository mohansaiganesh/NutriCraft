/**
 * Read-only "tools" the Gemini assistant can call to answer questions about the user's data.
 *
 * Each tool is a plain async function that composes the EXISTING query builders in
 * `db/queries.ts` with the pure math in `lib/nutrition.ts` — no new queries, no writes.
 * Every query already scopes to the current user via `requireUserId()`, and the assistant
 * overlay only mounts once a user is signed in, so these are safe to call directly.
 *
 * Alongside each function is its Gemini `functionDeclaration` (name / description / parameters).
 * Results are returned as compact, rounded JSON to keep token use — and cost — low.
 */
import {
  addLog,
  allMealItemsQuery,
  applyMealToDay,
  dayLogsQuery,
  foodsQuery,
  getFood,
  getLogEntry,
  logsInRangeQuery,
  mealItemsQuery,
  mealsQuery,
  removeLog,
  settingsQuery,
  updateLog,
} from '@/db/queries';
import { matchFoods } from '@/lib/foodMatch';
import { nutritionFor, roundTotals, sumNutrition } from '@/lib/nutrition';
import type { NutritionTotals, PerHundredBasis } from '@/lib/nutrition';
import { getCurrentUserId } from '@/lib/currentUser';
import { addDaysISO, dateLabel, todayISO } from '@/lib/format';
import { MEAL_TYPES, mealLabel } from '@/constants/meals';
import type { MealType } from '@/constants/meals';
import type { LlmToolDecl } from './provider';

// ------------------------------------------------------------------ helpers

/** The user's daily targets + currency (falls back to sensible defaults if the row is missing). */
async function loadSettings() {
  const rows = await settingsQuery();
  return (
    rows[0] ?? {
      targetCalories: 2000,
      targetProteinG: 150,
      targetCarbsG: 200,
      targetFatG: 65,
      targetFiberG: 30,
      targetSodiumMg: 2300,
      currency: '$',
    }
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sum { food, grams } rows into rounded nutrition totals. */
function sumRows(rows: { food: PerHundredBasis; grams: number }[]): NutritionTotals {
  return roundTotals(sumNutrition(rows.map((r) => nutritionFor(r.food, r.grams))));
}

// ------------------------------------------------------------------ tool implementations

async function getToday() {
  const today = todayISO();
  const t = new Date();
  const weekday = t.toLocaleDateString(undefined, { weekday: 'long' });
  const dow = t.getDay(); // 0 Sun … 6 Sat
  const weekStart = addDaysISO(today, dow === 0 ? -6 : 1 - dow); // Monday
  const [y, m] = today.split('-');
  const monthStart = `${y}-${m}-01`;
  const monthEnd = todayISO(new Date(Number(y), Number(m), 0)); // last day of month
  return {
    today,
    weekday,
    ranges: {
      this_week: { startDate: weekStart, endDate: addDaysISO(weekStart, 6) },
      last_7_days: { startDate: addDaysISO(today, -6), endDate: today },
      this_month: { startDate: monthStart, endDate: monthEnd },
      last_30_days: { startDate: addDaysISO(today, -29), endDate: today },
    },
  };
}

async function getTargets() {
  const s = await loadSettings();
  return {
    currency: s.currency,
    targetCalories: s.targetCalories,
    targetProteinG: s.targetProteinG,
    targetCarbsG: s.targetCarbsG,
    targetFatG: s.targetFatG,
    targetFiberG: s.targetFiberG,
    targetSodiumMg: s.targetSodiumMg,
  };
}

async function getDayTotals(args: { date?: string }) {
  const date = args.date || todayISO();
  const rows = await dayLogsQuery(date);
  const totals = sumRows(rows.map((r) => ({ food: r.food, grams: r.log.grams })));
  const s = await loadSettings();
  return {
    date,
    currency: s.currency,
    entryCount: rows.length,
    totals,
    vsTarget: {
      calories: { target: s.targetCalories, consumed: totals.calories, remaining: round1(s.targetCalories - totals.calories), over: totals.calories > s.targetCalories },
      proteinG: { target: s.targetProteinG, consumed: totals.proteinG, remaining: round1(s.targetProteinG - totals.proteinG), over: totals.proteinG > s.targetProteinG },
      carbsG: { target: s.targetCarbsG, consumed: totals.carbsG, remaining: round1(s.targetCarbsG - totals.carbsG), over: totals.carbsG > s.targetCarbsG },
      fatG: { target: s.targetFatG, consumed: totals.fatG, remaining: round1(s.targetFatG - totals.fatG), over: totals.fatG > s.targetFatG },
      fiberG: { target: s.targetFiberG, consumed: totals.fiberG, remaining: round1(s.targetFiberG - totals.fiberG), over: totals.fiberG > s.targetFiberG },
      sodiumMg: { target: s.targetSodiumMg, consumed: totals.sodiumMg, remaining: round1(s.targetSodiumMg - totals.sodiumMg), over: totals.sodiumMg > s.targetSodiumMg },
    },
  };
}

async function listDayLogs(args: { date?: string }) {
  const date = args.date || todayISO();
  const rows = await dayLogsQuery(date);
  return {
    date,
    entries: rows.map((r) => {
      const n = roundTotals(nutritionFor(r.food, r.log.grams));
      return {
        // The entry id lets write tools target this exact log for edit/remove.
        logId: r.log.id,
        food: r.food.name,
        brand: r.food.brand,
        mealType: r.log.mealType,
        grams: r.log.grams,
        calories: n.calories,
        proteinG: n.proteinG,
        cost: n.cost,
      };
    }),
  };
}

async function getRangeTotals(args: { startDate: string; endDate: string }) {
  const rows = await logsInRangeQuery(args.startDate, args.endDate);
  const totals = sumRows(rows.map((r) => ({ food: r.food, grams: r.log.grams })));

  // Per-day calorie/cost rollup so the model can answer "which day was highest?".
  const perDay: Record<string, { calories: number; cost: number }> = {};
  for (const r of rows) {
    const n = nutritionFor(r.food, r.log.grams);
    const cur = perDay[r.log.loggedDate] ?? { calories: 0, cost: 0 };
    perDay[r.log.loggedDate] = { calories: cur.calories + n.calories, cost: cur.cost + n.cost };
  }
  const daysLogged = Object.keys(perDay).length;
  for (const d of Object.keys(perDay)) {
    perDay[d] = { calories: round1(perDay[d].calories), cost: round1(perDay[d].cost) };
  }
  const s = await loadSettings();
  return {
    startDate: args.startDate,
    endDate: args.endDate,
    currency: s.currency,
    daysLogged,
    totals,
    avgCaloriesPerLoggedDay: daysLogged ? round1(totals.calories / daysLogged) : 0,
    perDay,
  };
}

async function listMeals() {
  const rows = await mealsQuery();
  return { meals: rows.map((m) => ({ id: m.id, name: m.name, notes: m.notes ?? undefined })) };
}

async function getMealBreakdown(args: { mealId: string }) {
  const rows = await mealItemsQuery(args.mealId);
  const totals = sumRows(rows.map((r) => ({ food: r.food, grams: r.item.grams })));
  const s = await loadSettings();
  return {
    mealId: args.mealId,
    currency: s.currency,
    items: rows.map((r) => {
      const n = roundTotals(nutritionFor(r.food, r.item.grams));
      return { food: r.food.name, grams: r.item.grams, calories: n.calories, proteinG: n.proteinG, cost: n.cost };
    }),
    totals,
  };
}

async function listMealsWithTotals() {
  const [items, mealRows, s] = await Promise.all([allMealItemsQuery(), mealsQuery(), loadSettings()]);
  const nameById = new Map(mealRows.map((m) => [m.id, m.name]));
  const acc = new Map<string, NutritionTotals[]>();
  for (const r of items) {
    const list = acc.get(r.item.mealId) ?? [];
    list.push(nutritionFor(r.food, r.item.grams));
    acc.set(r.item.mealId, list);
  }
  const meals = [...acc.entries()]
    .filter(([id]) => nameById.has(id)) // skip items whose meal was deleted
    .map(([id, list]) => ({ id, name: nameById.get(id)!, totals: roundTotals(sumNutrition(list)) }));
  return { currency: s.currency, meals };
}

async function searchFoods(args: { query: string }) {
  const q = (args.query ?? '').trim();
  // Fetch the whole owned+shared catalog and match in JS (see lib/foodMatch): a raw SQL LIKE only
  // matches an identical character run, so "sunflower seeds" would miss a food stored as
  // "sunflowerSeeds". matchFoods normalizes spacing/case/punctuation/word-order so the model never
  // has to guess the exact stored spelling.
  const rows = await foodsQuery('');
  // Empty query = "list the catalog": return names only so the WHOLE list fits cheaply (a full
  // per-100 block per row would blow the token budget on a large catalog). A term = "search":
  // return the full nutrition, capped. Both always report `total`/`truncated` so the model never
  // mistakes a capped slice for the entire catalog (and can point the user at open_food_catalog).
  if (q === '') {
    const cap = 200;
    const total = rows.length;
    return {
      mode: 'list' as const,
      total,
      returned: Math.min(total, cap),
      truncated: total > cap,
      foods: rows.slice(0, cap).map((f) => ({
        id: f.id,
        name: f.name,
        brand: f.brand,
        isCustom: f.isCustom,
      })),
    };
  }
  const cap = 25;
  const matched = matchFoods(q, rows);
  const total = matched.length;
  return {
    mode: 'search' as const,
    total,
    returned: Math.min(total, cap),
    truncated: total > cap,
    foods: matched.slice(0, cap).map((f) => ({
      id: f.id,
      name: f.name,
      brand: f.brand,
      per100: {
        calories: round1(f.calories),
        proteinG: round1(f.proteinG),
        carbsG: round1(f.carbsG),
        fatG: round1(f.fatG),
        fiberG: round1(f.fiberG),
        sodiumMg: round1(f.sodiumMg),
        price: round1(f.pricePer100),
      },
      isCustom: f.isCustom,
    })),
  };
}

/**
 * Not a data question — a UI handoff. Returns the true catalog size so the model can state it; the
 * navigation itself is performed by the app (the agent loop maps this tool to a NAV_TOOLS target,
 * the overlay renders a button — see NAV_TOOLS below and agent.ts).
 */
async function openFoodCatalog() {
  const rows = await foodsQuery('');
  return { opened: true, total: rows.length };
}

/**
 * Not a data question — a UI handoff, twin of openFoodCatalog. Returns the saved-meal count so the
 * model can state it; the navigation to the Meals screen is performed by the app (NAV_TOOLS below).
 */
async function openMeals() {
  const rows = await mealsQuery();
  return { opened: true, total: rows.length };
}

// ------------------------------------------------------------------ registry + declarations

type Tool = { run: (args: any) => Promise<unknown> };

export const TOOLS: Record<string, Tool> = {
  get_today: { run: getToday },
  get_targets: { run: getTargets },
  get_day_totals: { run: getDayTotals },
  list_day_logs: { run: listDayLogs },
  get_range_totals: { run: getRangeTotals },
  list_meals: { run: listMeals },
  get_meal_breakdown: { run: getMealBreakdown },
  list_meals_with_totals: { run: listMealsWithTotals },
  search_foods: { run: searchFoods },
  open_food_catalog: { run: openFoodCatalog },
  open_meals: { run: openMeals },
};

/**
 * Read tools that, beyond returning data, ask the app to NAVIGATE somewhere once they run. The agent
 * loop looks a called tool up here and threads the target back to the UI (which renders a button —
 * navigation is a deterministic app action, never driven by the model's prose). Data-driven so
 * agent.ts hardcodes no tool names.
 */
export const NAV_TOOLS: Record<string, { pathname: string; label: string }> = {
  open_food_catalog: { pathname: '/(tabs)/foods', label: 'Open Foods catalog' },
  open_meals: { pathname: '/(tabs)/meals', label: 'Open Meals' },
};

/** Run a tool by name; returns a JSON-serialisable result or an { error } object. */
export async function runTool(name: string, args: unknown): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run((args ?? {}) as any);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Tool failed' };
  }
}

const STR = { type: 'string' as const };

/** Neutral (provider-agnostic) function declarations describing every read tool above. Each provider
 * adapter converts these to its own wire dialect — see `providers/`. */
export const FUNCTION_DECLARATIONS: LlmToolDecl[] = [
  {
    name: 'get_today',
    description:
      "Get today's local date (YYYY-MM-DD), the weekday, and convenient precomputed date ranges (this_week, last_7_days, this_month, last_30_days). Call this FIRST for any question involving 'today', 'this week', 'this month', etc.",
  },
  {
    name: 'get_targets',
    description: "Get the user's daily nutrition targets (calories, protein, carbs, fat, fiber, sodium) and their currency symbol.",
  },
  {
    name: 'get_day_totals',
    description: 'Get total nutrition and cost logged on a single day, plus how it compares to the daily targets (remaining / over).',
    parameters: {
      type: 'object',
      properties: { date: { ...STR, description: 'Day as YYYY-MM-DD. Defaults to today if omitted.' } },
    },
  },
  {
    name: 'list_day_logs',
    description: 'List every individual food entry logged on a single day, with grams, calories, protein and cost per entry.',
    parameters: {
      type: 'object',
      properties: { date: { ...STR, description: 'Day as YYYY-MM-DD. Defaults to today if omitted.' } },
    },
  },
  {
    name: 'get_range_totals',
    description:
      'Get total nutrition and cost logged across an inclusive date range, plus a per-day calorie/cost rollup and the average calories per logged day. Use for "this week", "this month", "last 7 days", etc.',
    parameters: {
      type: 'object',
      properties: {
        startDate: { ...STR, description: 'Start day (inclusive), YYYY-MM-DD.' },
        endDate: { ...STR, description: 'End day (inclusive), YYYY-MM-DD.' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'list_meals',
    description: 'List the user\'s saved meal templates (id + name). Use the id with get_meal_breakdown.',
  },
  {
    name: 'get_meal_breakdown',
    description: 'Get the food items and total nutrition/cost of one saved meal template.',
    parameters: {
      type: 'object',
      properties: { mealId: { ...STR, description: 'The meal id from list_meals or list_meals_with_totals.' } },
      required: ['mealId'],
    },
  },
  {
    name: 'list_meals_with_totals',
    description: 'List all saved meal templates each with its total nutrition and cost. Use to compare meals, e.g. find the most/least expensive or highest-protein meal.',
  },
  {
    name: 'search_foods',
    description:
      "Search the user's food catalog (their own + the shared catalog) by name or brand. Matching is tolerant — it ignores spacing, casing, punctuation and word order (so 'sunflower seeds' finds a food stored as 'sunflowerSeeds'), so use the user's natural wording and do NOT retry with alternate spellings if nothing comes back. A search term returns per-100 g/ml nutrition and price for the matches (capped). An EMPTY string lists the catalog names only (no nutrition). Every result includes `total` (the true number of matching foods) and `truncated` (true when there are more than returned) — so state `total`, never the returned count, when saying how many foods there are. To let the user BROWSE or SEE their whole list, call open_food_catalog instead of listing rows here.",
    parameters: {
      type: 'object',
      properties: { query: { ...STR, description: 'Text to match against food names/brands (spacing, case, punctuation and word order are ignored). Empty string lists the catalog (names only).' } },
      required: ['query'],
    },
  },
  {
    name: 'open_food_catalog',
    description:
      "Open the Foods screen so the user can browse and search their COMPLETE food list. Use whenever the user wants to SEE, view, browse, or scroll through all their foods (e.g. 'show me all my foods', 'let me see my food list'), OR when the user asks to CREATE or EDIT a food (which you cannot do yourself) — so they get a button to the Foods screen where they can. Returns the total number of foods. The app shows the user a button that opens the screen, so do NOT claim you have opened or navigated anywhere yourself.",
  },
  {
    name: 'open_meals',
    description:
      "Open the Meals screen. Use whenever the user wants to SEE, view, or browse their saved meals, OR when the user asks to CREATE, rename, or EDIT a meal or its items (which you cannot do yourself) — so they get a button to the Meals screen where they can. Returns the total number of saved meals. The app shows the user a button that opens the screen, so do NOT claim you have opened or navigated anywhere yourself.",
  },
];

// ================================================================== WRITE TOOLS
//
// Unlike the read tools above, these MUTATE data — and so are never executed on the model's say-so.
// Each exposes `describe(args)` (validate + resolve ids to names → a human-readable PendingWrite) and
// `execute(payload)` (call the matching mutation in `db/queries.ts`). The agent loop pauses on
// `describe`'s result until the user confirms the card; only then does it call `execute`. Every tool
// wraps an existing invariant-safe mutation — soft-delete, `updatedAt`, per-100g and user scoping all
// come for free — and validates its own args so a bad/hallucinated call fails loudly instead of
// writing garbage. Scope: logging only (see README "Deferred" for meal/food editing).

/** A proposed write, surfaced to the user for Confirm/Cancel before anything is persisted. */
export interface PendingWrite {
  tool: string; // raw write-tool name, e.g. 'log_food'
  summary: string; // present-tense operation for the card, built from resolved data (never the model's prose)
  donePhrase: string; // past-tense statement for the deterministic post-confirm message (same data)
  destructive?: boolean; // a delete — rendered with the red treatment on the card
  editableGrams?: number; // current grams — its presence marks the item as grams-editable in the card
  editNoun?: string; // what's being measured (the food/entry name) — labels the card's grams input
  // Present ⇒ the row shows a meal picker in the card. `null` ⇒ no meal chosen yet: the user MUST
  // pick one before the batch can be confirmed (we never guess a meal or persist a null one).
  editableMeal?: MealType | null;
  payload: unknown; // normalized args handed straight to execute()
}

/** Per-item edits the user made in the confirm card, re-validated before a write runs. */
export interface WriteEdit {
  grams?: number;
  mealType?: MealType;
}

// ---- arg validation (throws a user-legible message the loop turns into a tool error) ----

function reqGrams(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error('grams must be a positive number.');
  return Math.round(n * 10) / 10;
}

function reqMealType(v: unknown): MealType {
  const s = String(v ?? '').toLowerCase();
  const hit = MEAL_TYPES.find((m) => m.key === s);
  if (!hit) throw new Error(`mealType must be one of: ${MEAL_TYPES.map((m) => m.key).join(', ')}.`);
  return hit.key;
}

/** Like reqMealType but tolerant of ABSENCE: an omitted/empty meal returns null (the user didn't say
 * which — the card asks for it), while a present-but-invalid value still throws so a bad string can't
 * slip through as "unset". */
function optMealType(v: unknown): MealType | null {
  if (v == null || v === '') return null;
  return reqMealType(v);
}

/** Defaults to today; a supplied date must be a REAL ISO calendar day (the shape check alone would
 * pass impossible days like 2026-13-45, which would strand a log on a day no screen can reach). */
function optDate(v: unknown): string {
  if (v == null || v === '') return todayISO();
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error('date must be in YYYY-MM-DD form.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // A non-existent day (bad month, or day past the month's length) normalizes to a different date.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error('date is not a real calendar day.');
  }
  return s;
}

function reqString(v: unknown, field: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error(`${field} is required.`);
  return s;
}

/** A food the current user may log: their own private food, or a shared-catalog row (user_id NULL). */
async function resolveVisibleFood(id: string) {
  const food = await getFood(id);
  if (!food || food.deleted) throw new Error('That food could not be found.');
  const uid = getCurrentUserId();
  if (food.userId !== null && food.userId !== uid) throw new Error('That food is not available to you.');
  return food;
}

type WriteTool = {
  describe: (args: any) => Promise<PendingWrite>;
  execute: (payload: any) => Promise<unknown>;
  /** Rebuild the write with the user's card edits (a new grams amount and/or a picked meal).
   * Re-validates + re-resolves through the same path as describe, so nothing is trusted raw. */
  revise?: (payload: any, edits: WriteEdit) => Promise<PendingWrite>;
};

// Shared builders so describe() and revise() can never drift on summary text or payload shape.

type ResolvedFood = { id: string; name: string };

function buildLogFoodPending(food: ResolvedFood, grams: number, date: string, mealType: MealType | null): PendingWrite {
  // With no meal yet, the summary omits it so the card's picker is clearly the thing to complete;
  // donePhrase always names a meal because execute is blocked until one is picked.
  const where = mealType ? `${dateLabel(date)} · ${mealLabel(mealType)}` : dateLabel(date);
  return {
    tool: 'log_food',
    summary: `Log ${grams} g of ${food.name} to ${where}`,
    donePhrase: `Logged ${grams} g of ${food.name} to ${dateLabel(date)} · ${mealLabel(mealType ?? 'breakfast')}`,
    editableGrams: grams,
    editNoun: food.name,
    editableMeal: mealType,
    payload: { date, mealType, foodItemId: food.id, grams },
  };
}

type UpdateEntry = { log: { grams: number; mealType: string; loggedDate: string }; food: { name: string } };

function buildUpdatePending(entry: UpdateEntry, logId: string, patch: { grams?: number; mealType?: MealType }): PendingWrite {
  const parts: string[] = [];
  if (patch.grams != null) parts.push(`${entry.log.grams} g → ${patch.grams} g`);
  if (patch.mealType != null) parts.push(`${mealLabel(entry.log.mealType as MealType)} → ${mealLabel(patch.mealType)}`);
  return {
    tool: 'update_log_entry',
    summary: `Edit ${entry.food.name} on ${dateLabel(entry.log.loggedDate)}: ${parts.join(', ')}`,
    donePhrase: `Updated ${entry.food.name} on ${dateLabel(entry.log.loggedDate)}: ${parts.join(', ')}`,
    // Only offer grams editing when this change actually adjusts grams.
    ...(patch.grams != null ? { editableGrams: patch.grams, editNoun: entry.food.name } : {}),
    payload: { id: logId, patch },
  };
}

function buildApplyMealPending(
  mealName: string,
  itemCount: number,
  mealId: string,
  date: string,
  mealType: MealType | null
): PendingWrite {
  const noun = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  const where = mealType ? `${dateLabel(date)} · ${mealLabel(mealType)}` : dateLabel(date);
  return {
    tool: 'apply_meal_to_day',
    summary: `Add meal "${mealName}" (${noun}) to ${where}`,
    donePhrase: `Added meal "${mealName}" (${noun}) to ${dateLabel(date)} · ${mealLabel(mealType ?? 'breakfast')}`,
    editableMeal: mealType,
    payload: { mealId, date, mealType },
  };
}

export const WRITE_TOOLS: Record<string, WriteTool> = {
  log_food: {
    async describe(args) {
      const foodItemId = reqString(args.foodId, 'foodId');
      const grams = reqGrams(args.grams);
      const mealType = optMealType(args.mealType); // null ⇒ the card asks the user to pick
      const date = optDate(args.date);
      const food = await resolveVisibleFood(foodItemId);
      return buildLogFoodPending(food, grams, date, mealType);
    },
    async revise(p, edits) {
      const g = edits.grams != null ? reqGrams(edits.grams) : reqGrams(p.grams);
      const mealType = edits.mealType ?? (p.mealType as MealType | null);
      const food = await resolveVisibleFood(p.foodItemId);
      return buildLogFoodPending(food, g, p.date, mealType);
    },
    async execute(p) {
      // Never persist a null meal — daily_logs.meal_type is NOT NULL. The card blocks this, so it's
      // a defensive guard against a write reaching execute without a picked meal.
      if (p.mealType == null) return { error: 'Pick a meal before logging.' };
      return { logId: await addLog(p.date, p.mealType, p.foodItemId, p.grams) };
    },
  },

  update_log_entry: {
    async describe(args) {
      const logId = reqString(args.logId, 'logId');
      const entry = await getLogEntry(logId); // user-scoped — refuses another account's / a bad id
      if (!entry) throw new Error('That log entry could not be found (it may not be yours).');
      const patch: { grams?: number; mealType?: MealType } = {};
      if (args.grams != null) patch.grams = reqGrams(args.grams);
      if (args.mealType != null) patch.mealType = reqMealType(args.mealType);
      if (patch.grams == null && patch.mealType == null) throw new Error('Provide grams and/or mealType to change.');
      return buildUpdatePending(entry, logId, patch);
    },
    async revise(p, edits) {
      const entry = await getLogEntry(p.id);
      if (!entry) throw new Error('That log entry could not be found (it may not be yours).');
      // The card only edits grams for this tool; keep any meal-type change from the original proposal.
      const patch = { ...p.patch, grams: reqGrams(edits.grams ?? p.patch.grams) };
      return buildUpdatePending(entry, p.id, patch);
    },
    async execute(p) {
      await updateLog(p.id, p.patch);
      return { updated: true };
    },
  },

  remove_log_entry: {
    async describe(args) {
      const logId = reqString(args.logId, 'logId');
      const entry = await getLogEntry(logId);
      if (!entry) throw new Error('That log entry could not be found (it may not be yours).');
      return {
        tool: 'remove_log_entry',
        summary: `Remove ${entry.food.name} (${entry.log.grams} g) from ${dateLabel(entry.log.loggedDate)} · ${mealLabel(entry.log.mealType)}`,
        donePhrase: `Removed ${entry.food.name} (${entry.log.grams} g) from ${dateLabel(entry.log.loggedDate)} · ${mealLabel(entry.log.mealType)}`,
        destructive: true,
        payload: { id: logId },
      };
    },
    async execute(p) {
      await removeLog(p.id);
      return { removed: true };
    },
  },

  apply_meal_to_day: {
    async describe(args) {
      const mealId = reqString(args.mealId, 'mealId');
      const mealType = optMealType(args.mealType); // null ⇒ the card asks the user to pick
      const date = optDate(args.date);
      const meal = (await mealsQuery()).find((m) => m.id === mealId); // user-scoped
      if (!meal) throw new Error('That meal could not be found (it may not be yours).');
      const items = await mealItemsQuery(mealId);
      if (items.length === 0) throw new Error('That meal has no items to add.');
      return buildApplyMealPending(meal.name, items.length, mealId, date, mealType);
    },
    async revise(p, edits) {
      const meal = (await mealsQuery()).find((m) => m.id === p.mealId);
      if (!meal) throw new Error('That meal could not be found (it may not be yours).');
      const items = await mealItemsQuery(p.mealId);
      const mealType = edits.mealType ?? (p.mealType as MealType | null);
      return buildApplyMealPending(meal.name, items.length, p.mealId, p.date, mealType);
    },
    async execute(p) {
      if (p.mealType == null) return { error: 'Pick a meal before adding this.' };
      return { added: await applyMealToDay(p.mealId, p.date, p.mealType) };
    },
  },
};

export const isWriteTool = (name: string): boolean => name in WRITE_TOOLS;

/** Validate + resolve a proposed write (never throws — a bad call becomes an { error } the model sees). */
export async function describeWrite(name: string, args: unknown): Promise<PendingWrite | { error: string }> {
  const tool = WRITE_TOOLS[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.describe((args ?? {}) as any);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid arguments' };
  }
}

/** Rebuild a staged write with the user's card edits — a new grams amount and/or a picked meal
 * (never throws — a bad value or a non-editable tool becomes an { error } the caller keeps the
 * original write for). */
export async function reviseWrite(
  name: string,
  payload: unknown,
  edits: WriteEdit
): Promise<PendingWrite | { error: string }> {
  const tool = WRITE_TOOLS[name];
  if (!tool?.revise) return { error: 'This item can’t be edited.' };
  try {
    return await tool.revise(payload as any, edits);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid edit' };
  }
}

/** Run a previously-described write's mutation (only ever called after the user approves). */
export async function executeWrite(name: string, payload: unknown): Promise<unknown> {
  const tool = WRITE_TOOLS[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.execute(payload as any);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Write failed' };
  }
}

const MEAL_TYPE_DESC = `One of: ${MEAL_TYPES.map((m) => m.key).join(', ')}.`;
// For log_food / apply_meal_to_day: the meal is optional at the tool boundary on purpose. Omit it
// when the user didn't say which meal — the app asks them — rather than guessing one.
const OPT_MEAL_TYPE_DESC = `Which meal: ${MEAL_TYPES.map((m) => m.key).join(', ')}. Omit entirely if the user didn't say which — never guess a meal.`;

/** Neutral function declarations for the write tools — merged with the read set below. */
export const WRITE_FUNCTION_DECLARATIONS: LlmToolDecl[] = [
  {
    name: 'log_food',
    description:
      "Log a food into the user's daily log. Requires a foodId from search_foods. Proposes the entry for the user to confirm — do NOT claim it is logged until they approve.",
    parameters: {
      type: 'object',
      properties: {
        foodId: { ...STR, description: 'The food id from search_foods.' },
        grams: { type: 'number' as const, description: 'Amount to log, in grams/ml. Must be > 0.' },
        mealType: { ...STR, description: OPT_MEAL_TYPE_DESC },
        date: { ...STR, description: 'Day to log to, YYYY-MM-DD. Defaults to today if omitted.' },
      },
      required: ['foodId', 'grams'],
    },
  },
  {
    name: 'update_log_entry',
    description:
      'Change the grams and/or meal type of an existing daily log entry. Requires a logId from list_day_logs. Proposes the change for the user to confirm.',
    parameters: {
      type: 'object',
      properties: {
        logId: { ...STR, description: 'The entry id (logId) from list_day_logs.' },
        grams: { type: 'number' as const, description: 'New amount in grams/ml (optional). Must be > 0.' },
        mealType: { ...STR, description: `New meal type (optional). ${MEAL_TYPE_DESC}` },
      },
      required: ['logId'],
    },
  },
  {
    name: 'remove_log_entry',
    description:
      'Remove an entry from the daily log. Requires a logId from list_day_logs. Proposes the removal for the user to confirm.',
    parameters: {
      type: 'object',
      properties: { logId: { ...STR, description: 'The entry id (logId) from list_day_logs.' } },
      required: ['logId'],
    },
  },
  {
    name: 'apply_meal_to_day',
    description:
      "Add every item of one saved meal template to a day's log at once. Requires a mealId from list_meals. Proposes the action for the user to confirm.",
    parameters: {
      type: 'object',
      properties: {
        mealId: { ...STR, description: 'The meal id from list_meals or list_meals_with_totals.' },
        mealType: { ...STR, description: OPT_MEAL_TYPE_DESC },
        date: { ...STR, description: 'Day to add to, YYYY-MM-DD. Defaults to today if omitted.' },
      },
      required: ['mealId'],
    },
  },
];

/**
 * The full tool set the model sees each round — read tools + write tools. Writes still can't run
 * without the user confirming the card the agent loop pauses on (see `agent.ts`). Provider adapters
 * convert this neutral list to their own wire dialect.
 */
export const ALL_FUNCTION_DECLARATIONS: LlmToolDecl[] = [
  ...FUNCTION_DECLARATIONS,
  ...WRITE_FUNCTION_DECLARATIONS,
];
