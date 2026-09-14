/**
 * Google Gemini adapter for the neutral `LlmClient` contract.
 *
 * Talks to the Generative Language API `generateContent` endpoint with function calling, converting
 * the neutral conversation/tool shapes (`provider.ts`) to Gemini's `contents`/`functionDeclarations`
 * wire format and back. The user's own free-tier API key is sent per request — never bundled or synced.
 *
 * Also implements the optional explicit-cache capability (`ensureCache`/`invalidateCache`) using
 * Gemini `cachedContents` resources for the stable prompt prefix.
 *
 * Like `lib/foodSearch.ts`, `call` never throws — it returns a DISCRIMINATED result so the UI can tell
 * a bad key from a rate-limit from an offline device.
 */
import type {
  EnsureCacheOpts,
  JsonSchema,
  LlmCallOpts,
  LlmClient,
  LlmMessage,
  LlmResponsePart,
  LlmResult,
  LlmToolDecl,
  LlmUsage,
  ProviderMeta,
} from '../provider';
import { hash } from '../hash';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 30_000; // LLM calls are slower than the 6s food-search bound.
const MAX_RETRIES = 2; // extra attempts on transient 5xx (Gemini function calling 500s intermittently).

// ------------------------------------------------------------------ wire types (Gemini)

/** Fields Gemini may put beside any part. Thinking models (Gemini 3.x) sign their function calls with a
 * `thoughtSignature` that MUST be sent back verbatim on the next turn, or the request 400s. */
interface GeminiPartExtras {
  thoughtSignature?: string;
}

type GeminiPart = GeminiPartExtras &
  (
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown>; id?: string } }
    | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } }
  );

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

// ------------------------------------------------------------------ neutral ⇄ Gemini converters

/** JSON Schema `type` → Gemini's OpenAPI-subset enum (uppercase). */
const GEMINI_TYPE: Record<JsonSchema['type'], string> = {
  object: 'OBJECT',
  string: 'STRING',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
};

/** Recursively convert a neutral JSON Schema to Gemini's dialect (uppercased `type`, nested walk). */
function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: GEMINI_TYPE[s.type] };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.required) out.required = s.required;
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

/** Neutral tool declarations → Gemini `functionDeclarations`. */
function toGeminiTools(tools: LlmToolDecl[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(t.parameters ? { parameters: toGeminiSchema(t.parameters) } : {}),
  }));
}

/** Re-attach the signature stashed in a neutral part's opaque `providerMeta`. */
function extrasFromMeta(meta: ProviderMeta | undefined): GeminiPartExtras {
  return typeof meta?.thoughtSignature === 'string' ? { thoughtSignature: meta.thoughtSignature } : {};
}

/** Stash a response part's signature in the neutral part's opaque `providerMeta`. */
function metaFromExtras(p: GeminiPartExtras): { providerMeta?: ProviderMeta } {
  return typeof p.thoughtSignature === 'string' ? { providerMeta: { thoughtSignature: p.thoughtSignature } } : {};
}

/** Neutral messages → Gemini `contents`. Signatures are re-attached beside the part they came with. */
function toGeminiContents(messages: LlmMessage[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.parts.map((p): GeminiPart => {
      if (p.type === 'text') return { text: p.text, ...extrasFromMeta(p.providerMeta) };
      if (p.type === 'toolCall')
        return {
          functionCall: { name: p.name, args: p.args, ...(p.id ? { id: p.id } : {}) },
          ...extrasFromMeta(p.providerMeta),
        };
      return { functionResponse: { name: p.name, response: p.response, ...(p.id ? { id: p.id } : {}) } };
    }),
  }));
}

/** Gemini response parts → neutral response parts (text + tool calls). Order is preserved and each
 * part keeps its own signature — with parallel calls only the first one is signed. (We don't request
 * thought summaries, so no `thought: true` parts come back.) */
function fromGeminiParts(parts: GeminiPart[]): LlmResponsePart[] {
  const out: LlmResponsePart[] = [];
  for (const p of parts) {
    if ('text' in p) out.push({ type: 'text', text: p.text, ...metaFromExtras(p) });
    else if ('functionCall' in p)
      out.push({
        type: 'toolCall',
        id: p.functionCall.id,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
        ...metaFromExtras(p),
      });
    // functionResponse never appears in a model response.
  }
  return out;
}

// ------------------------------------------------------------------ explicit cache

const TTL_SECONDS = 600; // resource lifetime; kept short so idle storage cost stays negligible.
const SAFETY_MS = 30_000; // stop reusing a memo this long before its TTL ends, to dodge mid-call expiry.
const CREATE_TIMEOUT_MS = 10_000;
const NEGATIVE_COOLOFF_MS = 5 * 60_000; // after a create is refused, don't retry that key for a while.

interface CacheMemo {
  key: string;
  name: string; // e.g. "cachedContents/abc123"
  expiresAt: number;
}

let memo: CacheMemo | null = null;
const negative = new Map<string, number>(); // key → epoch ms until which creation is skipped

/** Identity of a cache entry — a change in model, key, or systemInstruction forces a fresh resource.
 * (The tool set is static, so it isn't part of the key.) Exported for the cache unit test. */
