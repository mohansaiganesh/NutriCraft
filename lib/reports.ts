/**
 * Pure reporting / analytics math for the Insights dashboard.
 *
 * NO react-native imports here on purpose (same rule as `lib/nutrition.ts`): this file is the
 * single source of truth for every aggregate the Reports screen shows, and is unit-tested with
 * jest. It builds strictly on the primitives in `lib/nutrition.ts`.
 *
 * Every value follows the same guards the rest of the app uses: an unknown/absent price surfaces
 * as `0` (the `Cost` component renders that as "N/A"), and no computation divides by zero.
 */

import {
  EMPTY_TOTALS,
  nutritionFor,
  sumNutrition,
  type NutritionTotals,
  type PerHundredBasis,
} from './nutrition';
import { addDaysISO } from './format';

/** A food carrying its per-100 basis plus identity (what the joined log/meal rows provide). */
export interface FoodLike extends PerHundredBasis {
  id: string;
  name: string;
  brand: string;
}

/** One logged intake entry (a `daily_logs` row joined to its food). */
export interface LogEntry {
  loggedDate: string; // 'YYYY-MM-DD'
  mealType: string; // breakfast | lunch | dinner | snack
  grams: number;
  food: FoodLike;
}

/** The per-user targets the reports compare against (subset of the settings row). */
export interface Targets {
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  targetFiberG: number;
  targetSodiumMg: number;
}

/** One day on the timeline: its summed totals and how many entries produced them. */
export interface DayPoint {
  date: string; // 'YYYY-MM-DD'
  totals: NutritionTotals;
  entryCount: number;
}

export const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealTypeKey = (typeof MEAL_ORDER)[number];

// -------------------------------------------------------------- Time series

/** Inclusive list of 'YYYY-MM-DD' days from start to end (guarded against runaway ranges). */
export function enumerateDays(startISO: string, endISO: string): string[] {
  const days: string[] = [];
  let cur = startISO;
  let guard = 0;
  while (cur <= endISO && guard < 400) {
    days.push(cur);
    cur = addDaysISO(cur, 1);
    guard++;
  }
  return days;
}

/** Per-day totals across [start, end], gap-filled so charts get a continuous timeline. */
export function dailySeries(
  entries: LogEntry[],
  startISO: string,
  endISO: string
): DayPoint[] {
  const byDate = new Map<string, NutritionTotals[]>();
  for (const e of entries) {
    const arr = byDate.get(e.loggedDate) ?? [];
    arr.push(nutritionFor(e.food, e.grams));
    byDate.set(e.loggedDate, arr);
  }
  return enumerateDays(startISO, endISO).map((date) => {
    const items = byDate.get(date) ?? [];
    return { date, totals: sumNutrition(items), entryCount: items.length };
  });
}

/** Days that actually have logged entries (the denominator for "daily average"). */
export function activeDays(series: DayPoint[]): DayPoint[] {
  return series.filter((d) => d.entryCount > 0);
}

/** Sum of every day in the series (the period total). */
export function periodTotals(series: DayPoint[]): NutritionTotals {
  return sumNutrition(series.map((d) => d.totals));
}

/** Mean per *active* day (untracked days don't dilute the average). Empty → all zeros. */
export function periodAverages(series: DayPoint[]): NutritionTotals {
  const active = activeDays(series);
  const n = active.length;
  if (n === 0) return { ...EMPTY_TOTALS };
  const t = sumNutrition(active.map((d) => d.totals));
  return {
    calories: t.calories / n,
    proteinG: t.proteinG / n,
    carbsG: t.carbsG / n,
    fatG: t.fatG / n,
    fiberG: t.fiberG / n,
    sodiumMg: t.sodiumMg / n,
    cost: t.cost / n,
  };
}

// -------------------------------------------------------------- Adherence

type Direction = 'band' | 'atLeast' | 'atMost';

