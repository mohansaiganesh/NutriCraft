/**
 * Pure HTML builder for the shareable PDF export. NO react-native imports — the screen assembles
 * a `ReportData` from the same `lib/reports.ts` aggregates it renders on-screen and hands it here,
 * so the PDF and the dashboard always show identical numbers. `expo-print` turns the returned
 * string into a PDF (`app/(tabs)/reports.tsx`).
 *
 * Charts are emitted as inline SVG / CSS (no chart library, no react-native-svg) so the PDF mirrors
 * the on-screen diagrams in `components/charts.tsx`. The chart math here is a faithful copy of those
 * components — keep the two in sync.
 */

export interface ReportRow {
  label: string;
  value: string;
  /** Optional muted note shown after the label (e.g. a brand or streak). */
  note?: string;
}

/** Vertical bars for a daily series (calories/spend). Mirrors `BarChart`. */
export interface BarSeries {
  values: number[];
  color: string;
  target?: number;
}

/** Single-series line with dots. Mirrors `LineChart`. */
export interface LineSeries {
  values: number[];
  color: string;
  target?: number;
}

export interface DonutSeg {
  label: string;
  value: number;
  color: string;
  /** Pre-formatted value shown in the legend (e.g. "42% · 118g/day"). */
  valueText?: string;
}

/** Macro-split (or any) donut with an adjacent legend. Mirrors `DonutChart`. */
export interface DonutSpec {
  segments: DonutSeg[];
  centerTop?: string;
  centerBottom?: string;
}

/** One horizontal leaderboard row (foods/brands/meals). Mirrors `HBarLeaderboard`. */
export interface LeaderBar {
  label: string;
  note?: string;
  value: number;
  valueText: string;
}

export interface LeaderSpec {
  rows: LeaderBar[];
  color: string;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
  /** Shown instead of rows/charts when the section has no data. */
  empty?: string;
  /** Optional visuals, rendered in this order when present, then text `rows`. */
  donut?: DonutSpec;
  bar?: BarSeries;
  line?: LineSeries;
  leaders?: LeaderSpec;
  /** Small caption under the section's chart (e.g. the date range). */
  caption?: string;
}

export interface ReportStat {
  value: string;
  label: string;
  color?: string;
}

export interface ReportData {
  periodLabel: string; // "Last 30 days"
  dateRange: string; // "Aug 9 – Sep 8, 2026"
  headline: string;
  /** Hero daily-average numbers shown as a strip under the headline. */
  stats?: ReportStat[];
  sections: ReportSection[];
}

// Garden tokens (mirror tailwind.config.js / the screen's `C` map).
const BRAND = '#2F9E44';
const INK = '#16241A';
const INK2 = '#5B6B5E';
const INK3 = '#8B9A8D';
const HAIR = '#E3EADD';
const PAPER = '#F6F8F3';
const GRID = '#EAF0E6';
const OVER = '#E03131';

/** Escape user-supplied text (food/brand/meal names) for safe HTML embedding. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

/** Round to avoid absurd SVG coordinate precision in the emitted markup. */
const n2 = (x: number) => Math.round(x * 100) / 100;

