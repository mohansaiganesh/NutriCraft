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
  allMealItemsQuery,
  dayLogsQuery,
  foodsQuery,
  logsInRangeQuery,
  mealItemsQuery,
  mealsQuery,
  settingsQuery,
} from '@/db/queries';
import { nutritionFor, roundTotals, sumNutrition } from '@/lib/nutrition';
import type { NutritionTotals, PerHundredBasis } from '@/lib/nutrition';
import { addDaysISO, todayISO } from '@/lib/format';

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
  const rows = await foodsQuery(args.query ?? '');
  return {
    foods: rows.slice(0, 25).map((f) => ({
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

const STR = { type: 'STRING' as const };

/** Gemini function declarations describing every tool above. */
export const FUNCTION_DECLARATIONS = [
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
      type: 'OBJECT',
      properties: { date: { ...STR, description: 'Day as YYYY-MM-DD. Defaults to today if omitted.' } },
    },
  },
  {
    name: 'list_day_logs',
    description: 'List every individual food entry logged on a single day, with grams, calories, protein and cost per entry.',
    parameters: {
      type: 'OBJECT',
      properties: { date: { ...STR, description: 'Day as YYYY-MM-DD. Defaults to today if omitted.' } },
    },
  },
  {
    name: 'get_range_totals',
    description:
      'Get total nutrition and cost logged across an inclusive date range, plus a per-day calorie/cost rollup and the average calories per logged day. Use for "this week", "this month", "last 7 days", etc.',
    parameters: {
      type: 'OBJECT',
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
      type: 'OBJECT',
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
    description: "Search the user's food catalog (their own + the shared catalog) by name. Returns per-100 g/ml nutrition and price for each match.",
    parameters: {
      type: 'OBJECT',
      properties: { query: { ...STR, description: 'Text to match against food names. Empty string lists foods.' } },
      required: ['query'],
    },
  },
];
