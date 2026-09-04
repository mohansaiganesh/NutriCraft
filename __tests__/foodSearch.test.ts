import { mapOffProduct, mapUsdaFood, type FdcFood, type OffProduct } from '@/lib/foodSearch';

describe('mapOffProduct', () => {
  it('maps a full Open Food Facts product to a per-100 RemoteFood', () => {
    const product: OffProduct = {
      code: '3017620422003',
      product_name: 'Nutella',
      brands: 'Ferrero, Nutella',
      serving_quantity: 15,
      nutriments: {
        'energy-kcal_100g': 539,
        'proteins_100g': 6.3,
        'carbohydrates_100g': 57.5,
        'fat_100g': 30.9,
        'fiber_100g': 0,
        'sodium_100g': 0.0428, // grams per 100g
      },
    };

    const r = mapOffProduct(product);
    expect(r).not.toBeNull();
    expect(r!.remoteId).toBe('3017620422003');
    expect(r!.source).toBe('off');
    expect(r!.name).toBe('Nutella');
    expect(r!.brand).toBe('Ferrero'); // first brand only
    expect(r!.barcode).toBe('3017620422003');
    expect(r!.servingSizeG).toBe(15);
    expect(r!.basis.calories).toBe(539);
    expect(r!.basis.proteinG).toBe(6.3);
    expect(r!.basis.carbsG).toBe(57.5);
    expect(r!.basis.fatG).toBe(30.9);
    expect(r!.basis.fiberG).toBe(0);
    expect(r!.basis.sodiumMg).toBeCloseTo(42.8); // 0.0428 g → 42.8 mg
    expect(r!.basis.pricePer100).toBe(0); // OFF has no price
  });

  it('defaults missing nutriments to 0 and serving to 100', () => {
    const product: OffProduct = {
      code: '0000000000001',
      product_name: 'Mystery snack',
      nutriments: {},
    };

    const r = mapOffProduct(product);
    expect(r).not.toBeNull();
    expect(r!.servingSizeG).toBe(100);
    expect(r!.brand).toBe('Generic');
    expect(r!.basis).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 0,
      pricePer100: 0,
    });
  });

  it('returns null for a product with no usable name', () => {
    expect(mapOffProduct({ code: '123', product_name: '   ' })).toBeNull();
    expect(mapOffProduct({ code: '123' })).toBeNull();
  });

  it('falls back to the name as remoteId when there is no barcode', () => {
    const r = mapOffProduct({ product_name: 'Homemade dal' });
    expect(r).not.toBeNull();
    expect(r!.barcode).toBeNull();
    expect(r!.remoteId).toBe('Homemade dal');
  });
});

describe('mapUsdaFood', () => {
  it('maps a full FDC food (nutrient-id array) to a per-100 RemoteFood', () => {
    const food: FdcFood = {
      fdcId: 171077,
      description: 'Chicken, broilers or fryers, breast, meat only, raw',
      foodNutrients: [
        { nutrientId: 1008, value: 120 }, // Energy kcal
        { nutrientId: 1003, value: 22.5 }, // Protein
        { nutrientId: 1005, value: 0 }, // Carbs
        { nutrientId: 1004, value: 2.6 }, // Fat
        { nutrientId: 1079, value: 0 }, // Fiber
        { nutrientId: 1093, value: 45 }, // Sodium (mg — already)
        { nutrientId: 9999, value: 1 }, // unrelated nutrient, ignored
      ],
    };

    const r = mapUsdaFood(food);
    expect(r).not.toBeNull();
    expect(r!.source).toBe('usda');
    expect(r!.remoteId).toBe('usda-171077');
    expect(r!.name).toBe('Chicken, broilers or fryers, breast, meat only, raw');
    expect(r!.brand).toBe('Generic');
    expect(r!.barcode).toBeNull();
    expect(r!.servingSizeG).toBe(100);
    expect(r!.basis.calories).toBe(120);
    expect(r!.basis.proteinG).toBe(22.5);
    expect(r!.basis.carbsG).toBe(0);
    expect(r!.basis.fatG).toBe(2.6);
    expect(r!.basis.fiberG).toBe(0);
    expect(r!.basis.sodiumMg).toBe(45); // stays mg — NOT ×1000
    expect(r!.basis.pricePer100).toBe(0);
  });

  it('defaults missing nutrients to 0', () => {
    const r = mapUsdaFood({ fdcId: 1, description: 'Mystery food', foodNutrients: [] });
    expect(r).not.toBeNull();
    expect(r!.basis).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 0,
      pricePer100: 0,
    });
  });

  it('returns null for a food with no usable description', () => {
    expect(mapUsdaFood({ fdcId: 1, description: '  ' })).toBeNull();
    expect(mapUsdaFood({ fdcId: 1 })).toBeNull();
  });
});
