import { View, Text } from 'react-native';
import type { NutritionTotals } from '@/lib/nutrition';
import type { Settings } from '@/db/schema';
import { fmt, money } from '@/lib/format';

/** Compact colored macro chips: calories · P/C/F/fiber · cost. */
export function MacroChips({
  totals,
  currency = '$',
}: {
  totals: NutritionTotals;
  currency?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1">
      <Text className="text-sky-600 font-semibold">{fmt(totals.calories)} kcal</Text>
      <Text className="text-red-500">P {fmt(totals.proteinG, 1)}g</Text>
      <Text className="text-amber-500">C {fmt(totals.carbsG, 1)}g</Text>
      <Text className="text-violet-500">F {fmt(totals.fatG, 1)}g</Text>
      <Text className="text-emerald-500">Fib {fmt(totals.fiberG, 1)}g</Text>
      <Text className="text-neutral-500">{money(totals.cost, currency)}</Text>
    </View>
  );
}

function ProgressRow({
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
    <View className="mb-3">
      <View className="flex-row justify-between mb-1">
        <Text className="text-neutral-700 dark:text-neutral-200 font-medium">{label}</Text>
        <Text className={over ? 'text-red-500' : 'text-neutral-500 dark:text-neutral-400'}>
          {fmt(value, unit === 'g' ? 1 : 0)}
          {unit} <Text className="text-neutral-400">/ {fmt(target)}{unit}</Text>
        </Text>
      </View>
      <View className="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <View
          style={{ width: `${pct}%`, backgroundColor: over ? '#ef4444' : color }}
          className="h-2 rounded-full"
        />
      </View>
    </View>
  );
}

/** Daily totals vs targets, plus the running cost for the day. */
export function TargetProgress({
  totals,
  settings,
}: {
  totals: NutritionTotals;
  settings: Settings;
}) {
  return (
    <View>
      <ProgressRow label="Calories" value={totals.calories} target={settings.targetCalories} unit=" kcal" color="#0ea5e9" />
      <ProgressRow label="Protein" value={totals.proteinG} target={settings.targetProteinG} unit="g" color="#ef4444" />
      <ProgressRow label="Carbs" value={totals.carbsG} target={settings.targetCarbsG} unit="g" color="#f59e0b" />
      <ProgressRow label="Fat" value={totals.fatG} target={settings.targetFatG} unit="g" color="#8b5cf6" />
      <ProgressRow label="Fiber" value={totals.fiberG} target={settings.targetFiberG} unit="g" color="#10b981" />
      <ProgressRow label="Sodium" value={totals.sodiumMg} target={settings.targetSodiumMg} unit="mg" color="#64748b" />
      <View className="flex-row justify-between pt-2 mt-1 border-t border-neutral-200 dark:border-neutral-800">
        <Text className="text-neutral-700 dark:text-neutral-200 font-semibold">Cost today</Text>
        <Text className="text-neutral-900 dark:text-neutral-100 font-semibold">
          {money(totals.cost, settings.currency)}
        </Text>
      </View>
    </View>
  );
}
