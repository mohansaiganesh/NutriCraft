# NutriCraft cloud sync (Supabase) setup

This folder holds the SQL that provisions the cloud backend for multi-user, multi-device
sync. The app stays fully local-first — this just adds the durable, account-scoped copy.

## 1. Create the project
1. Create a project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
3. In the repo root, `cp .env.example .env` and paste them in:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-anon-key
   ```
   Restart the Expo dev server after editing `.env` (env vars are inlined at bundle time).
   The anon key is safe to ship — security is enforced by Row-Level Security, not by
   hiding it.

## 2. Provision the database
In the Supabase **SQL editor**, run these files **in order**:
1. `schema.sql` — tables (mirrors `db/schema.ts`; timestamps are client-generated ISO text).
2. `rls.sql` — Row-Level Security policies + realtime publication.
3. `seed.sql` — the 24 shared starter foods (`user_id = NULL`), ids matching the app's
   `seedFoodId()` so a local seed and the cloud row dedupe by primary key.

## 3. Auth settings
- **Authentication → Providers → Email** is enabled by default.
- For the smoothest first-run while testing, you may turn **off** "Confirm email"
  (Authentication → Providers → Email) so sign-up creates an active session immediately.
  Leave it on for production; the app shows a "check your inbox" notice in that case.

## How sync works (reference)
- `lib/sync.ts` runs a **push-then-pull** delta cycle per table, bounded by a per-table
  cursor (max `updated_at` seen), stored in `AsyncStorage`.
- Conflicts resolve **last-write-wins** by the client-generated `updated_at` (ISO string
  compare), so device clocks vs. server clock never matter.
- Triggers: initial pull on login, a debounced push on local writes (SQLite change
  listener), a pull on app foreground, and an optional Supabase **Realtime** subscription
  for instant cross-device updates.
- Soft-deletes (`deleted = true`) propagate like any other column — nothing is ever hard
  deleted, matching the app's data rules.

## This setup is required
An account is now mandatory — the app can't run without a backend to sign into. If `.env`
is missing (`isSupabaseConfigured` is false), the app shows a "Cloud not configured" setup
screen instead of the login page. **Running `seed.sql` is required too**: with login
mandatory the app no longer seeds the starter foods locally, so the shared catalog reaches
each account only through the initial cloud pull — skip the seed and new accounts open to an
empty catalog.
