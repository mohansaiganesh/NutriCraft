-- NutriCraft cloud schema (Postgres / Supabase).
-- Mirrors db/schema.ts. Run this first in the Supabase SQL editor, then rls.sql. Optionally
-- add shared catalog rows afterward with seed-shared-catalog.sql.
-- Timestamps are stored as TEXT (client-generated UTC ISO-8601) so
-- the app's last-write-wins comparison matches exactly on both stores.

-- Food catalog. user_id set = a user's private food. user_id NULL (is_custom = false) = an
-- admin-curated SHARED food readable by everyone (curated server-side with the service role).
create table if not exists public.food_items (
  id             text primary key,
  user_id        uuid references auth.users (id) on delete cascade,
  name           text not null,
  brand          text not null default 'Generic',
  barcode        text unique,
  serving_size_g real not null default 100,
  calories       real not null default 0,
  protein_g      real not null default 0,
  carbs_g        real not null default 0,
  fat_g          real not null default 0,
  fiber_g        real not null default 0,
  sodium_mg      real not null default 0,
  price_per_100  real not null default 0,
  is_custom      boolean not null default true,
  created_at     text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at     text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted        boolean not null default false
);
create index if not exists food_items_user_updated on public.food_items (user_id, updated_at);

-- Reusable meal templates (private per user).
create table if not exists public.meals (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  notes      text,
  created_at text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted    boolean not null default false
);
create index if not exists meals_user_updated on public.meals (user_id, updated_at);

-- Lines within a meal template.
create table if not exists public.meal_items (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  meal_id      text not null references public.meals (id) on delete cascade,
  food_item_id text not null references public.food_items (id),
  grams        real not null default 0,
  created_at   text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at   text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted      boolean not null default false
);
create index if not exists meal_items_user_updated on public.meal_items (user_id, updated_at);

-- What was actually eaten on a given day.
create table if not exists public.daily_logs (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  logged_date  text not null,
  meal_type    text not null,
  food_item_id text not null references public.food_items (id),
  grams        real not null default 0,
  created_at   text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at   text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted      boolean not null default false
);
create index if not exists daily_logs_user_updated on public.daily_logs (user_id, updated_at);

-- One settings row per user, keyed by id = the user's auth id.
create table if not exists public.settings (
  id                uuid primary key references auth.users (id) on delete cascade,
  target_calories   real not null default 2000,
  target_protein_g  real not null default 150,
  target_carbs_g    real not null default 200,
  target_fat_g      real not null default 65,
  target_fiber_g    real not null default 30,
  target_sodium_mg  real not null default 2300,
  currency          text not null default '$',
  tdee              real,
  updated_at        text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
