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
| `npm start`          | Expo dev server (then `a` Android, `i` iOS, `w` web)     |
| `npm run android`    | Build & run the native Android app                       |
| `npm run ios`        | Build & run the native iOS app                           |
| `npm run web`        | Expo dev server on web                                   |
| `npm test`           | Jest — nutrition math, food search/match, sync, reports, and assistant tests |
| `npm run typecheck`  | `tsc --noEmit`                                            |
| `npm run db:generate`| Regenerate Drizzle migrations after editing `db/schema.ts` |

## Building a release APK (Android)

This is a prebuild workflow — the native `android/` project is generated from `app.json`.

**Prerequisites (one-time):** JDK 17 and the Android SDK (easiest via Android Studio). Set
`ANDROID_HOME` and accept the SDK licenses:

```bash
# ANDROID_HOME is typically C:\Users\<you>\AppData\Local\Android\Sdk
sdkmanager --licenses
```

**1. Generate `android/` if it's missing** (it's regenerated from `app.json`):

```bash
npx expo prebuild --platform android   # add --clean to regenerate from scratch
```

Hand edits inside `android/` are wiped by `--clean` — treat `app.json` (and config plugins) as the
source of truth.

**2. Build the APK:**

```bash
cd android
./gradlew assembleRelease           # PowerShell: .\gradlew.bat assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`.

> **Caveat:** the default `release` build type is signed with the **debug** keystore
> (`android/app/build.gradle`). That APK is fine for testing / sideloading, but **not** for the
> Play Store — see "For distribution" below.

**Minimum-size APK for modern devices** — build only 64-bit ARM and turn on minify + resource
shrinking (both off by default):

```bash
./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  -Pandroid.enableMinifyInReleaseBuilds=true \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=true
```

- `arm64-v8a` only drops the other ABIs — the biggest single saving. It won't run on 32-bit
  devices or the default x86_64 emulators.
- Minify (R8) + resource shrinking can strip something a native module reflects on — test the
  built APK and add keep rules to `android/app/proguard-rules.pro` if needed.
- To make these permanent, move the three flags into `android/gradle.properties`.

**One-liner alternative:** `npx expo run:android --variant release` (prebuild + build + install on a
connected device/emulator).

**For distribution:** generate your own release keystore and wire it into `signingConfigs` in
`android/app/build.gradle`. For the Play Store, prefer an AAB (`./gradlew bundleRelease`) so
per-device splits minimize delivered size. Bump `versionCode` in `build.gradle` for each upload, and
replace the placeholder package `com.anonymous.nutricraft`.

## Architecture

- **Storage:** local-first SQLite via `expo-sqlite`, queried with **Drizzle ORM**.
  The schema (`db/schema.ts`) is written once so it can target Postgres later for
  cloud sync — every table uses UUID keys, UTC timestamps, and `updated_at` +
  `deleted` soft-delete columns for future reconciliation.
- **Navigation:** Expo Router (`app/`), file-based, with a bottom tab bar
  (Today / Foods / Meals / Reports / Account); the Account tab holds a stacked
  `app/(tabs)/account/` area (profile, security, preferences, data, traces).
- **Styling:** NativeWind (Tailwind).
- **Reactive data:** Drizzle `useLiveQuery` (SQLite change listener) — screens update
  automatically on writes.
- **AI assistant (Nico):** an in-app assistant (Google Gemini) that can log foods and apply
  saved meals to a day, each behind a confirmation card. It's mounted globally
  (`components/AssistantOverlay.tsx`), supports voice dictation into its composer, and calls the
  same `db/queries.ts` mutations screens use. Bring your own Gemini API key in Account → Preferences; see
  `lib/assistant/`. Every run is recorded to the syncable `assistant_traces` table, inspectable
  under the account area.
- **Accounts & cloud sync (required):** the app runs behind an email/password login — the
  `AuthScreen` is the entry point, and signing out returns to it so a different user can
  sign in on the same device. Local SQLite stays the source of truth; `lib/sync.ts` runs a
  push-then-pull, last-write-wins delta sync (keyed on the `updated_at`/`deleted` columns)
  against Postgres, gated by Row-Level Security so each account only sees its own data plus
  the shared food catalog. Data survives uninstall/reinstall and appears on every device.
  Supabase must be configured (`.env`); without it the app shows a "Cloud not configured"
  setup screen. See `supabase/README.md` to set it up.

### Multi-user data model

Every syncable table carries a `user_id`. **Meals, meal items, daily logs, settings, and
assistant traces are private** per account. **Foods** are either private (`user_id = you`, `is_custom = true`,
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
| Reports & charts         | `app/(tabs)/reports.tsx`, `lib/reports.ts`, `lib/reportHtml.ts`, `components/charts.tsx` |
| AI assistant (Nico)      | `lib/assistant/`, `components/AssistantOverlay.tsx`  |
| Account area             | `app/(tabs)/account/` (profile, security, preferences, data, traces) |
| Auth & cloud sync        | `lib/session.tsx`, `lib/sync.ts`, `supabase/`        |
| Settings / targets       | `app/(tabs)/account/preferences.tsx`                  |

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

Adaptive TDEE engine, AI photo-label + meal-photo estimation, and barcode scanning.
(Postgres/Supabase cloud sync, online food search — Open Food Facts + USDA FoodData
Central — and the Nico assistant with voice dictation are implemented; see the Architecture
section and `supabase/README.md`.)

**Assistant write scope.** Nico can log foods and apply saved meals to a day, each behind a
confirmation card, and accepts voice dictation into its composer. Still deferred: editing meals
via chat (create/rename meals, add/remove/adjust meal items), creating/editing/deleting foods,
and changing targets/settings. Food edit/delete via chat additionally needs a shared-catalog
ownership guard (`updateFood`/`softDeleteFood` in `db/queries.ts` scope only by `id`), plus
batch confirmation (approving several writes at once). Standalone quick-log voice (outside the
Nico composer) also remains deferred.
