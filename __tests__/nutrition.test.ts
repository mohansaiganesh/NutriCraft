import {
  buildBasisFromLabel,
  normalizeLabelToPer100,
  nutritionFor,
  roundTotals,
  sumNutrition,
  type PerHundredBasis,
} from '@/lib/nutrition';

// Per-100g fixtures for the three foods the per-gram-math case exercises.
const FIXTURES: Record<string, PerHundredBasis> = {
  rice_basmati_royal: {
    calories: 355.55555555555554,
    proteinG: 8.88888888888889,
    carbsG: 80.0,
    fatG: 0.0,
    fiberG: 2.2222222222222223,
    sodiumMg: 0,
    pricePer100: 0.24322830292979547,
  },
  toor_dal_royal_split_pigeon_heb: {
    calories: 320.0,
    proteinG: 20.0,
    carbsG: 60.0,
    fatG: 2.0,
    fiberG: 14.000000000000002,
    sodiumMg: 0,
    pricePer100: 0.38333333333333336,
  },
  chicken_breast_boneless_skinless_members_mark: {
    calories: 107.14285714285714,
    proteinG: 20.535714285714285,
    carbsG: 0.0,
    fatG: 2.232142857142857,
    fiberG: 0.0,
    sodiumMg: 0,
    pricePer100: 0.6696428571428571,
  },
};
const byName = (n: string): PerHundredBasis => FIXTURES[n];

describe('normalizeLabelToPer100', () => {
  it('scales a per-serving value to per-100', () => {
    // 24g protein in a 30g serving -> 80g per 100g
    expect(normalizeLabelToPer100(30, 24)).toBeCloseTo(80, 6);
  });
  it('is safe when serving size is 0', () => {
    expect(normalizeLabelToPer100(0, 10)).toBe(0);
  });
});

describe('buildBasisFromLabel', () => {
  it('normalizes nutrients per-serving and price per-pack', () => {
    // 2 servings of 30g each = 60g pack for $6 -> $10 per 100g
    const basis = buildBasisFromLabel({
      servingSize: 30,
      numberOfServings: 2,
      calories: 120,
      protein: 24,
      carbs: 3,
      fat: 1.5,
      fiber: 0.5,
      sodium: 60,
      price: 6,
    });
    expect(basis.proteinG).toBeCloseTo(80, 6); // 24/30*100
    expect(basis.calories).toBeCloseTo(400, 6); // 120/30*100
    expect(basis.pricePer100).toBeCloseTo(10, 6); // 6/(30*2)*100
  });
});

describe('nutritionFor + sumNutrition', () => {
  it('matches the expected per-gram math for rice+dal+chicken', () => {
    // rice 100g + toor dal 70g + chicken 250g
    const totals = roundTotals(
      sumNutrition([
        nutritionFor(byName('rice_basmati_royal'), 100),
        nutritionFor(byName('toor_dal_royal_split_pigeon_heb'), 70),
        nutritionFor(byName('chicken_breast_boneless_skinless_members_mark'), 250),
      ])
    );
    expect(totals.proteinG).toBe(74.23);
    expect(totals.calories).toBe(847.41);
    expect(totals.cost).toBe(2.19);
  });
});
