import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { dailyLogs, foodItems, mealItems } from '@/db/schema';
import { isSupabaseConfigured } from '@/lib/supabase';
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
 * Stable, deterministic id for a shared-catalog seed food. Seed names are unique
 * snake_case slugs, so `seed-<name>` is stable across installs AND matches the id
 * the server-side seed uses — so a local seed row and the cloud's shared row dedupe
 * by primary key when sync pulls the catalog. Keep this in lockstep with the
 * server seed (see `supabase/seed.sql`).
 */
export function seedFoodId(name: string): string {
  return `seed-${name}`;
}

/**
 * Import the bundled seed catalog as SHARED rows (`user_id = NULL`, `is_custom = false`).
 * Maps the seed column names to the schema:
 *   carbohydrates -> carbs_g, fats -> fat_g, price -> price_per_100.
 * sodium_mg defaults to 0 (absent in the old data). Skips ids already present.
 */
export async function importSeedCatalog(): Promise<{
  inserted: number;
  skipped: number;
}> {
  const rows = seed as SeedRow[];
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = seedFoodId(r.name);
    const existing = await db
      .select({ id: foodItems.id })
      .from(foodItems)
      .where(eq(foodItems.id, id));
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(foodItems).values({
      id,
      userId: null, // shared/global catalog row
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

/**
 * One-time cleanup for devices upgraded from an early build. That build seeded the shared
 * catalog with random `newId()` ids and deduped by NAME; the current code (and `supabase/seed.sql`)
 * key catalog rows by the stable `seed-<name>` id and dedupe by id. So after the first cloud pull
 * an upgraded device holds BOTH: ~24 legacy random-id rows AND the 24 canonical `seed-<name>` rows,
 * duplicated by name (all `user_id NULL`, `is_custom = false`) — the "47 foods for a new user" bug.
 *
 * The shared catalog on any device must be EXACTLY the cloud's canonical `seed-<name>` rows. So any
 * live shared row whose id does not start with `seed-` is pre-account legacy cruft (the app only
 * ever creates `seed-<name>` shared rows; anything else was a random-id row from the old build,
 * possibly since edited/renamed). Soft-delete each such legacy row. When a canonical twin
 * (`seed-<name>` for the same name) is present, first repoint any meal_items / daily_logs that
 * reference the legacy row onto that twin (both FKs are `onDelete: 'restrict'`, so we must remap
 * before removing). A legacy row with no twin (edited/renamed, e.g. a modified almonds) is
 * soft-deleted with no remap — past meals/logs still resolve it because the catalog joins don't
 * filter `deleted` (`mealItemsQuery`/`dayLogsQuery` in `db/queries.ts`), so history is preserved;
 * the row just leaves the catalog list.
 *
 * Idempotent — a no-op once no non-`seed-` shared row remains, and on fresh installs. Runs AFTER
 * the initial sync pull so the canonical rows are present locally to remap onto. Returns rows
 * collapsed. Legacy rows are `user_id NULL`, so soft-deleting them pushes nothing (push is
 * owner-scoped); the remapped meal_items/daily_logs DO push, repointing history at the canonical id.
 */
export async function dedupeSharedCatalog(): Promise<number> {
  const now = new Date().toISOString();
  // All live shared catalog rows (NULL owner, not a private custom food).
  const rows = await db
    .select({ id: foodItems.id, name: foodItems.name })
    .from(foodItems)
    .where(and(isNull(foodItems.userId), eq(foodItems.isCustom, false), eq(foodItems.deleted, false)));

  const canonicalIds = new Set(rows.map((r) => r.id).filter((id) => id.startsWith('seed-')));

  let collapsed = 0;
  for (const row of rows) {
    // Canonical rows (id `seed-<name>`) are the cloud catalog — always keep. Everything else is
    // legacy cruft to remove (prefix check, not name match, so an edited canonical row is safe).
    if (row.id.startsWith('seed-')) continue;

    // If a canonical twin for this name is present, repoint references onto it before removing
    // (FK is restrict). No twin (edited/renamed row) → soft-delete only; joins still resolve it.
    const canonicalId = seedFoodId(row.name);
    if (canonicalIds.has(canonicalId)) {
      await db
        .update(mealItems)
        .set({ foodItemId: canonicalId, updatedAt: now })
        .where(eq(mealItems.foodItemId, row.id));
      await db
        .update(dailyLogs)
        .set({ foodItemId: canonicalId, updatedAt: now })
        .where(eq(dailyLogs.foodItemId, row.id));
    }
    // Soft-delete the legacy row (never hard-delete).
    await db
      .update(foodItems)
      .set({ deleted: true, updatedAt: now })
      .where(eq(foodItems.id, row.id));
    collapsed++;
  }
  return collapsed;
}

/**
 * Local-only fallback seeding. When cloud sync is configured the shared catalog is
 * delivered by the initial sync pull, so we DON'T seed locally (that would create a
 * second, unsynced copy). Only when Supabase is absent (pure local-first, no account)
 * do we pre-load the starter foods so the app is usable standalone.
 */
export async function seedIfEmpty(): Promise<void> {
  if (isSupabaseConfigured) return; // catalog arrives via sync pull after login
  const any = await db.select({ id: foodItems.id }).from(foodItems).limit(1);
  if (any.length === 0) {
    await importSeedCatalog();
  }
}
