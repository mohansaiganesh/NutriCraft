/**
 * Per-user, per-provider storage for the API keys the user enters under Account → AI assistant.
 *
 * Each key is a personal secret, so it lives in the OS keychain/keystore via `expo-secure-store` —
 * encrypted at rest and, critically, OUTSIDE the `settings` SQLite table (which syncs to Supabase,
 * see `lib/sync.ts` TABLES). It never leaves the device.
 *
 * Keyed per user AND per provider, so switching accounts switches keys, one user can never read
 * another's key, and Google and Groq keys are stored independently. SecureStore keys must match
 * [A-Za-z0-9._-]; a userId is a UUID (hyphens only) and a provider is a lowercase word, so this
 * composes safely.
 *
 * Back-compat: the `google` key keeps the original (provider-less) storage name so existing Gemini
 * keys keep working with no migration.
 */
import * as SecureStore from 'expo-secure-store';
import type { LlmProvider } from './provider';

const keyFor = (provider: LlmProvider, userId: string) =>
  provider === 'google' ? `nutricraft-llm-key-${userId}` : `nutricraft-llm-key-${provider}-${userId}`;

/** Read the stored key for a user + provider, or null if none is set (or storage is unavailable). */
export async function getApiKey(userId: string, provider: LlmProvider): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(keyFor(provider, userId));
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Persist (or overwrite) the user's key for a provider. */
export async function setApiKey(userId: string, provider: LlmProvider, key: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(provider, userId), key.trim());
}

/** Remove the user's key for a provider. */
export async function clearApiKey(userId: string, provider: LlmProvider): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(provider, userId));
}

/** Whether a non-empty key is stored for the user + provider. */
export async function hasApiKey(userId: string, provider: LlmProvider): Promise<boolean> {
  return (await getApiKey(userId, provider)) !== null;
}
