// URL polyfill must load before the supabase client is created (RN has no global URL).
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for cloud sync + auth.
 *
 * Credentials come from Expo's EXPO_PUBLIC_* env inlining (see `.env.example`).
 * The anon key is publishable — data security is enforced by Row-Level Security
 * on the database, not by hiding the key.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True only when both env vars are present — lets the app degrade to local-only. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // An account is required, so this blocks the app on a setup screen until it's fixed.
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set — an account is required, so ' +
      'the app will show a "Cloud not configured" screen. Copy .env.example to .env to continue.'
  );
}

// supabase-js throws on an empty URL/key. When unconfigured we still construct a client
// (with harmless placeholders) but never call it — the app shows the "Cloud not configured"
// setup screen, and `isSupabaseConfigured` gates every use in lib/sync.ts and lib/session.tsx.
const clientUrl = supabaseUrl || 'https://placeholder.supabase.co';
const clientKey = supabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native (that's a web-OAuth concern).
    detectSessionInUrl: false,
  },
});

// Keep the access token fresh only while the app is in the foreground, per Supabase's
// React Native guidance — avoids needless refreshes while backgrounded.
AppState.addEventListener('change', (state) => {
  if (!isSupabaseConfigured) return;
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
