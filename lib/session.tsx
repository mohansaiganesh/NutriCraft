import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addDatabaseChangeListener } from 'expo-sqlite';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { setCurrentUserId } from '@/lib/currentUser';
import { ensureSettings, wipeLocalUserData } from '@/db/queries';
import {
  cancelPendingSync,
  claimLocalData,
  nudgeSync,
  subscribeRealtime,
  syncInBackground,
} from '@/lib/sync';
import { purgeTombstonesThrottled } from '@/lib/purge';

/**
 * - `loading`      — resolving the persisted session
 * - `unconfigured` — Supabase isn't configured; the app can't run without an account
 * - `signedOut`    — no session; show the auth (login) screen
 * - `preparing`    — signed in; claiming local data + running the first sync
 * - `ready`        — data screens can mount (currentUserId is set)
 */
export type SessionStatus = 'loading' | 'unconfigured' | 'signedOut' | 'preparing' | 'ready';

interface SessionValue {
  status: SessionStatus;
  userId: string | null;
  email: string | null;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signUp(email: string, password: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
  /** Verify the current password, then set a new one. */
  changePassword(current: string, next: string): Promise<{ error?: string }>;
  /** Start an email change (Supabase emails a confirmation link to the new address). */
  changeEmail(newEmail: string): Promise<{ error?: string }>;
  /** Permanently delete the account server-side, wipe local data, and sign out. */
  deleteAccount(): Promise<{ error?: string }>;
  sync(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  // Guards `prepare` so it runs once per signed-in user, not on every auth event.
  const preparedFor = useRef<string | null>(null);
  // Realtime subscription state, so we subscribe once per user (not per auth event) and never
  // leak: `getSession` and `onAuthStateChange` both drive this via `ensureRealtime`.
  const unsubRealtimeRef = useRef<(() => void) | null>(null);
  const realtimeForRef = useRef<string | null>(null);

  /** Bring a just-authenticated user online: claim local data, pull cloud, ensure settings. */
  async function prepare(uid: string, mail: string | null) {
    if (preparedFor.current === uid) return;
    preparedFor.current = uid;
    setStatus('preparing');
    setCurrentUserId(uid);
    setUserId(uid);
    setEmail(mail);
    try {
      // Local-only work — fast, no network — so startup never blocks on the network
      // (offline this used to hang the "Syncing your data…" splash on ~10 sequential,
      // un-timed-out Supabase requests before the UI could mount).
      await claimLocalData(uid);
      // Safe to create defaults before the pull: the default row is SETTINGS_EPOCH-stamped
      // (db/queries.ts), so it loses every LWW comparison and is never pushed — a later
      // background pull's real cloud settings always win.
      await ensureSettings();
    } finally {
      // Enter the app immediately, online or offline. Local SQLite is the UI's source of
      // truth; the finally guarantees we proceed even if the local work above throws.
      setStatus('ready');
    }
    // First sync runs in the background; screens update reactively (useLiveQuery) as rows
    // land. syncInBackground already swallows offline/transient errors (lib/sync.ts).
    syncInBackground(uid);
    // Hygiene: hard-delete aged, already-synced tombstones (throttled to once/24h, swallows
    // errors). Safe regardless of the sync above — it reads the durable push cursor, so it only
    // removes what a PRIOR session already pushed (lib/purge.ts).
    void purgeTombstonesThrottled(uid);
  }

  // Bootstrap.
  useEffect(() => {
    // Subscribe to realtime once per user. `getSession` and `onAuthStateChange` both fire on a
    // fresh load; without this guard the second call would re-bind the same channel topic and
    // throw ("cannot add postgres_changes callbacks after subscribe()"), or leak a subscription.
    function ensureRealtime(uid: string) {
      if (realtimeForRef.current === uid) return; // already subscribed for this user
      unsubRealtimeRef.current?.(); // tear down a prior user's subscription
      realtimeForRef.current = uid;
      unsubRealtimeRef.current = subscribeRealtime(uid);
    }
    function teardownRealtime() {
      unsubRealtimeRef.current?.();
      unsubRealtimeRef.current = null;
      realtimeForRef.current = null;
    }

    if (!isSupabaseConfigured) {
      // An account is required — without a backend there's nothing to sign into.
      setStatus('unconfigured');
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (session) {
        prepare(session.user.id, session.user.email ?? null);
        ensureRealtime(session.user.id);
      } else {
        setStatus('signedOut');
      }
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session) {
        prepare(session.user.id, session.user.email ?? null);
        ensureRealtime(session.user.id);
      } else {
        preparedFor.current = null;
        setCurrentUserId(null);
        setUserId(null);
        setEmail(null);
        teardownRealtime();
        setStatus('signedOut');
      }
    });

    return () => {
      authSub.subscription.unsubscribe();
      teardownRealtime();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync on return to foreground while signed in.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && status === 'ready' && userId) {
        syncInBackground(userId);
      }
    });
    return () => sub.remove();
  }, [status, userId]);

  // Push local writes shortly after they land (debounced), so edits made while the
  // app stays open reach the cloud without waiting for the next foreground.
  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    const sub = addDatabaseChangeListener(() => nudgeSync(userId));
    return () => sub.remove();
  }, [status, userId]);

  const value: SessionValue = {
    status,
    userId,
    email,
    async signIn(mail, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
      return error ? { error: error.message } : {};
    },
    async signUp(mail, password) {
      const { error } = await supabase.auth.signUp({ email: mail, password });
      return error ? { error: error.message } : {};
    },
    async signOut() {
      // Drop any debounced push so it can't fire against the torn-down / next session.
      cancelPendingSync();
      await supabase.auth.signOut();
      // Local cache is left in place (scoped by user_id) for fast re-login; the
      // onAuthStateChange SIGNED_OUT handler returns us to the login screen.
    },
    async changePassword(current, next) {
      if (!email) return { error: 'Not signed in.' };
      // Supabase's updateUser({ password }) doesn't check the current password, so verify it
      // ourselves by re-authenticating first — this both confirms intent and rejects a session
      // left open on a shared device.
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) return { error: 'Current password is incorrect.' };
      const { error } = await supabase.auth.updateUser({ password: next });
      return error ? { error: error.message } : {};
    },
    async changeEmail(newEmail) {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      // The session's email only flips once the user confirms via the link Supabase sends;
      // onAuthStateChange then updates our `email` state.
      return error ? { error: error.message } : {};
    },
    async deleteAccount() {
      const uid = userId;
      if (!uid) return { error: 'Not signed in.' };
      // Only the service role can delete an auth user — that lives in the `delete-account`
      // Edge Function (supabase/functions/delete-account), which authenticates the caller by
      // their JWT and cascades all cloud rows via the on-delete FKs.
      const { error } = await supabase.functions.invoke('delete-account');
      if (error) {
        return {
          error:
            'Could not delete the account. The delete-account function may not be deployed — ' +
            'see supabase/README.md.',
        };
      }
      cancelPendingSync();
      // Clear this user's rows locally so nothing stale lingers for the next account on the device.
      try {
        await wipeLocalUserData(uid);
      } catch {
        // Non-fatal: the account is already gone server-side; sign-out still proceeds.
      }
      await supabase.auth.signOut();
      return {};
    },
    sync() {
      if (userId) syncInBackground(userId);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