export function cacheMemoKey(model: string, apiKey: string, systemInstruction: string): string {
  return `${model}|${hash(apiKey)}|${hash(systemInstruction)}`;
}

/** A memo is usable if it's for the same key and still comfortably inside its TTL. Exported for tests. */
export function isMemoFresh(m: CacheMemo | null, key: string, now: number): boolean {
  return m != null && m.key === key && now < m.expiresAt - SAFETY_MS;
}

// ------------------------------------------------------------------ helpers

/** True when a 4xx looks like the referenced cache expired/vanished, so the caller can retry uncached. */
function isCacheInvalidError(status: number, message: string): boolean {
  if (status !== 400 && status !== 403 && status !== 404) return false;
  return /cache/i.test(message);
}

/** True when a 4xx is about the API key itself: 401, 403, or a 400 whose message names the key
 * (Gemini reports an invalid key as 400 `API_KEY_INVALID` / "API key not valid"). */
function isKeyError(status: number, message: string): boolean {
  if (status === 401 || status === 403) return true;
  return status === 400 && /api[ _]?key|API_KEY_INVALID|PERMISSION_DENIED|unauthenticated/i.test(message);
}

/** Sleep that rejects early if the external signal aborts during a retry backoff. */
function backoff(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

// ------------------------------------------------------------------ the client

async function call(opts: LlmCallOpts): Promise<LlmResult> {
  const url = `${GEMINI_BASE}/models/${opts.model}:generateContent`;
  const contents = toGeminiContents(opts.messages);

  // Retry loop: Gemini function calling 500s intermittently on multi-turn tool use. We retry ONLY
  // genuine 5xx (they come back fast); 4xx/auth/429 and network/timeout failures return immediately.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      // With an explicit cache, the systemInstruction + tools already live in the resource and Gemini
      // rejects sending them again — reference the cache instead. Otherwise send the full prompt.
      const body = opts.cachedContent
        ? { contents, cachedContent: opts.cachedContent }
        : {
            systemInstruction: { parts: [{ text: opts.systemInstruction }] },
            contents,
            tools: [{ functionDeclarations: toGeminiTools(opts.tools) }],
          };
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      const aborted = opts.signal?.aborted;
      return {
        ok: false,
        error: {
          kind: 'network',
          message: aborted ? 'Request cancelled.' : 'Network request failed — check your connection.',
        },
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      try {
        const errBody = await res.json();
        message = errBody?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        if (opts.cachedContent && isCacheInvalidError(res.status, message)) {
          return { ok: false, error: { kind: 'api', message, cacheInvalid: true } };
        }
        // Only a genuine key problem is `auth`; a malformed request (e.g. a missing thought signature)
        // is a 400 too, and must surface its real message instead of a "your key was rejected" card.
        if (isKeyError(res.status, message)) return { ok: false, error: { kind: 'auth', message } };
        return { ok: false, error: { kind: 'api', message } };
      }
      if (res.status === 429) return { ok: false, error: { kind: 'rate_limit', message } };
      if (res.status >= 500 && attempt < MAX_RETRIES && !opts.signal?.aborted) {
        const delayMs = 500 * 2 ** attempt + Math.random() * 250;
        try {
          opts.onRetry?.({ attempt: attempt + 1, delayMs, status: res.status });
        } catch {
          /* a throwing observer must never break the retry path */
        }
        try {
          await backoff(delayMs, opts.signal);
          continue;
        } catch {
          return { ok: false, error: { kind: 'network', message: 'Request cancelled.' } };
        }
      }
      return { ok: false, error: { kind: 'api', message } };
    }

    try {
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) {
        const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
        return {
          ok: false,
          error: { kind: 'bad_response', message: reason ? `No answer returned (${reason}).` : 'Empty response from Gemini.' },
        };
      }
      const u = data?.usageMetadata;
      const usage: LlmUsage | undefined = u
        ? {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            totalTokens: u.totalTokenCount ?? 0,
            cachedTokens: u.cachedContentTokenCount ?? 0,
          }
        : undefined;
      return {
        ok: true,
        parts: fromGeminiParts(parts as GeminiPart[]),
        usage,
        finishReason: data?.candidates?.[0]?.finishReason,
      };
    } catch {
      return { ok: false, error: { kind: 'bad_response', message: 'Could not read the Gemini response.' } };
    }
  }
}

/**
 * Return a `cachedContents` resource name to reference for this (model, key, systemInstruction, tools),
 * or `null` to signal the caller should send the full prompt. Reuses a live resource when possible;
 * otherwise tries to create one, remembering a refusal so we don't hammer a key that can't cache.
 * Never throws — a caching hiccup must never break a chat turn.
 */
async function ensureCache(opts: EnsureCacheOpts): Promise<string | null> {
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
        tools: [{ functionDeclarations: toGeminiTools(opts.tools) }],
        ttl: `${TTL_SECONDS}s`,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 400/403 = unsupported tier or below the min-token floor: this key can't do explicit caching.
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
function invalidateCache(): void {
  memo = null;
}

export const googleClient: LlmClient = {
  provider: 'google',
  call,
  ensureCache,
  invalidateCache,
};
