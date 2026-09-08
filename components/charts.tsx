/**
 * Hand-rolled SVG chart primitives for the Insights dashboard — no chart library, matching the
 * approach of `CalorieRing` in `components/nutrition.tsx`. Each chart measures its own container
 * width (via onLayout) so it fills whatever card it sits in; height is a fixed prop.
 *
 * Colors are passed in from the screen using the Garden tokens (tailwind.config.js).
 */

import { useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect } from 'react-native-svg';
import { fmt, money } from '@/lib/format';

/** Measure the available width so an SVG can fill its parent. Returns 0 until first layout. */
function useMeasuredWidth(): [number, (w: number) => void] {
  const [w, setW] = useState(0);
  return [w, setW];
}

const GRID = '#EAF0E6';
const AXIS_LABEL = '#8B9A8D';

// --------------------------------------------------------------- BarChart

/** Vertical bars for a daily series (calories or spend). Bars above `target` flip to `overColor`. */
export function BarChart({
  values,
  color,
  height = 120,
  target,
  overColor = '#E03131',
  targetColor = '#8B9A8D',
}: {
  values: number[];
  color: string;
  height?: number;
  target?: number;
  overColor?: string;
  targetColor?: string;
}) {
  const [width, setWidth] = useMeasuredWidth();
  const n = values.length;
  const max = Math.max(...values, target ?? 0, 1);
  const pad = 2;
  const slot = n > 0 ? (width - pad * 2) / n : 0;
  const barW = Math.max(1, slot * 0.62);
  const targetY = target ? height - (target / max) * height : null;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 && n > 0 ? (
        <Svg width={width} height={height}>
          {targetY !== null ? (
            <Line
              x1={0}
              y1={targetY}
              x2={width}
              y2={targetY}
              stroke={targetColor}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ) : null}
          {values.map((v, i) => {
            const h = max > 0 ? (v / max) * height : 0;
            const x = pad + i * slot + (slot - barW) / 2;
            const over = target != null && v > target;
            return (
              <Rect
                key={i}
                x={x}
                y={height - h}
                width={barW}
                height={Math.max(0, h)}
                rx={Math.min(3, barW / 2)}
                fill={over ? overColor : color}
                opacity={v > 0 ? 1 : 0.25}
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- LineChart

/** A single-series line with dots, optional target line, over a faint baseline grid. */
export function LineChart({
  values,
  color,
  height = 96,
  target,
}: {
  values: number[];
  color: string;
  height?: number;
  target?: number;
}) {
  const [width, setWidth] = useMeasuredWidth();
  const n = values.length;
  const max = Math.max(...values, target ?? 0, 1);
  const padX = 3;
  const padY = 6;
  const usableH = height - padY * 2;
  const x = (i: number) => (n > 1 ? padX + (i / (n - 1)) * (width - padX * 2) : width / 2);
  const y = (v: number) => padY + usableH - (max > 0 ? (v / max) * usableH : 0);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const targetY = target ? y(target) : null;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 && n > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={0} y1={height - padY} x2={width} y2={height - padY} stroke={GRID} strokeWidth={1} />
          {targetY !== null ? (
            <Line x1={0} y1={targetY} x2={width} y2={targetY} stroke={AXIS_LABEL} strokeWidth={1} strokeDasharray="4 4" />
          ) : null}
          {n > 1 ? <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {values.map((v, i) => (
            <Circle key={i} cx={x(i)} cy={y(v)} r={n > 24 ? 1.5 : 2.5} fill={color} opacity={v > 0 ? 1 : 0.3} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- DonutChart

export interface DonutSegment {
  label: string;
  value: number; // percentage or raw; only relative size matters
  color: string;
}

/** Macro-split (or any) donut. Segments drawn with dasharray arcs, like the calorie ring. */
export function DonutChart({
  segments,
  size = 132,
  stroke = 16,
  centerTop,
  centerBottom,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  centerTop?: string;
  centerBottom?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  let acc = 0;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={GRID} strokeWidth={stroke} fill="none" />
          {total > 0
            ? segments.map((seg, i) => {
                const frac = Math.max(0, seg.value) / total;
                const dash = frac * c;
                const el = (
                  <Circle
                    key={i}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={seg.color}
                    strokeWidth={stroke}
                    fill="none"
                    strokeDasharray={`${dash} ${c - dash}`}
                    strokeDashoffset={-acc}
                  />
                );
                acc += dash;
                return el;
              })
            : null}
        </G>
      </Svg>
      {centerTop || centerBottom ? (
        <View className="absolute items-center">
          {centerTop ? <Text className="font-display text-[20px] text-ink">{centerTop}</Text> : null}
          {centerBottom ? <Text className="font-body text-[11px] text-ink3 mt-[1px]">{centerBottom}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- HBarLeaderboard

export interface LeaderRow {
  label: string;
  sublabel?: string;
  value: number;
  /** Pre-formatted value text; falls back to a rounded number. */
  valueText?: string;
}

/** A ranked list with a proportional bar behind each row — foods, brands, meals. */
export function HBarLeaderboard({
  rows,
  color,
  emptyText = 'No data yet.',
}: {
  rows: LeaderRow[];
  color: string;
  emptyText?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) {
    return <Text className="font-body text-[12px] text-ink3">{emptyText}</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r, i) => {
        const pct = max > 0 ? Math.max(0.04, r.value / max) : 0;
        return (
          <View key={`${r.label}-${i}`}>
            <View className="flex-row items-center justify-between mb-[3px]">
              <Text className="font-body-sb text-[12.5px] text-ink flex-1 mr-2" numberOfLines={1}>
                {r.label}
                {r.sublabel ? <Text className="font-body text-ink3">  {r.sublabel}</Text> : null}
              </Text>
              <Text className="font-body-b text-[12.5px] text-ink2">{r.valueText ?? fmt(r.value, 1)}</Text>
            </View>
            <View className="h-[7px] rounded-full overflow-hidden" style={{ backgroundColor: GRID }}>
              <View style={{ width: `${pct * 100}%`, backgroundColor: color }} className="h-[7px] rounded-full" />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Small helper so screens can format currency leaderboard values consistently. */
export const moneyText = (n: number, currency = '$') => money(n, currency);
