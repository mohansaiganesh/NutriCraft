-- Admin-curated SHARED food catalog.
--
-- Shared foods are the rows every user sees but cannot edit: user_id = NULL and is_custom = false.
-- RLS lets clients only read them (and only write their own user_id rows), so these MUST be written
-- server-side — run this in the Supabase SQL editor (postgres/service-role context, which bypasses
-- RLS) or from a service-role script. The mobile app never writes shared rows.
--
-- The catalog starts EMPTY. Add curated staples here (or, later, via the Open Food Facts / USDA
-- import). Use a stable, prefixed id per row so re-running is idempotent and later updates target
-- the same row. `on conflict (id) do nothing` makes inserts safe to re-run.
--
-- id convention: 'shared-<slug>'. Keep values PER 100 g/ml (the app scales by grams at read time).

-- Example (uncomment and adapt — ship no default data):
-- insert into public.food_items
--   (id, user_id, name, brand, barcode, serving_size_g,
--    calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, price_per_100, is_custom)
-- values
--   ('shared-egg-whole', null, 'Egg, whole', 'Generic', null, 50,
--    143, 12.6, 0.7, 9.5, 0, 142, 0, false)
-- on conflict (id) do nothing;

-- updated_at MUST use the same UTC ISO-8601 text format the app generates, or the string-based
-- last-write-wins / sync-cursor comparison breaks. Inserts can omit it (the column default already
-- uses this format); updates should set it explicitly:
--   to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')

-- ---- Curating an existing shared food (edits propagate to every meal/log that uses it) ----
-- Bump updated_at so all devices pull the change on their next sync:
-- update public.food_items
--    set calories = 145, protein_g = 12.6,
--        updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
--  where id = 'shared-egg-whole';

-- ---- Removing a shared food (soft delete — the row must persist so historical logs still resolve
--       it for reports; it disappears from the catalog and from meal templates) ----
-- update public.food_items
--    set deleted = true,
--        updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
--  where id = 'shared-egg-whole';
