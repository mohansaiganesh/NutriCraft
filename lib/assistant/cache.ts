/**
 * Explicit Gemini context caching for the assistant's stable prompt prefix.
 *
 * On every round of the tool loop, `callGemini` would otherwise re-send the full systemInstruction
 * plus the entire tool-declaration block. When the user has explicit caching ON (a toggle in the
 * chat), we create ONE `cachedContents` resource holding that prefix and reference it by name on
 * subsequent calls — so the prefix is transmitted (and billed at full rate) once, not once per round
 * and per question.
 *
 * Best-effort by design: explicit caching needs a billing-enabled key and a minimum-token prefix, so
 * creation can legitimately fail (free-tier / below the floor). Every failure resolves to `null`, and
 * the caller falls back to sending the full prompt (implicit caching still applies automatically).
 * Nothing here ever throws — a caching hiccup must never break a chat turn.
 *
 * The resource is memoized at module scope and reused across rounds AND across questions until its
 * TTL nears expiry — that reuse is where the saving actually lands.
 */
import { ALL_FUNCTION_DECLARATIONS, GEMINI_BASE } from './gemini';

const TTL_SECONDS = 600; // resource lifetime; kept short so idle storage cost stays negligible.
const SAFETY_MS = 30_000; // stop reusing a memo this long before its TTL ends, to dodge mid-call expiry.
const CREATE_TIMEOUT_MS = 10_000;
const NEGATIVE_COOLOFF_MS = 5 * 60_000; // after a create is refused, don't retry that key for a while.

/** A live cached-content resource we can reference. */
interface CacheMemo {
  key: string; // identity of what's cached — see cacheMemoKey()
  name: string; // the Gemini resource name, e.g. "cachedContents/abc123"
  expiresAt: number; // epoch ms when the TTL runs out
}

let memo: CacheMemo | null = null;
/** key → epoch ms until which we stop attempting to create (a prior create was refused). */
const negative = new Map<string, number>();

/** Cheap, stable, non-cryptographic hash — enough to detect "the prompt/key/model changed". */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Identity of a cache entry. Any change forces a fresh resource: a different model, a different key
 * (different project/quota), or a changed systemInstruction — which includes the daily date stamp
 * in buildSystemPrompt(), so a day rollover naturally re-caches.
 */
export function cacheMemoKey(model: string, apiKey: string, systemInstruction: string): string {
  return `${model}|${hash(apiKey)}|${hash(systemInstruction)}`;
}

/** A memo is usable if it's for the same key and still comfortably inside its TTL. */
export function isMemoFresh(m: CacheMemo | null, key: string, now: number): boolean {
  return m != null && m.key === key && now < m.expiresAt - SAFETY_MS;
}

/**
 * Return a `cachedContents` resource name to reference for this (model, key, systemInstruction), or
 * `null` to signal the caller should send the full prompt. Reuses a live resource when possible;
 * otherwise tries to create one, remembering a refusal so we don't hammer a key that can't cache.
 */
export async function ensureCachedContent(opts: {
  apiKey: string;
  model: string;
  systemInstruction: string;
}): Promise<string | null> {
  const key = cacheMemoKey(opts.model, opts.apiKey, opts.systemInstruction);
  const now = Date.now();

  if (isMemoFresh(memo, key, now)) return memo!.name;

  const blockedUntil = negative.get(key);
  if (blockedUntil != null && now < blockedUntil) return null;
  if (blockedUntil != null) negative.delete(key); // cool-off elapsed — allow a retry

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_BASE}/cachedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        model: `models/${opts.model}`,
        systemInstruction: { parts: [{ text: opts.systemInstruction }] },
        tools: [{ functionDeclarations: ALL_FUNCTION_DECLARATIONS }],
        ttl: `${TTL_SECONDS}s`,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 400/403 = unsupported tier or below the min-token floor: this key can't do explicit caching,
      // so back off. (Other statuses just fall back this once.)
      if (res.status === 400 || res.status === 403) negative.set(key, Date.now() + NEGATIVE_COOLOFF_MS);
      return null;
    }
    const data = await res.json();
    const name: unknown = data?.name;
    if (typeof name !== 'string' || !name) return null;
    memo = { key, name, expiresAt: Date.now() + TTL_SECONDS * 1000 };
    return name;
  } catch {
    return null; // network / timeout / abort — implicit path handles it.
  } finally {
    clearTimeout(timer);
  }
}

/** Drop the memoized resource (e.g. after the server reported it expired mid-run). */
export function invalidateCache(): void {
  memo = null;
}