/** Did a day's value meet its goal, given the goal's direction? */
function meetsGoal(value: number, target: number, dir: Direction): boolean {
  if (target <= 0) return false;
  if (dir === 'atLeast') return value >= target * 0.9; // "more is better" (protein, fiber)
  if (dir === 'atMost') return value <= target; // "less is better" (sodium)
  return value >= target * 0.9 && value <= target * 1.1; // calorie band
}

export interface AdherenceMetric {
  key: 'calories' | 'proteinG' | 'fiberG' | 'sodiumMg';
  label: string;
  metDays: number;
  activeDays: number;
  /** % of active days that met the goal (0 when there are no active days). */
  pct: number;
  /** Consecutive most-recent *active* days meeting the goal. */
  streak: number;
}

const ADHERENCE_SPEC: {
  key: AdherenceMetric['key'];
  label: string;
  target: (t: Targets) => number;
  value: (n: NutritionTotals) => number;
  dir: Direction;
}[] = [
  { key: 'calories', label: 'Calories', target: (t) => t.targetCalories, value: (n) => n.calories, dir: 'band' },
  { key: 'proteinG', label: 'Protein', target: (t) => t.targetProteinG, value: (n) => n.proteinG, dir: 'atLeast' },
  { key: 'fiberG', label: 'Fiber', target: (t) => t.targetFiberG, value: (n) => n.fiberG, dir: 'atLeast' },
  { key: 'sodiumMg', label: 'Sodium', target: (t) => t.targetSodiumMg, value: (n) => n.sodiumMg, dir: 'atMost' },
];

/**
 * Per-metric goal adherence over the period. Uses the account's *current* targets applied
 * retroactively (the schema keeps no target history). Streaks count back over active days only,
 * so untracked gaps neither extend nor break a streak.
 */
export function adherence(series: DayPoint[], targets: Targets): AdherenceMetric[] {
  const active = activeDays(series);
  return ADHERENCE_SPEC.map((spec) => {
    const target = spec.target(targets);
    const metDays = active.filter((d) => meetsGoal(spec.value(d.totals), target, spec.dir)).length;
    let streak = 0;
    for (let i = active.length - 1; i >= 0; i--) {
      if (meetsGoal(spec.value(active[i].totals), target, spec.dir)) streak++;
      else break;
    }
    return {
      key: spec.key,
      label: spec.label,
      metDays,
      activeDays: active.length,
      pct: active.length > 0 ? (metDays / active.length) * 100 : 0,
      streak,
    };
  });
}

// -------------------------------------------------------------- Distributions

/** Share of calories from each macro (4/4/9 kcal per g). Empty/zero → all zeros. */
export function macroSplit(t: NutritionTotals): { protein: number; carbs: number; fat: number } {
  const pC = t.proteinG * 4;
  const cC = t.carbsG * 4;
  const fC = t.fatG * 9;
  const sum = pC + cC + fC;
  if (sum <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: (pC / sum) * 100, carbs: (cC / sum) * 100, fat: (fC / sum) * 100 };
}

/** Totals grouped by meal type, always in breakfast→snack order. */
export function mealTypeBreakdown(
  entries: LogEntry[]
): { key: MealTypeKey; totals: NutritionTotals }[] {
  return MEAL_ORDER.map((key) => ({
    key,
    totals: sumNutrition(
      entries.filter((e) => e.mealType === key).map((e) => nutritionFor(e.food, e.grams))
    ),
  }));
}

// -------------------------------------------------------------- Value metrics

/** Cost of 1000 kcal for a bundle of totals. Unknown price / no calories → 0. */
export function costPer1000Kcal(t: NutritionTotals): number {
  return t.cost > 0 && t.calories > 0 ? (t.cost / t.calories) * 1000 : 0;
}

/** Cost per gram of protein. Unknown price / no protein → 0. */
export function costPerGramProtein(t: NutritionTotals): number {
  return t.cost > 0 && t.proteinG > 0 ? t.cost / t.proteinG : 0;
}

