# NutriCraft (React Native + Expo)

A local-first personal food & calorie tracker. The workflow: **catalog foods per-100g
(with fiber, sodium, price) → compose meals by gram weight → log daily intake → see
macro + cost totals vs targets.**

## Run it

```bash
npm install
npm start            # then press 'a' (Android), 'i' (iOS), or scan the QR in Expo Go
```

First launch runs the DB migration; a new account opens to an empty catalog and adds its own foods.

## Scripts

| command              | what it does                                             |
| -------------------- | -------------------------------------------------------- |
| `npm start`          | Expo dev server                                          |
| `npm test`           | Jest — nutrition-math tests                              |
| `npm run typecheck`  | `tsc --noEmit`                                            |
| `npm run db:generate`| Regenerate Drizzle migrations after editing `db/schema.ts` |

## Architecture

- **Storage:** local-first SQLite via `expo-sqlite`, queried with **Drizzle ORM**.
  The schema (`db/schema.ts`) is written once so it can target Postgres later for
  cloud sync — every table uses UUID keys, UTC timestamps, and `updated_at` +
  `deleted` soft-delete columns for future reconciliation.
- **Navigation:** Expo Router (`app/`), file-based, with a bottom tab bar.
- **Styling:** NativeWind (Tailwind).
- **Reactive data:** Drizzle `useLiveQuery` (SQLite change listener) — screens update
  automatically on writes.
- **Accounts & cloud sync (required):** the app runs behind an email/password login — the
  `AuthScreen` is the entry point, and signing out returns to it so a different user can
  sign in on the same device. Local SQLite stays the source of truth; `lib/sync.ts` runs a
  push-then-pull, last-write-wins delta sync (keyed on the `updated_at`/`deleted` columns)
  against Postgres, gated by Row-Level Security so each account only sees its own data plus
  the shared food catalog. Data survives uninstall/reinstall and appears on every device.
  Supabase must be configured (`.env`); without it the app shows a "Cloud not configured"
  setup screen. See `supabase/README.md` to set it up.

### Multi-user data model

Every syncable table carries a `user_id`. **Meals, meal items, daily logs, and settings are
private** per account. **Foods** are either private (`user_id = you`, `is_custom = true`,
editable) or **shared** (`user_id IS NULL`, `is_custom = false`) — an admin-curated global
catalog everyone reads but only the service role writes (`supabase/seed-shared-catalog.sql`).
`user_id` is nullable in the local SQLite schema (it holds shared rows, and a NULL private row
is "unclaimed" data the first-login claim stamps). Editing a food propagates to every meal/log
that uses it (nutrition is computed live from `foodId + grams`); deleting a food removes it from
meal templates but leaves historical logs intact for reports.

**Online food search (Open Food Facts + USDA).** When you search on the Foods tab or the Add-food
picker, local/shared matches show instantly and, in parallel, a debounced lookup queries external
sources for items not yet in the catalog: [Open Food Facts](https://world.openfoodfacts.org)
(packaged/barcoded foods, no key) and, when a key is configured,
[USDA FoodData Central](https://fdc.nal.usda.gov/) (generic whole foods). Both merge into one
deduped "Online results" list, each row tagged `OFF` or `USDA`. Picking a result saves it as your
**private** food (`lib/foodSearch.ts` maps each source's per-100g values onto the catalog basis).
The remote leg is best-effort: any source that's down never blocks local search — the others still
show, with a quiet "unavailable" note. OFF needs no key; USDA needs a free
`EXPO_PUBLIC_FDC_API_KEY` (see `.env.example`) and is silently skipped without one.

### Key files

| area                     | file                                                 |
| ------------------------ | ---------------------------------------------------- |
| Nutrition math           | `lib/nutrition.ts` (tested in `__tests__/`)          |
| DB schema                | `db/schema.ts`                                        |
| Queries / mutations      | `db/queries.ts`                                       |
| Backup export/import     | `lib/backup.ts`                                       |
| Today dashboard          | `app/(tabs)/index.tsx`                                |
| Food catalog + form      | `app/(tabs)/foods.tsx`, `app/food/[id].tsx`          |
| Meal templates           | `app/(tabs)/meals.tsx`, `app/meal/[id].tsx`          |
| Auth & cloud sync        | `lib/session.tsx`, `lib/sync.ts`, `supabase/`        |
| Settings / targets       | `app/(tabs)/settings.tsx`                             |

### Routing conventions

The odd-looking names under `app/` (`_layout.tsx`, `(tabs)`, `[id].tsx`, `index.tsx`)
are **not** arbitrary — they are required syntax from **Expo Router**. Under file-based
routing, the file and folder names *are* the routing config, so these can't be renamed
to "cleaner" names without breaking navigation.

| Pattern | Meaning | Example in this app |
| ------- | ------- | ------------------- |
| `_layout.tsx` | Shared layout wrapping every route in the folder; the leading `_` marks it a layout, not a screen. | `app/_layout.tsx` (DB gate + `<Stack>`), `app/(tabs)/_layout.tsx` (the `<Tabs>` bar) |
| `(tabs)` | A route **group** — parentheses group files without adding a URL segment. | `(tabs)/foods.tsx` → route `/foods`, **not** `/tabs/foods` |
| `[id].tsx` | A **dynamic** segment; the bracketed name is a param read via `useLocalSearchParams()`. | `app/food/[id].tsx` matches `/food/123` |
| `index.tsx` | The default/landing route for its folder. | `(tabs)/index.tsx` → the "Today" tab at `/` |
| plain name (`pick-food.tsx`) | An ordinary screen → route of the same name. Freely renameable. | `app/pick-food.tsx` → `/pick-food` |

Only the `app/` router tree is bound by these rules — everything outside it
(`components/`, `lib/`, `db/`) uses normal free-form naming. See the
[Expo Router docs](https://docs.expo.dev/router/introduction/) for the full spec.

## Deferred (schema is ready for these)

Adaptive TDEE engine, AI photo-label + meal-photo estimation, voice logging, and barcode
scanning. (Postgres/Supabase cloud sync and online food search — Open Food Facts + USDA
FoodData Central — are implemented; see the Architecture section and `supabase/README.md`.)
