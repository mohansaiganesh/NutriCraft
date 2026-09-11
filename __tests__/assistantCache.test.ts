/**
 * The pure, network-free helpers behind explicit prompt caching: how a cache entry's identity is
 * derived (so a changed model / key / system prompt forces a fresh resource) and when a memoized
 * resource is still safe to reuse. The fetch-driven create path is not exercised here.
 *
 * `cache.ts` imports only constants from `gemini.ts`, so it stays jest-testable without the RN /
 * expo-sqlite chain — mock `gemini` to keep it that way.
 */
jest.mock('@/lib/assistant/gemini', () => ({
  GEMINI_BASE: 'https://example.test/v1beta',
  ALL_FUNCTION_DECLARATIONS: [{ name: 'search_foods' }],
}));

import { cacheMemoKey, isMemoFresh } from '@/lib/assistant/cache';

describe('cacheMemoKey', () => {
  it('is stable for identical model + key + system prompt', () => {
    expect(cacheMemoKey('gemini-3.6-flash', 'key-A', 'You are Nico. Today is Monday.')).toBe(
      cacheMemoKey('gemini-3.6-flash', 'key-A', 'You are Nico. Today is Monday.')
    );
  });

  it('changes when the model changes', () => {
    const a = cacheMemoKey('gemini-3.6-flash', 'key-A', 'prompt');
    const b = cacheMemoKey('gemini-3.1-flash-lite', 'key-A', 'prompt');
    expect(a).not.toBe(b);
  });

  it('changes when the API key changes (different project/quota)', () => {
    const a = cacheMemoKey('m', 'key-A', 'prompt');
    const b = cacheMemoKey('m', 'key-B', 'prompt');
    expect(a).not.toBe(b);
  });

  it('changes when the system prompt changes (e.g. the daily date stamp rolls over)', () => {
    const mon = cacheMemoKey('m', 'k', 'You are Nico. Today is Monday, 2026-09-14.');
    const tue = cacheMemoKey('m', 'k', 'You are Nico. Today is Tuesday, 2026-09-15.');
    expect(mon).not.toBe(tue);
  });
});

describe('isMemoFresh', () => {
  const now = 1_000_000;
  const memo = { key: 'K', name: 'cachedContents/x', expiresAt: now + 600_000 };

  it('is false for a null memo', () => {
    expect(isMemoFresh(null, 'K', now)).toBe(false);
  });

  it('is false when the key differs (identity changed)', () => {
    expect(isMemoFresh(memo, 'OTHER', now)).toBe(false);
  });

  it('is true well inside the TTL for the same key', () => {
    expect(isMemoFresh(memo, 'K', now)).toBe(true);
  });

  it('is false once inside the safety margin before expiry', () => {
    // Within 30s of expiry — reuse is refused so a call never lands on a just-expired resource.
    expect(isMemoFresh(memo, 'K', memo.expiresAt - 10_000)).toBe(false);
  });
});
