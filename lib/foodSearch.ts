/**
 * External food sources: Open Food Facts + USDA FoodData Central.
 *
 * This is the seam for looking up foods that aren't in the local/shared catalog yet.
 * Each provider is `(query, signal) => Promise<RemoteFood[] | null>` and maps its results
 * onto the catalog's per-100 basis. The mappers (`mapOffProduct`, `mapUsdaFood`) are PURE
 * and import NO react-native code, so they stay jest-testable (same rule as `lib/nutrition.ts`).
 * The fetch wrappers never throw — a maintenance window, rate-limit, timeout, or offline
 * device resolves to `null` (a genuine outage) so local search is never blocked.
 *
 * OFF is strong on packaged/barcoded foods; USDA on generic whole foods. `FOOD_SOURCES`
 * lists the enabled providers (USDA only when its API key is configured); the search hook
 * queries them in parallel and merges.
 */
import type { PerHundredBasis } from './nutrition';

export type FoodSourceId = 'off' | 'usda';

/** Short tag shown on a remote result row. */
export const SOURCE_LABEL: Record<FoodSourceId, string> = {
  off: 'OFF',
  usda: 'USDA',
};

/** A food fetched from an external source, normalized to the catalog's per-100 basis. */
export interface RemoteFood {
  /** Stable id from the source (OFF `code`, or `usda-<fdcId>`) — used for React keys + dedupe. */
  remoteId: string;
  source: FoodSourceId;
  name: string;
  brand: string;
  /** Source barcode, if any. NOT persisted onto the private copy (see createFoodFromRemote). */
  barcode: string | null;
  servingSizeG: number;
  basis: PerHundredBasis;
}

const OFF_BASE = 'https://world.openfoodfacts.org';
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
// OFF asks clients to identify themselves; keep this descriptive and stable.
const USER_AGENT = 'NutriCraft/1.0 (React Native food tracker)';
const REQUEST_TIMEOUT_MS = 6000;

/** Coerce anything a source hands back into a finite, non-negative number (0 on failure). */
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Run a fetch with a hard timeout layered on top of the caller's abort signal, so a hung
 * endpoint can't stall forever. Returns the Response, or null on any failure/abort.
 */
async function timedFetch(url: string, signal: AbortSignal | undefined, headers: Record<string, string>) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { headers, signal: timeout.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** The subset of an OFF product record we read. */
export interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, unknown>;
}

/**
 * Map one Open Food Facts product to a RemoteFood.
 * OFF nutriment fields are already PER 100 g/ml (`*_100g`), matching PerHundredBasis directly.
 * Returns null for products with no usable name (unusable in the catalog).
 */
export function mapOffProduct(product: OffProduct): RemoteFood | null {
  const name = (product.product_name ?? '').trim();
  if (!name) return null;

  const n = product.nutriments ?? {};
  const basis: PerHundredBasis = {
    calories: toNum(n['energy-kcal_100g']),
    proteinG: toNum(n['proteins_100g']),
    carbsG: toNum(n['carbohydrates_100g']),
    fatG: toNum(n['fat_100g']),
    fiberG: toNum(n['fiber_100g']),
    // OFF reports sodium in grams per 100g; the catalog stores milligrams.
    sodiumMg: toNum(n['sodium_100g']) * 1000,
    pricePer100: 0, // OFF has no price; the user fills this in after saving.
  };

  const serving = toNum(product.serving_quantity);
  const code = (product.code ?? '').trim();
  const brand = (product.brands ?? '').split(',')[0]?.trim() || 'Generic';

  return {
    remoteId: code || name,
    source: 'off',
    name,
    brand,
    barcode: code || null,
    servingSizeG: serving > 0 ? serving : 100,
    basis,
  };
}

/**
 * Search Open Food Facts by name. Never throws. Resolves to:
 *   - `RemoteFood[]` (possibly empty) when the request completed — `[]` means "no matches".
 *   - `null` when the request genuinely FAILED (5xx maintenance, 429 rate-limit,
 *     abort/timeout, offline, bad JSON) — so callers can show an honest "couldn't reach"
 *     note instead of a misleading "no results".
 * Pass an AbortSignal to cancel in-flight requests when the query changes or the screen unmounts.
 */
export async function searchOpenFoodFacts(
  query: string,
  signal?: AbortSignal,
): Promise<RemoteFood[] | null> {
  const term = query.trim();
  if (!term) return [];

  const params = new URLSearchParams({
    search_terms: term,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '20',
    fields: 'code,product_name,brands,serving_quantity,nutriments',
  });
  const res = await timedFetch(`${OFF_BASE}/cgi/search.pl?${params.toString()}`, signal, {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  });
  if (!res || !res.ok) return null; // network error, 503 maintenance, 429 rate-limit, etc.
  try {
    const data = (await res.json()) as { products?: OffProduct[] };
    const products = Array.isArray(data.products) ? data.products : [];
    return products.map(mapOffProduct).filter((f): f is RemoteFood => f !== null);
  } catch {
    return null; // bad JSON — treat as an outage.
  }
}

