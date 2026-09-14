/**
 * The model registry — the ONE place providers and their models are declared.
 *
 * The chat picker reads `AVAILABLE_MODELS`, `providerForModel` routes an id to its adapter (in
 * `clients.ts`), and `cachingMode` tells the UI how to render the caching control for a provider.
 * Adding a provider's models is a matter of appending rows here (plus an adapter in `providers/` and a
 * line in `clients.ts`).
 *
 * Pure and RN-free so it can be imported from the client layer and from tests.
 */
import type { LlmProvider } from './provider';

export interface LlmModel {
  id: string; // the provider-native model id sent on the wire
  provider: LlmProvider;
  label: string; // friendly name shown in the picker
}

/**
 * Every selectable model, grouped by provider in list order. Gemini 3.6 Flash is the reliable default
 * for tool calling; the Gemma models are newer and can 500 on multi-turn tool use. The Groq gpt-oss
 * models are served on Groq's OpenAI-compatible API.
 */
export const AVAILABLE_MODELS: LlmModel[] = [
  { id: 'gemini-3.6-flash', provider: 'google', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.1-flash-lite', provider: 'google', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-3.5-flash-lite', provider: 'google', label: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemma-4-31b-it', provider: 'google', label: 'Gemma 4 31B' },
  { id: 'gemma-4-26b-a4b-it', provider: 'google', label: 'Gemma 4 26B' },
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B' },
  { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B' },
];

/** Display name for each provider — used as the picker group header and in error copy. */
export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  google: 'Google',
  groq: 'Groq',
};

/** Every provider that has at least one model, in first-appearance order. Used to probe stored keys. */
export const ALL_PROVIDERS: LlmProvider[] = [...new Set(AVAILABLE_MODELS.map((m) => m.provider))];

/** Default model when the user hasn't picked one. Override via EXPO_PUBLIC_GEMINI_MODEL. */
export const DEFAULT_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.5-flash-lite';

/**
 * Which provider serves a model id. Defaults to `'google'` for an unknown id so any legacy-stored
 * model choice keeps routing to Gemini.
 */
export function providerForModel(id: string): LlmProvider {
  return AVAILABLE_MODELS.find((m) => m.id === id)?.provider ?? 'google';
}

/**
 * How a provider caches, which drives the ⚡ control in the chat:
 * - `'explicit'` — the user opts in (Gemini creates a `cachedContents` resource) → interactive toggle.
 * - `'auto'`     — the provider caches automatically server-side (Groq) → non-interactive "on" badge.
 * - `'none'`     — no caching → the control is hidden.
 */
export function cachingMode(provider: LlmProvider): 'explicit' | 'auto' | 'none' {
  switch (provider) {
    case 'google':
      return 'explicit';
    case 'groq':
      return 'auto';
  }
}
