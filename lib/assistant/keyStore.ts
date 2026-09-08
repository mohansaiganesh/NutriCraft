/**
 * Per-user storage for the Gemini API key the user enters in Settings.
 *
 * The key is a personal secret, so it lives in the OS keychain/keystore via
 * `expo-secure-store` — encrypted at rest and, critically, OUTSIDE the `settings` SQLite
 * table (which syncs to Supabase, see `lib/sync.ts` TABLES). It never leaves the device.
 *
 * Keyed per user so switching accounts on the same device switches keys, and one user
 * can never read another's key. SecureStore keys must match [A-Za-z0-9._-], and a userId
 * is a UUID (hyphens only), so this composes safely.
 */
import * as SecureStore from 'expo-secure-store';

const keyFor = (userId: string) => `nutricraft-llm-key-${userId}`;

/** Read the stored Gemini key for a user, or null if none is set (or storage is unavailable). */
export async function getApiKey(userId: string): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(keyFor(userId));
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Persist (or overwrite) the user's Gemini key. */
export async function setApiKey(userId: string, key: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(userId), key.trim());
}

/** Remove the user's Gemini key. */
export async function clearApiKey(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(userId));
}

/** Whether a non-empty key is stored for the user. */
export async function hasApiKey(userId: string): Promise<boolean> {
  return (await getApiKey(userId)) !== null;
}
