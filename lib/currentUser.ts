/**
 * The active account's id (Supabase auth user id), held at module scope so
 * `db/queries.ts` can scope every read/write without threading `userId` through
 * every screen. Set once by the SessionProvider (`lib/session.tsx`) on login and
 * cleared on logout — the app's auth gate only mounts the data screens while it is
 * non-null, so queries inside the app always see a real user.
 */
let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

/** Throwing accessor for write paths that must never run without an account. */
export function requireUserId(): string {
  if (!currentUserId) {
    throw new Error('No active user — a mutation ran before login completed.');
  }
  return currentUserId;
}
