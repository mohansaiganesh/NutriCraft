import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addDatabaseChangeListener } from 'expo-sqlite';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { setCurrentUserId } from '@/lib/currentUser';
import { ensureSettings } from '@/db/queries';
import { dedupeSharedCatalog, seedIfEmpty } from '@/lib/seed';
import {
  cancelPendingSync,
  claimLocalData,
  nudgeSync,
  subscribeRealtime,
  syncInBackground,
  syncNow,
} from '@/lib/sync';

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

  /** Bring a just-authenticated user online: claim local data, pull cloud, ensure settings. */
  async function prepare(uid: string, mail: string | null) {
    if (preparedFor.current === uid) return;
    preparedFor.current = uid;
    setStatus('preparing');
    setCurrentUserId(uid);
    setUserId(uid);
    setEmail(mail);
    try {
      // Claim any owner-less local rows (offline/single-install era) for this account.
      await claimLocalData(uid);
      // Pull existing cloud data BEFORE creating defaults, so we never clobber it.
      await syncNow(uid).catch(() => {
        /* offline — proceed with whatever is cached locally */
      });
      // One-time cleanup for devices upgraded from the early random-id seed build: collapse
      // duplicate shared catalog rows onto their canonical `seed-<name>` twin (must run after
      // the pull, once those canonical rows exist locally). Best-effort — never block entry.
      await dedupeSharedCatalog().catch((e) => {
        console.warn('[session] shared-catalog dedupe skipped this launch', e);
      });
      // Create a default settings row only if neither local nor cloud had one.
      await ensureSettings();
      // Local-only fallback seeding is a no-op when Supabase is configured.
      await seedIfEmpty();
    } finally {
      setStatus('ready');
    }
  }

  // Bootstrap.
  useEffect(() => {
    let unsubRealtime: (() => void) | undefined;

    if (!isSupabaseConfigured) {
      // An account is required — without a backend there's nothing to sign into.
      setStatus('unconfigured');
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (session) {
        prepare(session.user.id, session.user.email ?? null);
        unsubRealtime = subscribeRealtime(session.user.id);
      } else {
        setStatus('signedOut');
      }
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session) {
        prepare(session.user.id, session.user.email ?? null);
        unsubRealtime?.();
        unsubRealtime = subscribeRealtime(session.user.id);
      } else {
        preparedFor.current = null;
        setCurrentUserId(null);
        setUserId(null);
        setEmail(null);
        unsubRealtime?.();
        setStatus('signedOut');
      }
    });

    return () => {
      authSub.subscription.unsubscribe();
      unsubRealtime?.();
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
    sync() {
      if (userId) syncInBackground(userId);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
