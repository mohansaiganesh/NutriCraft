import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { NutritionTotals } from '@/lib/nutrition';
import type { Settings } from '@/db/schema';
import { fmt, money } from '@/lib/format';

/** Compact colored macro chips: calories · P/C/F/fiber · cost. */
function MacroChipsBase({
  totals,
  currency = '$',
  macrosOnly = false,
  split = false,
  emphasizeMacros = false,
}: {
  totals: NutritionTotals;
  currency?: string;
  /** When true, omit calories + cost and show only the P/C/F/fiber macros. */
  macrosOnly?: boolean;
  /** When true, put calories + cost on their own row above the macros. */
  split?: boolean;
  /** When true, render the macros bold and larger. */
  emphasizeMacros?: boolean;
}) {
  const macroClass = emphasizeMacros ? 'font-body-b text-[15px]' : 'font-body-sb text-[13px]';
  const macros = (
    <>
      <Text className={`text-protein ${macroClass}`}>P {fmt(totals.proteinG, 1)}g</Text>
      <Text className={`text-carbs ${macroClass}`}>C {fmt(totals.carbsG, 1)}g</Text>
      <Text className={`text-fat ${macroClass}`}>F {fmt(totals.fatG, 1)}g</Text>
      <Text className={`text-fiber ${macroClass}`}>Fib {fmt(totals.fiberG, 1)}g</Text>
    </>
  );

  if (split) {
    return (
      <View className="mt-[6px]">
        <View className="flex-row gap-x-3">
          <Text className="font-body-b text-cal text-[13px]">{fmt(totals.calories)} kcal</Text>
          <Cost cost={totals.cost} currency={currency} className="font-body-sb text-cost text-[13px]" />
        </View>
        <View className="flex-row flex-wrap gap-x-3 gap-y-1 mt-[6px]">{macros}</View>
      </View>
    );
  }

  return (
    <View className={`flex-row flex-wrap gap-x-3 gap-y-1 mt-[6px] ${emphasizeMacros ? 'justify-center' : ''}`}>
      {!macrosOnly && (
        <Text className="font-body-b text-cal text-[13px]">{fmt(totals.calories)} kcal</Text>
      )}
      {macros}
      {!macrosOnly && (
        <Cost cost={totals.cost} currency={currency} className="font-body-sb text-cost text-[13px]" />
      )}
    </View>
  );
}

/** Rendered once per row in the Foods list — memoized so rows can bail out of re-render. */
export const MacroChips = React.memo(MacroChipsBase);

/**
 * Cost display. A real price renders as money; `$0` renders as red "$ N/A" to mark an
 * unknown price. Pass `count` for an aggregate (meal/section/day): an empty group (0 items)
 * shows a normal $0.00, while a non-empty all-unpriced group still shows red "$ N/A".
 */
export function Cost({
  cost,
  currency = '$',
  className,
  count,
}: {
  cost: number;
  currency?: string;
  className?: string;
  /** Number of items in the aggregate; omit for a single food. 0 → show $0.00, not N/A. */
  count?: number;
}) {
  const na = count !== 0 && !(cost > 0); // 0/negative/NaN cost on a non-empty group → unknown
  return (
    <Text className={className}>
      {na ? (
        <>
          {currency}
          {' '}
          <Text style={{ color: '#E03131' }}>N/A</Text>
        </>
      ) : (
        money(cost, currency)
      )}
    </Text>
  );
}

/** Circular progress ring for the day's calories. */
function CalorieRing({
  value,
  target,
  size = 150,
}: {
  value: number;
  target: number;
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const offset = c * (1 - pct);
  const over = target > 0 && value > target;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#EAF0E6" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? '#E03131' : '#2F9E44'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View className="absolute items-center">
        <Text className="font-display text-[32px] leading-[34px] text-ink">{fmt(value)}</Text>
        <Text className="font-body text-[12px] text-ink3 mt-[2px]">of {fmt(target)} kcal</Text>
      </View>
    </View>
  );
}

function MacroBar({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: string;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target;
  return (
    <View className="mb-[11px]">
      <View className="flex-row justify-between mb-[5px]">
        <Text className="font-body-b text-[13px]" style={{ color: over ? '#E03131' : color }}>
          {label}
        </Text>
        <Text className="font-body-sb text-[13px] text-ink2">
          {fmt(value, unit === 'g' ? 1 : 0)} / {fmt(target)}
          {unit}
        </Text>
      </View>
      <View className="h-[7px] rounded-full bg-[#EAF0E6] overflow-hidden">
        <View
          style={{ width: `${pct}%`, backgroundColor: over ? '#E03131' : color }}
          className="h-[7px] rounded-full"
        />
      </View>
    </View>
  );
}

/** The Today hero: calorie ring + macro bars + running cost. */
export function TargetProgress({
  totals,
  settings,
  itemCount,
}: {
  totals: NutritionTotals;
  settings: Settings;
  /** Number of logged entries today; lets an empty day show $0.00 instead of "$ N/A". */
  itemCount?: number;
}) {
  const left = Math.max(0, settings.targetCalories - totals.calories);
  return (
    <View>
      <View className="flex-row items-start justify-between">
        <Text className="font-body-b text-[12px] tracking-wide text-ink2 uppercase">
          Today's intake
        </Text>
        <View className="rounded-full px-3 py-[6px] bg-[#EAF7EC]">
          <Text className="font-body-b text-[12.5px] text-[#1B7A32]">{fmt(left)} kcal left</Text>
        </View>
      </View>

      <View className="flex-row items-center mt-3" style={{ gap: 20 }}>
        <CalorieRing value={totals.calories} target={settings.targetCalories} />
        <View className="flex-1">
          <MacroBar label="Protein" value={totals.proteinG} target={settings.targetProteinG} unit="g" color="#E8590C" />
          <MacroBar label="Carbs" value={totals.carbsG} target={settings.targetCarbsG} unit="g" color="#F08C00" />
          <MacroBar label="Fat" value={totals.fatG} target={settings.targetFatG} unit="g" color="#7048E8" />
          <MacroBar label="Fiber" value={totals.fiberG} target={settings.targetFiberG} unit="g" color="#0CA678" />
        </View>
      </View>

      <View className="flex-row justify-between pt-3 mt-[14px] border-t border-[#EEF1EA]">
        <Text className="font-body-b text-[14px] text-ink">Spent today</Text>
        <Cost
          cost={totals.cost}
          currency={settings.currency}
          count={itemCount}
          className="font-display-sb text-[18px] text-ink"
        />
      </View>
    </View>
  );
}
