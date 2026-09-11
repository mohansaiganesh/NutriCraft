/**
 * Tolerant, model-agnostic food-name matching.
 *
 * The assistant's `search_foods` and the Foods-tab search box both need to find a food regardless of
 * how the query is spelled relative to how the food was stored — `"sunflower seeds"`,
 * `"sunflowerSeeds"`, `"Sunflower-Seeds"` and `"seeds sunflower"` should all find the same row. We do
 * that by reducing both sides to a canonical form and matching on that, instead of a raw SQL
 * `LIKE '%term%'` that only matches an identical character run.
 *
 * This module is pure and imports NO React Native code (like `lib/nutrition.ts`), so it stays
 * jest-testable without pulling in `db/queries` → RN. It is deliberately typo-INTOLERANT: it
 * normalizes away spacing/case/punctuation/word-order, but does no fuzzy/edit-distance matching, so
 * it never invents matches the user didn't ask for.
 */

/** Lowercase, strip diacritics, and keep only [a-z0-9] — drops all spacing, punctuation and case.
 * `"Sunflower Seeds"`, `"sunflowerSeeds"` and `"sunflower-seeds"` all collapse to `"sunflowerseeds"`. */
export function squash(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Split into normalized word tokens on whitespace, punctuation AND camelCase boundaries.
 * `"sunflowerSeeds"` → `["sunflower", "seeds"]`; `"Sunflower Seeds"` → `["sunflower", "seeds"]`. */
export function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // break camelCase before lowercasing
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Rank how well `query` matches a food's `name` (+ optional `brand`), or `null` for no match.
 *
 * A food matches when the squashed query is a substring of the squashed name+brand, OR every query
 * token appears in it (which covers reordered / extra words). Higher score = better: exact name ›
 * name-prefix › substring-in-name › tokens-in-name › matched only via brand. Substring semantics
 * mirror the old `LIKE '%term%'` (so `"rice"` still matches `"price"`), but ranking sinks those
 * incidental hits below real matches.
 */
export function scoreFood(query: string, name: string, brand?: string | null): number | null {
  const sq = squash(query);
  const qTokens = tokens(query);
  if (!sq && qTokens.length === 0) return 0; // empty query: neutral rank, matches everything

  const sName = squash(name);
  const sText = sName + squash(brand ?? ''); // combined for the brand-inclusive fallback

  const inName = sq !== '' && sName.includes(sq);
  const inText = sq !== '' && sText.includes(sq);
  const tokensInName = qTokens.length > 0 && qTokens.every((t) => sName.includes(t));
  const tokensInText = qTokens.length > 0 && qTokens.every((t) => sText.includes(t));

  if (!inText && !tokensInText) return null;

  if (sq !== '' && sName === sq) return 100; // exact (ignoring spacing/case/punctuation)
  if (inName && sName.startsWith(sq)) return 90; // name begins with the query
  if (inName) return 80; // query is somewhere in the name
  if (tokensInName) return 70; // all query words are in the name, any order
  return 40; // matched only through the brand
}

/**
 * Filter + rank a list of foods by `query`, best match first. An empty/whitespace query returns the
 * list unchanged (callers treat empty as "list everything"). Ties break by shorter name, then
 * alphabetically, so the tightest match surfaces first.
 */
export function matchFoods<T extends { name: string; brand?: string | null }>(
  query: string,
  items: T[]
): T[] {
  const q = query.trim();
  if (!q) return items;
  const scored: { item: T; score: number; name: string }[] = [];
  for (const item of items) {
    const score = scoreFood(q, item.name, item.brand);
    if (score === null) continue;
    scored.push({ item, score, name: item.name });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name)
  );
  return scored.map((s) => s.item);
}
