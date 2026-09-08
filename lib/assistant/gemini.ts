/**
 * Minimal Gemini REST client for the in-app assistant.
 *
 * Talks to the Generative Language API `generateContent` endpoint with function-calling
 * enabled. The user's own free-tier API key (entered in Settings, stored in the device
 * keychain) is sent per request — no key is ever bundled or synced.
 *
 * Mirrors the never-throw + AbortController + timeout pattern from `lib/foodSearch.ts`, but
 * returns a DISCRIMINATED result so the UI can distinguish a bad key from a rate-limit from
 * an offline device (instead of silently swallowing everything).
 */
import { FUNCTION_DECLARATIONS } from './tools';

/** Models the user can pick in Settings — all served on the Generative Language API with
 * function calling + system instructions. Gemini 3.6 Flash is the reliable, current default
 * for tool calling; the Gemma 4 models are newer and can 500 on multi-turn tool use. */
export const AVAILABLE_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
];

/** Default model when the user hasn't picked one. Override via EXPO_PUBLIC_GEMINI_MODEL. */
export const DEFAULT_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 30_000; // LLM calls are slower than the 6s food-search bound.
const MAX_RETRIES = 2; // extra attempts on transient 5xx (Gemini function calling 500s intermittently).

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown>; id?: string } }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiErrorKind = 'auth' | 'rate_limit' | 'network' | 'bad_response' | 'api';
export interface GeminiError {
  kind: GeminiErrorKind;
  message: string;
}

/** Token accounting from the response's usageMetadata (absent on models that don't report it). */
export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type GeminiResult =
  | { ok: true; parts: GeminiPart[]; usage?: GeminiUsage }
  | { ok: false; error: GeminiError };

/** Sleep that resolves early (rejects) if the external signal aborts during a retry backoff. */
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

export async function callGemini(opts: {
  contents: GeminiContent[];
  systemInstruction: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  /** Fired just before each transient-5xx backoff, so the UI can show the retry. Fire-and-forget. */
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}): Promise<GeminiResult> {
  const url = `${GEMINI_BASE}/models/${opts.model}:generateContent`;

  // Retry loop: Gemini function calling 500s intermittently, especially on multi-turn tool use.
  // We retry ONLY genuine 5xx responses (they come back fast, so no long hangs); 4xx/auth/429 and
  // network/timeout failures are returned immediately.
  for (let attempt = 0; ; attempt++) {
    // Fresh per-attempt timeout that also honours an external abort (panel closed / new question).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.systemInstruction }] },
          contents: opts.contents,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        }),
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
        const body = await res.json();
        message = body?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, error: { kind: 'auth', message } };
      }
      if (res.status === 429) return { ok: false, error: { kind: 'rate_limit', message } };
      // Transient server error — retry with exponential backoff + jitter before giving up.
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
      const usage: GeminiUsage | undefined = u
        ? {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            totalTokens: u.totalTokenCount ?? 0,
          }
        : undefined;
      return { ok: true, parts: parts as GeminiPart[], usage };
    } catch {
      return { ok: false, error: { kind: 'bad_response', message: 'Could not read the Gemini response.' } };
    }
  }
}
