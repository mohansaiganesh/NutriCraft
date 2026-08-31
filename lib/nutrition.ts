/**
 * Pure nutrition math.
 *
 * NO react-native imports here on purpose: this file is unit-tested with jest and
 * is the single source of truth for every macro/cost number shown in the app.
 */

/** A food's values expressed per 100 g / 100 ml (how the catalog stores them). */
export interface PerHundredBasis {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  pricePer100: number;
}

/** A concrete amount of nutrition (a meal, a day, one logged entry). */
export interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  cost: number;
}

export const EMPTY_TOTALS: NutritionTotals = {
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sodiumMg: 0,
  cost: 0,
};

/**
 * Convert a single value printed on a label into its per-100 equivalent.
 * value = (value / serving) * 100
 */
export function normalizeLabelToPer100(
  servingSize: number,
  valueOnLabel: number
): number {
  if (!servingSize) return 0;
  return (valueOnLabel / servingSize) * 100;
}

/** Raw numbers as they appear on a nutrition label / receipt. */
export interface LabelInput {
  servingSize: number; // g or ml per serving
  numberOfServings: number; // servings per package (for price)
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number; // mg per serving
  price: number; // total package price
}

/**
 * Build the stored per-100 basis from label inputs.
 * Nutrients: (value / serving) * 100.
 * Price:     (price / (serving * servings)) * 100  = cost per 100 of the whole pack.
 */
export function buildBasisFromLabel(input: LabelInput): PerHundredBasis {
  const s = input.servingSize;
  const packWeight = input.servingSize * (input.numberOfServings || 1);
  return {
    calories: normalizeLabelToPer100(s, input.calories),
    proteinG: normalizeLabelToPer100(s, input.protein),
    carbsG: normalizeLabelToPer100(s, input.carbs),
    fatG: normalizeLabelToPer100(s, input.fat),
    fiberG: normalizeLabelToPer100(s, input.fiber),
    sodiumMg: normalizeLabelToPer100(s, input.sodium),
    pricePer100: packWeight ? (input.price / packWeight) * 100 : 0,
  };
}

/**
 * Scale a per-100 basis to an actual gram/ml amount.
 * field * grams * 0.01
 */
export function nutritionFor(
  basis: PerHundredBasis,
  grams: number
): NutritionTotals {
  const f = grams * 0.01;
  return {
    calories: basis.calories * f,
    proteinG: basis.proteinG * f,
    carbsG: basis.carbsG * f,
    fatG: basis.fatG * f,
    fiberG: basis.fiberG * f,
    sodiumMg: basis.sodiumMg * f,
    cost: basis.pricePer100 * f,
  };
}

/** Sum a list of totals (a meal, or a whole day). */
export function sumNutrition(items: NutritionTotals[]): NutritionTotals {
  return items.reduce<NutritionTotals>(
    (acc, t) => ({
      calories: acc.calories + t.calories,
      proteinG: acc.proteinG + t.proteinG,
      carbsG: acc.carbsG + t.carbsG,
      fatG: acc.fatG + t.fatG,
      fiberG: acc.fiberG + t.fiberG,
      sodiumMg: acc.sodiumMg + t.sodiumMg,
      cost: acc.cost + t.cost,
    }),
    { ...EMPTY_TOTALS }
  );
}

/** Round every field to `digits` decimals (for display / comparison). */
export function roundTotals(t: NutritionTotals, digits = 2): NutritionTotals {
  const r = (n: number) => {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  };
  return {
    calories: r(t.calories),
    proteinG: r(t.proteinG),
    carbsG: r(t.carbsG),
    fatG: r(t.fatG),
    fiberG: r(t.fiberG),
    sodiumMg: r(t.sodiumMg),
    cost: r(t.cost),
  };
}