// ---------------------------------------------------------------- USDA FoodData Central

// FDC nutrient ids (stable across the API). USDA reports per-100g for the generic data types
// we query, and — unlike OFF — sodium already in MILLIGRAMS.
const FDC_NUTRIENT = {
  calories: 1008, // Energy (kcal)
  proteinG: 1003, // Protein
  carbsG: 1005, // Carbohydrate, by difference
  fatG: 1004, // Total lipid (fat)
  fiberG: 1079, // Fiber, total dietary
  sodiumMg: 1093, // Sodium, Na (mg)
} as const;

/** One nutrient entry in an FDC search result. */
export interface FdcNutrient {
  nutrientId?: number;
  value?: number;
}

/** The subset of an FDC search food we read. */
export interface FdcFood {
  fdcId?: number;
  description?: string;
  foodNutrients?: FdcNutrient[];
}

/** Pull a per-100g nutrient value out of an FDC food's nutrient array by id (0 if absent). */
function usdaNutrient(nutrients: FdcNutrient[], id: number): number {
  const hit = nutrients.find((n) => n.nutrientId === id);
  return hit ? toNum(hit.value) : 0;
}

/**
 * Map one USDA FoodData Central food to a RemoteFood. Values are already PER 100 g for the
 * generic data types we query (Foundation / SR Legacy / Survey), and sodium is already in mg.
 * Returns null for a food with no usable description.
 */
export function mapUsdaFood(food: FdcFood): RemoteFood | null {
  const name = (food.description ?? '').trim();
  if (!name) return null;

  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const basis: PerHundredBasis = {
    calories: usdaNutrient(nutrients, FDC_NUTRIENT.calories),
    proteinG: usdaNutrient(nutrients, FDC_NUTRIENT.proteinG),
    carbsG: usdaNutrient(nutrients, FDC_NUTRIENT.carbsG),
    fatG: usdaNutrient(nutrients, FDC_NUTRIENT.fatG),
    fiberG: usdaNutrient(nutrients, FDC_NUTRIENT.fiberG),
    sodiumMg: usdaNutrient(nutrients, FDC_NUTRIENT.sodiumMg), // already mg — no ×1000.
    pricePer100: 0,
  };

  return {
    remoteId: `usda-${food.fdcId ?? name}`,
    source: 'usda',
    name,
    brand: 'Generic', // we query generic (non-branded) foods only
    barcode: null,
    servingSizeG: 100,
    basis,
  };
}

/** USDA is available only when a (free) FoodData Central API key is configured. */
export const usdaEnabled = !!process.env.EXPO_PUBLIC_FDC_API_KEY;

/**
 * Search USDA FoodData Central by name (generic foods only). Same contract as
 * searchOpenFoodFacts: never throws, `null` on a genuine failure (incl. a missing/invalid
 * key → 403). Returns `[]` when USDA isn't configured, so it silently contributes nothing.
 */
export async function searchUsda(query: string, signal?: AbortSignal): Promise<RemoteFood[] | null> {
  const term = query.trim();
  const key = process.env.EXPO_PUBLIC_FDC_API_KEY;
  if (!term || !key) return [];

  const params = new URLSearchParams({
    api_key: key,
    query: term,
    pageSize: '20',
    dataType: 'Foundation,SR Legacy,Survey (FNDDS)',
  });
  const res = await timedFetch(`${USDA_BASE}/foods/search?${params.toString()}`, signal, {
    Accept: 'application/json',
  });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { foods?: FdcFood[] };
    const foods = Array.isArray(data.foods) ? data.foods : [];
    return foods.map(mapUsdaFood).filter((f): f is RemoteFood => f !== null);
  } catch {
    return null;
  }
}

/**
 * The enabled external food providers, queried in parallel by `useFoodSearch`. OFF is always
 * on; USDA joins only when its API key is set. Order matters for cross-source dedupe — the
 * authoritative generic source (USDA) is listed first so it wins name ties over OFF.
 */
export const FOOD_SOURCES: {
  id: FoodSourceId;
  label: string;
  search: (query: string, signal?: AbortSignal) => Promise<RemoteFood[] | null>;
}[] = [
  ...(usdaEnabled ? [{ id: 'usda' as const, label: 'USDA', search: searchUsda }] : []),
  { id: 'off', label: 'Open Food Facts', search: searchOpenFoodFacts },
];