// --------------------------------------------------------------- bar SVG
// Faithful copy of BarChart in components/charts.tsx.
function barSvg(b: BarSeries, w = 520, h = 130): string {
  const vals = b.values;
  const n = vals.length;
  if (n === 0) return '';
  const max = Math.max(...vals, b.target ?? 0, 1);
  const pad = 2;
  const slot = (w - pad * 2) / n;
  const barW = Math.max(1, slot * 0.62);
  const targetY = b.target ? h - (b.target / max) * h : null;
  const rx = Math.min(3, barW / 2);

  const targetLine =
    targetY !== null
      ? `<line x1="0" y1="${n2(targetY)}" x2="${w}" y2="${n2(targetY)}" stroke="${INK3}" stroke-width="1" stroke-dasharray="4 4" />`
      : '';
  const bars = vals
    .map((v, i) => {
      const bh = max > 0 ? (v / max) * h : 0;
      const x = pad + i * slot + (slot - barW) / 2;
      const over = b.target != null && v > b.target;
      return `<rect x="${n2(x)}" y="${n2(h - bh)}" width="${n2(barW)}" height="${n2(Math.max(0, bh))}" rx="${n2(rx)}" fill="${over ? OVER : b.color}" opacity="${v > 0 ? 1 : 0.25}" />`;
    })
    .join('');
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${targetLine}${bars}</svg>`;
}

// --------------------------------------------------------------- line SVG
// Faithful copy of LineChart in components/charts.tsx.
function lineSvg(l: LineSeries, w = 520, h = 110): string {
  const vals = l.values;
  const n = vals.length;
  if (n === 0) return '';
  const max = Math.max(...vals, l.target ?? 0, 1);
  const padX = 3;
  const padY = 6;
  const usableH = h - padY * 2;
  const x = (i: number) => (n > 1 ? padX + (i / (n - 1)) * (w - padX * 2) : w / 2);
  const y = (v: number) => padY + usableH - (max > 0 ? (v / max) * usableH : 0);
  const points = vals.map((v, i) => `${n2(x(i))},${n2(y(v))}`).join(' ');
  const targetY = l.target ? y(l.target) : null;
  const dotR = n > 24 ? 1.5 : 2.5;

  const baseline = `<line x1="0" y1="${h - padY}" x2="${w}" y2="${h - padY}" stroke="${GRID}" stroke-width="1" />`;
  const targetLine =
    targetY !== null
      ? `<line x1="0" y1="${n2(targetY)}" x2="${w}" y2="${n2(targetY)}" stroke="${INK3}" stroke-width="1" stroke-dasharray="4 4" />`
      : '';
  const poly =
    n > 1
      ? `<polyline points="${points}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`
      : '';
  const dots = vals
    .map((v, i) => `<circle cx="${n2(x(i))}" cy="${n2(y(v))}" r="${dotR}" fill="${l.color}" opacity="${v > 0 ? 1 : 0.3}" />`)
    .join('');
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${baseline}${targetLine}${poly}${dots}</svg>`;
}

// --------------------------------------------------------------- donut SVG + legend
// Faithful copy of DonutChart in components/charts.tsx.
function donutHtml(d: DonutSpec, size = 132, stroke = 16): string {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = d.segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  let acc = 0;
  const track = `<circle cx="${size / 2}" cy="${size / 2}" r="${n2(r)}" stroke="${GRID}" stroke-width="${stroke}" fill="none" />`;
  const arcs =
    total > 0
      ? d.segments
          .map((seg) => {
            const frac = Math.max(0, seg.value) / total;
            const dash = frac * c;
            const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${n2(r)}" stroke="${seg.color}" stroke-width="${stroke}" fill="none" stroke-dasharray="${n2(dash)} ${n2(c - dash)}" stroke-dashoffset="${n2(-acc)}" />`;
            acc += dash;
            return el;
          })
          .join('')
      : '';
  const center =
    d.centerTop || d.centerBottom
      ? `<div class="donut-center">${d.centerTop ? `<div class="donut-top">${esc(d.centerTop)}</div>` : ''}${d.centerBottom ? `<div class="donut-bottom">${esc(d.centerBottom)}</div>` : ''}</div>`
      : '';
  const donut = `<div class="donut" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><g transform="rotate(-90 ${size / 2} ${size / 2})">${track}${arcs}</g></svg>
      ${center}
    </div>`;
  const legend = `<div class="legend">${d.segments
    .map(
      (seg) => `<div class="legend-row">
        <span class="legend-name"><span class="dot" style="background:${seg.color}"></span>${esc(seg.label)}</span>
        ${seg.valueText ? `<span class="legend-val">${esc(seg.valueText)}</span>` : ''}
      </div>`
    )
    .join('')}</div>`;
  return `<div class="donut-wrap">${donut}${legend}</div>`;
}

// --------------------------------------------------------------- leaderboard (HTML/CSS)
// Faithful copy of HBarLeaderboard in components/charts.tsx.
function leadersHtml(spec: LeaderSpec): string {
  if (spec.rows.length === 0) return '';
  const max = Math.max(...spec.rows.map((r) => r.value), 1);
  return `<div class="leaders">${spec.rows
    .map((r) => {
      const pct = max > 0 ? Math.max(0.04, r.value / max) : 0;
      return `<div class="leader">
        <div class="leader-head">
          <span class="leader-label">${esc(r.label)}${r.note ? `<span class="leader-note">  ${esc(r.note)}</span>` : ''}</span>
          <span class="leader-val">${esc(r.valueText)}</span>
        </div>
        <div class="track"><div class="fill" style="width:${n2(pct * 100)}%;background:${spec.color}"></div></div>
      </div>`;
    })
    .join('')}</div>`;
}

function rowsHtml(s: ReportSection): string {
  return s.rows
    .map(
      (r) => `<div class="row">
        <span class="row-label">${esc(r.label)}${r.note ? `<span class="note"> ${esc(r.note)}</span>` : ''}</span>
        <span class="row-value">${esc(r.value)}</span>
      </div>`
    )
    .join('');
}

