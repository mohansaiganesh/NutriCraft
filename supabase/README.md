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
   This already includes the `settings` **profile columns** (`display_name`, `age`, `country`,
   `phone`) used by the Account → Profile screen, so a fresh project needs nothing extra for them.
2. `rls.sql` — Row-Level Security policies + realtime publication.

> **Upgrading an existing project** (created before the Account/Profile feature): `schema.sql`
> uses `create table if not exists`, so re-running it will **not** add the new columns to a table
> that already exists. Add them once in the SQL editor:
> ```sql
> alter table public.settings add column if not exists display_name text;
> alter table public.settings add column if not exists age          integer;
> alter table public.settings add column if not exists country      text;
> alter table public.settings add column if not exists phone        text;
> ```
> Existing RLS (`id = auth.uid()`) already covers them — no policy change. Until this runs, editing
> Profile works locally but the fields can't sync to the cloud.
>
> The **assistant request-history** feature (Account → Request history) adds an `assistant_traces`
> table. `schema.sql` + `rls.sql` create it on a fresh project; re-running them on an existing project
> is safe (`create table/policy if not exists`-style). Until it exists in the cloud, Nico's traces are
> recorded and viewable **locally** but can't sync. It is deliberately **not** in the realtime
> publication — trace rows can be large and don't need live cross-device streaming.

No starter data ships. A new account opens to the **shared catalog** plus its own (initially
empty) private foods. The shared catalog is admin-curated **server-side**: run
`seed-shared-catalog.sql` in the SQL editor (which runs as the service role and so bypasses RLS)
to insert/edit/soft-delete shared rows (`user_id = NULL`, `is_custom = false`). Users can read
those rows but never write them — the app has no admin UI. Later, an Open Food Facts / USDA
import (service role) will populate the same shared tier.

## 3. Auth settings
- **Authentication → Providers → Email** is enabled by default.
- For the smoothest first-run while testing, you may turn **off** "Confirm email"
  (Authentication → Providers → Email) so sign-up creates an active session immediately.
  Leave it on for production; the app shows a "check your inbox" notice in that case.
- **Change email / change password** work out of the box via Supabase auth (Account → Security &
  login in the app). Changing email sends a confirmation link to the new address; the login email
  only flips once that link is opened.

## 4. Deploy the account-deletion function
The app's **Delete account** action (Account → Security & login) calls an Edge Function, because a
client can never delete an auth user — only the service role can. Deploy it once with the
[Supabase CLI](https://supabase.com/docs/guides/cli) (the last command is the only one you repeat
when the function changes):
```
supabase login                              # once per machine (opens a browser)
supabase link --project-ref YOUR-PROJECT-REF  # once per clone; ref is in Project Settings → General
supabase functions deploy delete-account
```
The function (`functions/delete-account/index.ts`) authenticates the caller by their own JWT, so a
user can only delete **themselves**; deleting the auth user cascades all their cloud rows via the
`on delete cascade` foreign keys in `schema.sql`. Until it's deployed, the app surfaces a clear
error and deletes nothing. `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically by the platform — no secrets to configure.

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
- **Never hard-delete a row in the Supabase table editor.** Sync propagates deletions only
  as tombstones (`deleted = true` + a bumped `updated_at`); a hard delete leaves no row to
  pull, so clients never learn it's gone and keep showing it. Delete your own **private**
  foods **in the app** (that soft-deletes locally and syncs the tombstone up automatically);
  to remove a **shared** row server-side, soft-delete it — see
  `seed-shared-catalog.sql:35-40`.

## This setup is required
An account is now mandatory — the app can't run without a backend to sign into. If `.env`
is missing (`isSupabaseConfigured` is false), the app shows a "Cloud not configured" setup
screen instead of the login page. No starter data ships; each new account opens to the
admin-curated shared catalog (if any) plus its own private foods.