/** Grams of protein per unit currency for a catalog food. Unpriced → 0. */
export function proteinPerDollar(food: PerHundredBasis): number {
  return food.pricePer100 > 0 ? food.proteinG / food.pricePer100 : 0;
}

// -------------------------------------------------------------- Leaderboards

/** A food rolled up across every time it was logged in the period. */
export interface FoodAgg {
  id: string;
  name: string;
  brand: string;
  count: number; // number of log entries
  grams: number; // total grams eaten
  totals: NutritionTotals; // summed nutrition + cost
}

/** Roll up log entries per food id. */
export function aggregateFoods(entries: LogEntry[]): FoodAgg[] {
  const map = new Map<string, FoodAgg>();
  for (const e of entries) {
    const prev = map.get(e.food.id);
    const one = nutritionFor(e.food, e.grams);
    if (prev) {
      prev.count += 1;
      prev.grams += e.grams;
      prev.totals = sumNutrition([prev.totals, one]);
    } else {
      map.set(e.food.id, {
        id: e.food.id,
        name: e.food.name,
        brand: e.food.brand,
        count: 1,
        grams: e.grams,
        totals: one,
      });
    }
  }
  return [...map.values()];
}

/** Spend grouped by brand across the period (only brands with a known cost > 0). */
export function spendByBrand(entries: LogEntry[]): { brand: string; cost: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const { cost } = nutritionFor(e.food, e.grams);
    if (cost > 0) map.set(e.food.brand, (map.get(e.food.brand) ?? 0) + cost);
  }
  return [...map.entries()]
    .map(([brand, cost]) => ({ brand, cost }))
    .sort((a, b) => b.cost - a.cost);
}

/** Sort a copy of `items` by `value` descending and take the top `limit`. */
export function rankBy<T>(items: T[], value: (t: T) => number, limit = 5): T[] {
  return [...items].sort((a, b) => value(b) - value(a)).slice(0, limit);
}

// -------------------------------------------------------------- Meal comparison

export interface MealAgg {
  id: string;
  name: string;
  itemCount: number;
  totals: NutritionTotals;
}

/** Roll up each meal template's line items into one totals bundle for ranking. */
export function mealComparison(
  meals: { id: string; name: string }[],
  items: { mealId: string; grams: number; food: FoodLike }[]
): MealAgg[] {
  return meals.map((m) => {
    const mine = items.filter((it) => it.mealId === m.id);
    return {
      id: m.id,
      name: m.name,
      itemCount: mine.length,
      totals: sumNutrition(mine.map((it) => nutritionFor(it.food, it.grams))),
    };
  });
}

// -------------------------------------------------------------- Headline

/** Minimal currency formatter (kept local so this module stays RN- and format-agnostic). */
function money(n: number, currency = '$'): string {
  return `${currency}${n.toFixed(2)}`;
}

/**
 * One human-readable takeaway for the top of the dashboard. Prefers the app's signature
 * value insight (cheapest protein), then falls back to a calorie summary, then a nudge.
 */
export function naturalHeadline(
  entries: LogEntry[],
  series: DayPoint[],
  currency = '$'
): string {
  const foods = aggregateFoods(entries);
  const priced = foods
    .map((f) => ({ f, cpg: costPerGramProtein(f.totals) }))
    .filter((x) => x.cpg > 0 && x.f.totals.proteinG > 0);
  if (priced.length > 0) {
    const best = priced.reduce((a, b) => (b.cpg < a.cpg ? b : a));
    return `Cheapest protein this period: ${best.f.name} — ${money(best.cpg, currency)}/g`;
  }
  const active = activeDays(series);
  if (active.length > 0) {
    const avg = periodAverages(series);
    return `You averaged ${Math.round(avg.calories)} kcal/day across ${active.length} ${
      active.length === 1 ? 'day' : 'days'
    }.`;
  }
  return 'Log a few days to unlock your insights.';
}
