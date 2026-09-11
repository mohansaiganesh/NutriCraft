/**
 * Per-user storage for the "explicit prompt caching" toggle shown next to the chat.
 *
 * Like the model choice (see modelStore.ts), this is a non-secret preference, so it lives in
 * AsyncStorage — NOT in expo-secure-store and NOT in the synced `settings` table. Keyed per user so
 * switching accounts on the same device switches the choice. Defaults OFF: explicit caching is
 * opt-in (it needs a paid Gemini key), while implicit caching always applies regardless.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (userId: string) => `nutricraft-llm-cache-${userId}`;

/** Read whether the user enabled explicit prompt caching (defaults to false). */
export async function getCachePref(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(keyFor(userId))) === '1';
  } catch {
    return false;
  }
}

/** Persist the user's explicit-caching choice. */
export async function setCachePref(userId: string, on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), on ? '1' : '0');
  } catch {
    /* preference is best-effort; ignore storage failures */
  }
}
