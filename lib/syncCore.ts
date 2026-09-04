/**
 * Pure decision logic for the delta-sync engine — deliberately free of any React
 * Native / expo-sqlite / Supabase imports so it is unit-testable under plain Jest
 * (see `__tests__/sync.test.ts`). `lib/sync.ts` wires these against the real DB and
 * network; everything that can be reasoned about without I/O lives here.
 */

export const EPOCH = '1970-01-01T00:00:00.000Z';

/** ISO-8601 UTC strings sort lexicographically, so a plain string max IS the time max. */
export const maxIso = (a: string, b: string): string => (a > b ? a : b);

/**
 * A Postgres integrity-constraint error (class 23, e.g. 23503 FK) is a per-row data
 * problem — isolating the bad row lets the rest push. Anything else (network, auth) is
 * not row-specific, so callers don't bother retrying row-by-row.
 */
export function isRowLevelError(error: any): boolean {
  return typeof error?.code === 'string' && error.code.startsWith('23');
}

/** localKey -> remoteColumn map (e.g. `pricePer100` -> `price_per_100`). */
export type FieldMap = Record<string, string>;

/** Project a local (camelCase) row onto its remote (snake_case) shape via the field map. */
export function toRemote(fields: FieldMap, local: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [localKey, remoteCol] of Object.entries(fields)) {
    out[remoteCol] = local[localKey];
  }
  return out;
}

/** Project a remote row back onto its local shape via the field map. */
export function fromRemote(fields: FieldMap, remote: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [localKey, remoteCol] of Object.entries(fields)) {
    out[localKey] = remote[remoteCol];
  }
  return out;
}

/**
 * Fast-path cursor advance after a whole-table batch upsert succeeds: the new cursor is
 * the max `updatedAt` across the pushed rows (never below the prior cursor).
 */
export function advanceCursorAll(cursor: string, updatedAts: string[]): string {
  return updatedAts.reduce((mx, at) => maxIso(mx, at), cursor);
}

/**
 * Slow-path cursor advance after a row-by-row retry: advance only past rows that
 * succeeded AND precede the earliest failure, so every failed row stays strictly greater
 * than the cursor and is re-selected (and retried) next cycle. `minFailed` is the earliest
 * `updatedAt` among failed rows, or null if none failed.
 */
export function advanceCursorPartial(
  cursor: string,
  succeeded: string[],
  minFailed: string | null
): string {
  return succeeded.reduce(
    (mx, at) => (minFailed !== null && at >= minFailed ? mx : maxIso(mx, at)),
    cursor
  );
}

/**
 * Last-write-wins pull decision: apply the incoming remote row only when we have no local
 * copy, or our local copy is strictly older. A local row of equal-or-newer age wins and the
 * remote is skipped. `localUpdatedAt` is undefined when the row doesn't exist locally.
 */
export function shouldApplyRemote(
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string
): boolean {
  return localUpdatedAt === undefined || localUpdatedAt < remoteUpdatedAt;
}
