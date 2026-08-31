/** Formatting + local-date helpers used across screens. */

/** Round to `digits` decimals and drop trailing zeros. */
export function fmt(n: number, digits = 0): string {
  if (!isFinite(n)) return '0';
  const p = 10 ** digits;
  const r = Math.round(n * p) / p;
  return String(r);
}

export function money(n: number, currency = '$'): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${currency}${Math.abs(n).toFixed(2)}`;
}

/** "chicken_breast" → "Chicken Breast" (display only; also swaps underscores for spaces). */
export function titleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Local calendar day as 'YYYY-MM-DD' (not UTC — avoids off-by-one at night). */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return todayISO(dt);
}

/** Friendly label: "Today", "Yesterday", or "Mon, Aug 25". */
export function dateLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === addDaysISO(today, -1)) return 'Yesterday';
  if (iso === addDaysISO(today, 1)) return 'Tomorrow';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Parse a possibly-empty text input into a non-negative number. */
export function num(text: string): number {
  const n = parseFloat(text);
  return isFinite(n) && n >= 0 ? n : 0;
}
