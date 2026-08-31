import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { NutritionTotals } from '@/lib/nutrition';
import type { Settings } from '@/db/schema';
import { fmt, money } from '@/lib/format';

/** Compact colored macro chips: calories · P/C/F/fiber · cost. */
export function MacroChips({
  totals,
  currency = '$',
  macrosOnly = false,
}: {
  totals: NutritionTotals;
  currency?: string;
  /** When true, omit calories + cost and show only the P/C/F/fiber macros. */
  macrosOnly?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1 mt-[6px]">
      {!macrosOnly && (
        <Text className="font-body-b text-cal text-[13px]">{fmt(totals.calories)} kcal</Text>
      )}
      <Text className="font-body-sb text-protein text-[13px]">P {fmt(totals.proteinG, 1)}g</Text>
      <Text className="font-body-sb text-carbs text-[13px]">C {fmt(totals.carbsG, 1)}g</Text>
      <Text className="font-body-sb text-fat text-[13px]">F {fmt(totals.fatG, 1)}g</Text>
      <Text className="font-body-sb text-fiber text-[13px]">Fib {fmt(totals.fiberG, 1)}g</Text>
      {!macrosOnly && (
        <Text className="font-body-sb text-cost text-[13px]">{money(totals.cost, currency)}</Text>
      )}
    </View>
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
}: {
  totals: NutritionTotals;
  settings: Settings;
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
        <Text className="font-display-sb text-[18px] text-ink">
          {money(totals.cost, settings.currency)}
        </Text>
      </View>
    </View>
  );
}