function sectionHtml(s: ReportSection): string {
  const hasVisual = !!(s.donut || s.bar || s.line || (s.leaders && s.leaders.rows.length));
  let body: string;
  if (!hasVisual && s.rows.length === 0) {
    body = `<p class="empty">${esc(s.empty ?? 'No data for this period.')}</p>`;
  } else {
    const parts: string[] = [];
    if (s.donut) parts.push(donutHtml(s.donut));
    if (s.bar) parts.push(`<div class="chart">${barSvg(s.bar)}</div>`);
    if (s.line) parts.push(`<div class="chart">${lineSvg(s.line)}</div>`);
    if (s.caption) parts.push(`<p class="caption">${esc(s.caption)}</p>`);
    if (s.leaders && s.leaders.rows.length) parts.push(leadersHtml(s.leaders));
    if (s.rows.length) parts.push(rowsHtml(s));
    body = parts.join('');
  }
  return `<section class="card"><h2>${esc(s.title)}</h2>${body}</section>`;
}

function statStrip(stats: ReportStat[]): string {
  if (!stats.length) return '';
  return `<div class="stats">${stats
    .map(
      (st) => `<div class="stat">
        <div class="stat-value" style="color:${st.color ?? INK}">${esc(st.value)}</div>
        <div class="stat-label">${esc(st.label)}</div>
      </div>`
    )
    .join('')}</div>`;
}

export function buildReportHtml(d: ReportData): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --brand: ${BRAND}; --ink: ${INK}; --ink2: ${INK2}; --ink3: ${INK3};
    --hair: ${HAIR}; --paper: ${PAPER}; --grid: ${GRID};
    --font-display: "Bricolage Grotesque", "Segoe UI", system-ui, -apple-system, sans-serif;
    --font-body: "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 30px 26px 40px;
    font-family: var(--font-body);
    color: var(--ink); background: var(--paper);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .kicker { font-family: var(--font-body); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin: 0 0 4px; }
  h1 { font-family: var(--font-display); font-size: 30px; font-weight: 700; margin: 0 0 2px; letter-spacing: -.01em; }
  .range { color: var(--ink2); font-size: 13px; margin: 0 0 16px; }
  .headline {
    background: linear-gradient(120deg, #EAF7EC 0%, #F6FBF3 100%);
    border: 1px solid #DCEAD4; border-radius: 16px; padding: 15px 17px; margin: 0 0 16px;
    font-family: var(--font-display); font-size: 16px; font-weight: 600; color: #1B5E2A; line-height: 1.35;
  }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 20px; }
  .stat { flex: 1 1 28%; min-width: 90px; background: #fff; border: 1px solid var(--hair); border-radius: 14px; padding: 11px 13px; }
  .stat-value { font-family: var(--font-display); font-size: 21px; font-weight: 700; line-height: 1.1; }
  .stat-label { font-size: 11px; color: var(--ink3); margin-top: 2px; }

  section.card {
    background: #fff; border: 1px solid var(--hair); border-radius: 16px;
    padding: 15px 16px; margin: 0 0 14px; page-break-inside: avoid;
    box-shadow: 0 1px 2px rgba(20,40,30,.04);
  }
  h2 { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--ink); margin: 0 0 10px; letter-spacing: -.01em; }

  .chart { margin: 2px 0 4px; page-break-inside: avoid; }
  .chart-svg { display: block; }
  .caption { text-align: center; font-size: 10.5px; color: var(--ink3); margin: 4px 0 2px; }

  .donut-wrap { display: flex; align-items: center; gap: 18px; page-break-inside: avoid; }
  .donut { position: relative; flex: none; }
  .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .donut-top { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); }
  .donut-bottom { font-size: 11px; color: var(--ink3); margin-top: 1px; }
  .legend { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .legend-row { display: flex; align-items: center; justify-content: space-between; }
  .legend-name { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--ink); }
  .legend-val { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }

  .leaders { display: flex; flex-direction: column; gap: 9px; }
  .leader-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
  .leader-label { font-size: 12.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; }
  .leader-note { color: var(--ink3); font-weight: 400; }
  .leader-val { font-size: 12.5px; font-weight: 700; color: var(--ink2); white-space: nowrap; }
  .track { height: 7px; border-radius: 999px; background: var(--grid); overflow: hidden; }
  .fill { height: 7px; border-radius: 999px; }

  .row { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; font-size: 13.5px; }
  .row + .row { border-top: 1px solid #F0F3EC; }
  .row-label { color: var(--ink); font-weight: 500; }
  .note { color: var(--ink3); font-weight: 400; font-size: 12px; }
  .row-value { color: var(--ink); font-weight: 700; white-space: nowrap; padding-left: 12px; }
  .empty { color: var(--ink3); font-size: 12.5px; margin: 4px 0; }
  footer { margin-top: 22px; color: #9AA79B; font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <p class="kicker">NutriCraft Insights</p>
  <h1>${esc(d.periodLabel)}</h1>
  <p class="range">${esc(d.dateRange)}</p>
  <div class="headline">${esc(d.headline)}</div>
  ${statStrip(d.stats ?? [])}
  ${d.sections.map(sectionHtml).join('')}
  <footer>Generated by NutriCraft · local-first nutrition &amp; price tracker</footer>
</body>
</html>`;
}
