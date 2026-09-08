import {
  adherence,
  aggregateFoods,
  costPer1000Kcal,
  costPerGramProtein,
  dailySeries,
  enumerateDays,
  macroSplit,
  mealComparison,
  mealTypeBreakdown,
  naturalHeadline,
  periodAverages,
  proteinPerDollar,
  rankBy,
  spendByBrand,
  type FoodLike,
  type LogEntry,
  type Targets,
} from '@/lib/reports';

// --- Fixtures ---------------------------------------------------------------

// Round per-100 numbers keep the expected math easy to read.
const chicken: FoodLike = {
  id: 'chicken',
  name: 'Chicken Breast',
  brand: 'MembersMark',
  calories: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  fiberG: 0,
  sodiumMg: 74,
  pricePer100: 1.0, // $1 / 100g
};
const rice: FoodLike = {
  id: 'rice',
  name: 'White Rice',
  brand: 'Royal',
  calories: 130,
  proteinG: 2.7,
  carbsG: 28,
  fatG: 0.3,
  fiberG: 0.4,
  sodiumMg: 1,
  pricePer100: 0.2,
};
const water: FoodLike = {
  id: 'water',
  name: 'Water',
  brand: 'Tap',
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sodiumMg: 0,
  pricePer100: 0, // unpriced / free
};

const TARGETS: Targets = {
  targetCalories: 2000,
  targetProteinG: 150,
  targetCarbsG: 200,
  targetFatG: 65,
  targetFiberG: 30,
  targetSodiumMg: 2300,
};

// --- Tests ------------------------------------------------------------------

