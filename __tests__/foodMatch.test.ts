/**
 * Tolerant food matching (lib/foodMatch): the query and the stored name are reduced to a canonical
 * form so spacing, casing, punctuation and word order don't decide a match — the fix for Nico (and
 * the Foods tab) missing a food stored as "sunflowerSeeds" when the user typed "sunflower seeds".
 * Pure module, no RN — runs straight under jest.
 */
import { squash, tokens, scoreFood, matchFoods } from '@/lib/foodMatch';

describe('squash', () => {
  it('collapses spacing, case and punctuation to one canonical run', () => {
    expect(squash('Sunflower Seeds')).toBe('sunflowerseeds');
    expect(squash('sunflowerSeeds')).toBe('sunflowerseeds');
    expect(squash('sunflower-seeds')).toBe('sunflowerseeds');
    expect(squash('  Sunflower,  Seeds! ')).toBe('sunflowerseeds');
  });

  it('strips diacritics', () => {
    expect(squash('Jalapeño')).toBe('jalapeno');
    expect(squash('Café')).toBe('cafe');
  });
});

describe('tokens', () => {
  it('splits on whitespace, punctuation AND camelCase boundaries', () => {
    expect(tokens('sunflowerSeeds')).toEqual(['sunflower', 'seeds']);
    expect(tokens('Sunflower Seeds')).toEqual(['sunflower', 'seeds']);
    expect(tokens('sunflower-seeds')).toEqual(['sunflower', 'seeds']);
  });

  it('drops empties', () => {
    expect(tokens('  ,  ')).toEqual([]);
  });
});

describe('scoreFood', () => {
  it('matches across spacing/case/punctuation differences', () => {
    expect(scoreFood('sunflower seeds', 'sunflowerSeeds')).not.toBeNull();
    expect(scoreFood('sunflower seeds', 'Sunflower-Seeds')).not.toBeNull();
    expect(scoreFood('SUNFLOWERSEEDS', 'Sunflower Seeds')).not.toBeNull();
  });

  it('matches regardless of word order', () => {
    expect(scoreFood('seeds sunflower', 'Sunflower Seeds')).not.toBeNull();
  });

  it('can match via the brand', () => {
    expect(scoreFood('trader', 'Almond Butter', "Trader Joe's")).not.toBeNull();
  });

  it('returns null for a clear non-match', () => {
    expect(scoreFood('salmon', 'Sunflower Seeds')).toBeNull();
  });

  it('ranks exact above prefix above mid-substring', () => {
    const exact = scoreFood('sunflower seeds', 'Sunflower Seeds')!;
    const prefix = scoreFood('sunflower', 'Sunflower Seeds')!;
    const mid = scoreFood('seeds', 'Sunflower Seeds')!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(mid);
  });

  it('ranks a name match above a brand-only match', () => {
    const nameHit = scoreFood('butter', 'Almond Butter', 'Generic')!;
    const brandHit = scoreFood('trader', 'Almond Butter', "Trader Joe's")!;
    expect(nameHit).toBeGreaterThan(brandHit);
  });
});

describe('matchFoods', () => {
  const foods = [
    { name: 'Sunflower Seeds', brand: null },
    { name: 'sunflowerSeeds oil', brand: null },
    { name: 'Pumpkin Seeds', brand: null },
    { name: 'Chicken Breast', brand: null },
  ];

  it('finds every spelling variant of the query, best match first', () => {
    const out = matchFoods('sunflower seeds', foods);
    expect(out.map((f) => f.name)).toEqual(['Sunflower Seeds', 'sunflowerSeeds oil']);
    expect(out[0].name).toBe('Sunflower Seeds'); // exact ranks ahead of the longer partial
  });

  it('drops non-matches', () => {
    const out = matchFoods('chicken', foods);
    expect(out.map((f) => f.name)).toEqual(['Chicken Breast']);
  });

  it('passes the list through unchanged for an empty query', () => {
    expect(matchFoods('   ', foods)).toBe(foods);
  });
});
