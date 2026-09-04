# NutriCraft (React Native + Expo)

A local-first personal food & calorie tracker. The workflow: **catalog foods per-100g
(with fiber, sodium, price) → compose meals by gram weight → log daily intake → see
macro + cost totals vs targets.**

## Run it

```bash
npm install
npm start            # then press 'a' (Android), 'i' (iOS), or scan the QR in Expo Go
```

First launch runs the DB migration and pre-loads the 24 starter foods from
`assets/data/food_data.seed.json`.

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

Every syncable table carries a `user_id`. The **food catalog is shared** (rows with
`user_id = NULL`, the starter foods) plus each user's private custom foods; **meals,
meal items, daily logs, and settings are private** per account. `user_id` is nullable in
the local SQLite schema (so migrations don't break old single-install rows — a NULL is
"unclaimed" data the first-login claim stamps) and enforced NOT NULL on the cloud side.

### Key files

| area                     | file                                                 |
| ------------------------ | ---------------------------------------------------- |
| Nutrition math           | `lib/nutrition.ts` (tested in `__tests__/`)          |
| DB schema                | `db/schema.ts`                                        |
| Queries / mutations      | `db/queries.ts`                                       |
| Seed / starter import    | `lib/seed.ts`                                         |
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

Adaptive TDEE engine, AI photo-label + meal-photo estimation, voice logging, barcode
scanning. (Postgres/Supabase cloud sync is now implemented — see the Architecture
section and `supabase/README.md`.)
