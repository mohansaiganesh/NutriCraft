/**
 * Search hook shared by the Foods catalog and the Add-food picker.
 *
 * Local (SQLite) results come from `foodsQuery` via `useLiveQuery` — instant and fully
 * offline-safe. On top of that, a debounced lookup queries every enabled online source
 * (`FOOD_SOURCES`: Open Food Facts, and USDA when its key is set) in parallel and merges
 * the hits. The remote leg NEVER blocks the local leg: a source that's down just lands in
 * `failedSources`, and only if EVERY source fails does `remoteStatus` become 'error'.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { foodsQuery } from '@/db/queries';
import { FOOD_SOURCES, type RemoteFood } from '@/lib/foodSearch';
import type { FoodItem } from '@/db/schema';

const DEBOUNCE_MS = 400;
const MIN_CHARS = 3;

export type RemoteStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface FoodSearchResult {
  localFoods: FoodItem[];
  remoteFoods: RemoteFood[];
  remoteStatus: RemoteStatus;
  /** Labels of sources that were unreachable this search (for a quiet footer note). */
  failedSources: string[];
}

/** Normalize a name for cross-source dedupe (case/spacing/underscores). */
function normName(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

interface RemoteState {
  foods: RemoteFood[];
  status: RemoteStatus;
  failedSources: string[];
}

const IDLE: RemoteState = { foods: [], status: 'idle', failedSources: [] };

export function useFoodSearch(query: string): FoodSearchResult {
  const { data } = useLiveQuery(foodsQuery(query), [query]);
  const localFoods = (data ?? []) as FoodItem[];

  const [remote, setRemote] = useState<RemoteState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  const term = query.trim();

  useEffect(() => {
    // Cancel any in-flight requests from a previous keystroke.
    controllerRef.current?.abort();

    if (term.length < MIN_CHARS) {
      setRemote(IDLE);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setRemote((s) => ({ ...s, status: 'loading' }));

      // Query every enabled source in parallel under the one shared abort signal.
      const settled = await Promise.all(
        FOOD_SOURCES.map((src) =>
          src.search(term, controller.signal).then((r) => ({ src, result: r })),
        ),
      );
      if (!active || controller.signal.aborted) return;

      const foods: RemoteFood[] = [];
      const failedSources: string[] = [];
      for (const { src, result } of settled) {
        if (result === null) failedSources.push(src.label); // null = genuine outage
        else foods.push(...result);
      }

      // 'error' only when EVERY enabled source failed; otherwise 'ok' (some may be down).
      const status: RemoteStatus =
        failedSources.length === FOOD_SOURCES.length ? 'error' : 'ok';
      setRemote({ foods, status, failedSources });
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [term]);

  // Dedupe: drop items already shown locally, then collapse cross-source dupes. Sources are
  // ordered so the authoritative entry (USDA) is seen first and wins a name/barcode tie.
  // Memoized on [localFoods, remote.foods] so `remoteFoods` keeps a stable identity between
  // unrelated re-renders — this lets the Foods list's `sections` memo and memoized rows bail.
  const remoteFoods = useMemo<RemoteFood[]>(() => {
    const localBarcodes = new Set(
      localFoods.map((f) => f.barcode).filter((b): b is string => !!b),
    );
    const localNames = new Set(localFoods.map((f) => normName(f.name)));
    const seenBarcodes = new Set<string>();
    const seenNames = new Set<string>();
    const out: RemoteFood[] = [];
    for (const r of remote.foods) {
      const name = normName(r.name);
      if (r.barcode && (localBarcodes.has(r.barcode) || seenBarcodes.has(r.barcode))) continue;
      if (localNames.has(name) || seenNames.has(name)) continue;
      if (r.barcode) seenBarcodes.add(r.barcode);
      seenNames.add(name);
      out.push(r);
    }
    return out;
  }, [localFoods, remote.foods]);

  return {
    localFoods,
    remoteFoods,
    remoteStatus: remote.status,
    failedSources: remote.failedSources,
  };
}
