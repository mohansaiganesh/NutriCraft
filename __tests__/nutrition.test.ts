import {
  buildBasisFromLabel,
  normalizeLabelToPer100,
  nutritionFor,
  roundTotals,
  sumNutrition,
  type PerHundredBasis,
} from '@/lib/nutrition';
import seed from '@/assets/data/food_data.seed.json';

interface SeedRow {
  name: string;
  protein: number;
  carbohydrates: number;
  fats: number;
  fiber: number;
  calories: number;
  price: number;
}

const rows = seed as SeedRow[];
const byName = (n: string): PerHundredBasis => {
  const r = rows.find((x) => x.name === n)!;
  return {
    calories: r.calories,
    proteinG: r.protein,
    carbsG: r.carbohydrates,
    fatG: r.fats,
    fiberG: r.fiber,
    sodiumMg: 0,
    pricePer100: r.price,
  };
};

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
