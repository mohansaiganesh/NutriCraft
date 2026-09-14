/**
 * Provider registry: maps a provider id to its `LlmClient` adapter.
 *
 * This is the single switch the agent loop goes through to reach a provider — and the ONE place a new
 * provider is wired in (write the adapter in `providers/`, add its models in `models.ts`, register it
 * here).
 */
import type { LlmClient, LlmProvider } from './provider';
import { googleClient } from './providers/google';
import { groqClient } from './providers/groq';

const CLIENTS: Record<LlmProvider, LlmClient> = {
  google: googleClient,
  groq: groqClient,
};

/** The adapter that serves a given provider. */
export function getClient(provider: LlmProvider): LlmClient {
  return CLIENTS[provider];
}
