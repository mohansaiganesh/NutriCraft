/**
 * Provider-neutral contract for the assistant's LLM layer.
 *
 * The agent loop (`agent.ts`) speaks ONLY the types in this file — a neutral conversation shape and a
 * neutral tool-declaration shape — and never a provider's own wire format. Each provider
 * (`providers/google.ts`, `providers/groq.ts`, …) implements `LlmClient` and translates neutral ⇄ its
 * own API on the way in and out. Adding a new provider is: write one adapter here, register it in
 * `clients.ts`, list its models in `models.ts`. Nothing else in the app should know Gemini or Groq
 * exists.
 *
 * This module is pure and RN-free (types only) so it can be imported anywhere, including tests.
 */

/** Every provider the app knows about. Widen this union to add one. */
export type LlmProvider = 'google' | 'groq';

// ------------------------------------------------------------------ neutral conversation

/**
 * One piece of a conversation turn. `toolCall`/`toolResult` carry an `id` so a call can be paired with
 * its result across a round — providers that require the pairing (OpenAI-style) rely on it; Gemini
 * tolerates it being absent.
 */
export type LlmPart =
  | { type: 'text'; text: string; providerMeta?: ProviderMeta }
  | { type: 'toolCall'; id?: string; name: string; args: Record<string, unknown>; providerMeta?: ProviderMeta }
  | { type: 'toolResult'; id?: string; name: string; response: Record<string, unknown> };

/**
 * Opaque, adapter-owned data attached to a model-produced part that must round-trip UNCHANGED when the
 * part is sent back in history (e.g. Gemini's `thoughtSignature`, required on function calls by
 * thinking models). The loop never reads or edits it — it just keeps the part in `contents` as returned.
 */
export type ProviderMeta = Record<string, unknown>;

/** A model response only ever contains text and tool calls (never a tool result). */
export type LlmResponsePart =
  | { type: 'text'; text: string; providerMeta?: ProviderMeta }
  | { type: 'toolCall'; id?: string; name: string; args: Record<string, unknown>; providerMeta?: ProviderMeta };

export interface LlmMessage {
  role: 'user' | 'assistant';
  parts: LlmPart[];
}

// ------------------------------------------------------------------ neutral tool declarations

/**
 * A JSON Schema node in the neutral (standard, lowercase-type) dialect. Adapters convert this to their
 * own dialect — Google uppercases `type` (`STRING`/`OBJECT`), OpenAI/Groq consume it as-is.
 */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
}

/** One function the model may call, in the neutral shape. */
export interface LlmToolDecl {
  name: string;
  description: string;
  parameters?: JsonSchema;
}

// ------------------------------------------------------------------ result / error / usage

export type LlmErrorKind = 'auth' | 'rate_limit' | 'network' | 'bad_response' | 'api';

export interface LlmError {
  kind: LlmErrorKind;
  message: string;
  /** Set when the failure is a stale/missing explicit-cache reference — the caller drops the cache and
   * retries on the full-prompt path (see `agent.ts`). Only explicit-cache providers set this. */
  cacheInvalid?: boolean;
}

/** Token accounting a provider reports. `cachedTokens` is the portion of input served from cache
 * (implicit, automatic, or explicit) — 0 when the provider doesn't report it or nothing was cached. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

export type LlmResult =
  | { ok: true; parts: LlmResponsePart[]; usage?: LlmUsage; finishReason?: string }
  | { ok: false; error: LlmError };

// ------------------------------------------------------------------ client contract

export interface LlmCallOpts {
  messages: LlmMessage[];
  systemInstruction: string;
  tools: LlmToolDecl[];
  apiKey: string;
  model: string;
  /** When set, the request references this provider-specific cache resource and OMITS the system
   * instruction + tools (they live in the cache). Only explicit-cache providers use it. */
  cachedContent?: string;
  signal?: AbortSignal;
  /** Fired just before each transient-5xx backoff so the UI can show the retry. Fire-and-forget. */
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}

/** Inputs a provider needs to create/reuse an explicit cache resource for the stable prompt prefix. */
export interface EnsureCacheOpts {
  apiKey: string;
  model: string;
  systemInstruction: string;
  tools: LlmToolDecl[];
}

/**
 * A provider adapter. `call` is required and must NEVER throw — every failure (auth, rate-limit,
 * network, bad response, server error) resolves to `{ ok: false, error }`. `ensureCache`/
 * `invalidateCache` are optional capabilities present only on providers with explicit prompt caching.
 */
export interface LlmClient {
  readonly provider: LlmProvider;
  call(opts: LlmCallOpts): Promise<LlmResult>;
  ensureCache?(opts: EnsureCacheOpts): Promise<string | null>;
  invalidateCache?(): void;
}