describe('enumerateDays', () => {
  it('is inclusive of both ends and continuous', () => {
    expect(enumerateDays('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });
  it('returns a single day when start === end', () => {
    expect(enumerateDays('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });
});

describe('dailySeries', () => {
  it('gap-fills days with no entries and sums the ones that have them', () => {
    const entries: LogEntry[] = [
      { loggedDate: '2026-01-01', mealType: 'lunch', grams: 200, food: chicken }, // 330 kcal
      { loggedDate: '2026-01-01', mealType: 'dinner', grams: 100, food: rice }, // 130 kcal
      { loggedDate: '2026-01-03', mealType: 'lunch', grams: 100, food: chicken }, // 165 kcal
    ];
    const series = dailySeries(entries, '2026-01-01', '2026-01-03');
    expect(series.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(series[0].totals.calories).toBeCloseTo(460, 6);
    expect(series[0].entryCount).toBe(2);
    expect(series[1].entryCount).toBe(0); // gap-filled
    expect(series[1].totals.calories).toBe(0);
    expect(series[2].totals.calories).toBeCloseTo(165, 6);
  });
});

describe('periodAverages', () => {
  it('divides by active days only (untracked days do not dilute)', () => {
    const entries: LogEntry[] = [
      { loggedDate: '2026-01-01', mealType: 'lunch', grams: 100, food: chicken }, // 165
      { loggedDate: '2026-01-03', mealType: 'lunch', grams: 100, food: chicken }, // 165
    ];
    const series = dailySeries(entries, '2026-01-01', '2026-01-04'); // 4 days, 2 active
    expect(periodAverages(series).calories).toBeCloseTo(165, 6); // 330 / 2, not / 4
  });
  it('is all zeros for an empty range', () => {
    const series = dailySeries([], '2026-01-01', '2026-01-07');
    expect(periodAverages(series).calories).toBe(0);
    expect(periodAverages(series).cost).toBe(0);
  });
});

describe('adherence', () => {
  it('counts met days per direction and tracks the current streak over active days', () => {
    // Protein target 150; 0.9*150 = 135 threshold. 200g chicken = 62g protein (miss),
    // 500g chicken = 155g (meet). Days: miss, meet, meet -> streak 2, met 2/3.
    const entries: LogEntry[] = [
      { loggedDate: '2026-01-01', mealType: 'lunch', grams: 200, food: chicken },
      { loggedDate: '2026-01-02', mealType: 'lunch', grams: 500, food: chicken },
      { loggedDate: '2026-01-03', mealType: 'lunch', grams: 500, food: chicken },
    ];
    const series = dailySeries(entries, '2026-01-01', '2026-01-03');
    const protein = adherence(series, TARGETS).find((m) => m.key === 'proteinG')!;
    expect(protein.activeDays).toBe(3);
    expect(protein.metDays).toBe(2);
    expect(protein.streak).toBe(2);
    expect(protein.pct).toBeCloseTo((2 / 3) * 100, 6);
  });
  it('breaks the streak on the most recent miss', () => {
    const entries: LogEntry[] = [
      { loggedDate: '2026-01-01', mealType: 'lunch', grams: 500, food: chicken }, // meet
      { loggedDate: '2026-01-02', mealType: 'lunch', grams: 200, food: chicken }, // miss (latest)
    ];
    const series = dailySeries(entries, '2026-01-01', '2026-01-02');
    const protein = adherence(series, TARGETS).find((m) => m.key === 'proteinG')!;
    expect(protein.streak).toBe(0);
  });
});

describe('macroSplit', () => {
  it('splits calories 4/4/9 and sums to ~100', () => {
    const split = macroSplit({
      calories: 0,
      proteinG: 25,
      carbsG: 25,
      fatG: 10,
      fiberG: 0,
      sodiumMg: 0,
      cost: 0,
    });
    // P 100kcal, C 100kcal, F 90kcal => 290 total
    expect(split.protein).toBeCloseTo((100 / 290) * 100, 6);
    expect(split.fat).toBeCloseTo((90 / 290) * 100, 6);
    expect(split.protein + split.carbs + split.fat).toBeCloseTo(100, 6);
  });
  it('is all zeros when there are no macros', () => {
    expect(macroSplit({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 0, cost: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe('mealTypeBreakdown', () => {
  it('groups totals by meal type in fixed order', () => {
    const entries: LogEntry[] = [
      { loggedDate: '2026-01-01', mealType: 'breakfast', grams: 100, food: rice },
      { loggedDate: '2026-01-01', mealType: 'dinner', grams: 100, food: chicken },
    ];
    const rows = mealTypeBreakdown(entries);
    expect(rows.map((r) => r.key)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(rows[0].totals.calories).toBeCloseTo(130, 6);
    expect(rows[1].totals.calories).toBe(0); // no lunch
    expect(rows[2].totals.calories).toBeCloseTo(165, 6);
  });
});

describe('value metrics', () => {
  it('costPer1000Kcal and costPerGramProtein compute from totals', () => {
    // 100g chicken = 165 kcal, 31g protein, $1.00
    const t = { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0, sodiumMg: 74, cost: 1 };
    expect(costPer1000Kcal(t)).toBeCloseTo((1 / 165) * 1000, 6);
    expect(costPerGramProtein(t)).toBeCloseTo(1 / 31, 6);
  });
  it('returns 0 (unknown) when price or the denominator is 0', () => {
    const noPrice = { calories: 165, proteinG: 31, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 0, cost: 0 };
    expect(costPer1000Kcal(noPrice)).toBe(0);
    expect(costPerGramProtein(noPrice)).toBe(0);
    const noProtein = { calories: 100, proteinG: 0, carbsG: 25, fatG: 0, fiberG: 0, sodiumMg: 0, cost: 0.5 };
    expect(costPerGramProtein(noProtein)).toBe(0);
  });
  it('proteinPerDollar is 0 for an unpriced food', () => {
    expect(proteinPerDollar(chicken)).toBeCloseTo(31, 6); // 31g / $1
    expect(proteinPerDollar(water)).toBe(0);
  });
});

describe('aggregateFoods + leaderboards', () => {
  const entries: LogEntry[] = [
    { loggedDate: '2026-01-01', mealType: 'lunch', grams: 100, food: chicken },
    { loggedDate: '2026-01-02', mealType: 'lunch', grams: 200, food: chicken },
    { loggedDate: '2026-01-02', mealType: 'dinner', grams: 300, food: rice },
  ];
  it('rolls up count, grams and totals per food', () => {
    const aggs = aggregateFoods(entries);
    const c = aggs.find((a) => a.id === 'chicken')!;
    expect(c.count).toBe(2);
    expect(c.grams).toBe(300);
    expect(c.totals.calories).toBeCloseTo(495, 6); // 165 * 3
    expect(c.totals.cost).toBeCloseTo(3, 6); // 300g * $0.01/g
  });
  it('rankBy sorts descending and limits', () => {
    const aggs = aggregateFoods(entries);
    const top = rankBy(aggs, (a) => a.totals.calories, 1);
    expect(top).toHaveLength(1);
    expect(top[0].id).toBe('chicken');
  });
  it('spendByBrand groups priced cost by brand, sorted', () => {
    const rows = spendByBrand(entries);
    expect(rows[0]).toEqual({ brand: 'MembersMark', cost: 3 }); // 300g chicken
    expect(rows[1]).toEqual({ brand: 'Royal', cost: expect.closeTo(0.6, 6) }); // 300g rice
  });
});

describe('mealComparison', () => {
  it('sums each meal template independently', () => {
    const meals = [
      { id: 'm1', name: 'Bulk Bowl' },
      { id: 'm2', name: 'Empty' },
    ];
    const items = [
      { mealId: 'm1', grams: 200, food: chicken },
      { mealId: 'm1', grams: 100, food: rice },
    ];
    const rows = mealComparison(meals, items);
    const bowl = rows.find((r) => r.id === 'm1')!;
    expect(bowl.itemCount).toBe(2);
    expect(bowl.totals.calories).toBeCloseTo(460, 6); // 330 + 130
    expect(rows.find((r) => r.id === 'm2')!.totals.calories).toBe(0);
  });
});

describe('naturalHeadline', () => {
  it('surfaces the cheapest protein when priced protein exists', () => {
    const entries: LogEntry[] = [
      { loggedDate: '2026-01-01', mealType: 'lunch', grams: 100, food: chicken },
    ];
    const series = dailySeries(entries, '2026-01-01', '2026-01-01');
    // 100g chicken: $1.00 / 31g = $0.032/g
    expect(naturalHeadline(entries, series, '$')).toBe('Cheapest protein this period: Chicken Breast — $0.03/g');
  });
  it('falls back to a nudge when there is nothing logged', () => {
    const series = dailySeries([], '2026-01-01', '2026-01-07');
    expect(naturalHeadline([], series, '$')).toBe('Log a few days to unlock your insights.');
  });
});
