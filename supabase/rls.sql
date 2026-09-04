-- Row-Level Security for NutriCraft. Run after schema.sql.
-- Every table is private to its owner; the food catalog additionally exposes shared
-- rows (user_id IS NULL) to everyone for reading. There are no DELETE policies —
-- deletion is a soft-delete UPDATE (deleted = true), consistent with the app.

-- ---------- food_items ----------
alter table public.food_items enable row level security;

create policy food_items_select on public.food_items
  for select using (user_id is null or user_id = auth.uid());

create policy food_items_insert on public.food_items
  for insert with check (user_id = auth.uid());

create policy food_items_update on public.food_items
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- meals ----------
alter table public.meals enable row level security;

create policy meals_select on public.meals
  for select using (user_id = auth.uid());
create policy meals_insert on public.meals
  for insert with check (user_id = auth.uid());
create policy meals_update on public.meals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- meal_items ----------
alter table public.meal_items enable row level security;

create policy meal_items_select on public.meal_items
  for select using (user_id = auth.uid());
create policy meal_items_insert on public.meal_items
  for insert with check (user_id = auth.uid());
create policy meal_items_update on public.meal_items
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- daily_logs ----------
alter table public.daily_logs enable row level security;

create policy daily_logs_select on public.daily_logs
  for select using (user_id = auth.uid());
create policy daily_logs_insert on public.daily_logs
  for insert with check (user_id = auth.uid());
create policy daily_logs_update on public.daily_logs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- settings ----------
alter table public.settings enable row level security;

create policy settings_select on public.settings
  for select using (id = auth.uid());
create policy settings_insert on public.settings
  for insert with check (id = auth.uid());
create policy settings_update on public.settings
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------- realtime (optional, for instant cross-device updates) ----------
-- Enables the app's subscribeRealtime() to receive change events.
alter publication supabase_realtime add table
  public.food_items, public.meals, public.meal_items, public.daily_logs, public.settings;
