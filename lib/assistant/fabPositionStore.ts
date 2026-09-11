/**
 * Per-user storage for the corner the floating Nico bubble rests in.
 *
 * Like the chosen model (see `modelStore.ts`), this is a non-secret UI preference, so it lives in
 * AsyncStorage (the same lightweight per-user store used for sync cursors in `lib/sync.ts`) — NOT in
 * `expo-secure-store` and NOT in the synced `settings` table (so no schema migration).
 *
 * Keyed per user so switching accounts on the same device switches the choice.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export const DEFAULT_CORNER: Corner = 'bottom-right';

const CORNERS: readonly Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

const keyFor = (userId: string) => `nutricraft-fab-corner-${userId}`;

/** Read the user's chosen corner, falling back to DEFAULT_CORNER if unset/invalid. */
export async function getFabCorner(userId: string): Promise<Corner> {
  try {
    const v = await AsyncStorage.getItem(keyFor(userId));
    return v && (CORNERS as readonly string[]).includes(v) ? (v as Corner) : DEFAULT_CORNER;
  } catch {
    return DEFAULT_CORNER;
  }
}

/** Persist the user's chosen corner. */
export async function setFabCorner(userId: string, corner: Corner): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), corner);
  } catch {
    /* preference is best-effort; ignore storage failures */
  }
}
