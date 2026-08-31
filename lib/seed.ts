import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { foodItems } from '@/db/schema';
import { newId } from '@/lib/id';
import seed from '@/assets/data/food_data.seed.json';

/** Shape of a bundled seed-catalog row (values already per-100). */
interface SeedRow {
  name: string;
  protein: number;
  carbohydrates: number;
  fats: number;
  fiber: number;
  calories: number;
  price: number;
  sodium?: number;
}

/**
 * Import the bundled seed catalog. Maps the seed column names to the schema:
 *   carbohydrates -> carbs_g, fats -> fat_g, price -> price_per_100.
 * sodium_mg defaults to 0 (absent in the old data). Skips names already present.
 */
export async function importSeedCatalog(): Promise<{
  inserted: number;
  skipped: number;
}> {
  const rows = seed as SeedRow[];
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = await db
      .select({ id: foodItems.id })
      .from(foodItems)
      .where(eq(foodItems.name, r.name));
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(foodItems).values({
      id: newId(),
      name: r.name,
      brand: 'Generic',
      servingSizeG: 100,
      calories: r.calories,
      proteinG: r.protein,
      carbsG: r.carbohydrates,
      fatG: r.fats,
      fiberG: r.fiber,
      sodiumMg: r.sodium ?? 0,
      pricePer100: r.price,
      isCustom: false,
    });
    inserted++;
  }
  return { inserted, skipped };
}

/** On first launch (empty catalog), pre-load the starter foods. */
export async function seedIfEmpty(): Promise<void> {
  const any = await db.select({ id: foodItems.id }).from(foodItems).limit(1);
  if (any.length === 0) {
    await importSeedCatalog();
  }
}
