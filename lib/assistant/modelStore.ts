/**
 * Per-user storage for the Gemini model the user picks in Settings.
 *
 * Unlike the API key, the model id is NOT a secret, so it lives in AsyncStorage (the same
 * lightweight per-user preference store used for sync cursors in `lib/sync.ts`) — NOT in
 * `expo-secure-store` and NOT in the synced `settings` table (so no schema migration).
 *
 * Keyed per user so switching accounts on the same device switches the choice.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL } from './gemini';

const keyFor = (userId: string) => `nutricraft-llm-model-${userId}`;

/** Read the user's chosen model id, falling back to DEFAULT_MODEL if unset/unavailable. */
export async function getModel(userId: string): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(keyFor(userId));
    return v && v.trim() ? v : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** Persist the user's chosen model id. */
export async function setModel(userId: string, id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), id);
  } catch {
    /* preference is best-effort; ignore storage failures */
  }
}
