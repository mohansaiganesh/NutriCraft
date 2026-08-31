import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { dayLogsQuery, removeLog, settingsQuery } from '@/db/queries';
import { nutritionFor, sumNutrition, type NutritionTotals } from '@/lib/nutrition';
import { addDaysISO, dateLabel, fmt, money, todayISO } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { Card, Muted } from '@/components/ui';
import { MacroChips, TargetProgress } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

type Row = { log: { id: string; grams: number; mealType: string }; food: FoodItem };

function entryTotals(food: FoodItem, grams: number): NutritionTotals {
  return nutritionFor(food, grams);
}

export default function TodayScreen() {
  const [date, setDate] = useState(todayISO());
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const { data: rows } = useLiveQuery(dayLogsQuery(date), [date]);

  const settings = settingsRows?.[0];
  const allRows = (rows ?? []) as Row[];
  const dayTotals = sumNutrition(allRows.map((r) => entryTotals(r.food, r.log.grams)));
  const currency = settings?.currency ?? '$';

  const confirmDelete = (id: string, name: string) => {
    Alert.alert('Remove entry', `Remove ${name} from ${dateLabel(date)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeLog(id) },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-neutral-50 dark:bg-black" contentContainerClassName="p-4 pb-24">
      {/* Date navigator */}
      <View className="flex-row items-center justify-between mb-4">
        <Pressable
          onPress={() => setDate((d) => addDaysISO(d, -1))}
          className="w-10 h-10 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 items-center justify-center"
        >
          <Text className="text-lg text-neutral-700 dark:text-neutral-200">‹</Text>
        </Pressable>
        <Pressable onPress={() => setDate(todayISO())} className="items-center">
          <Text className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
            {dateLabel(date)}
          </Text>
          <Muted className="text-xs">{date}</Muted>
        </Pressable>
        <Pressable
          onPress={() => setDate((d) => addDaysISO(d, 1))}
          className="w-10 h-10 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 items-center justify-center"
        >
          <Text className="text-lg text-neutral-700 dark:text-neutral-200">›</Text>
        </Pressable>
      </View>

      {/* Targets */}
      {settings ? (
        <Card className="mb-4">
          <TargetProgress totals={dayTotals} settings={settings} />
        </Card>
      ) : null}

      {/* Meal sections */}
      {MEAL_TYPES.map(({ key, label, icon }) => {
        const sectionRows = allRows.filter((r) => r.log.mealType === key);
        const sectionTotals = sumNutrition(
          sectionRows.map((r) => entryTotals(r.food, r.log.grams))
        );
        return (
          <Card key={key} className="mb-3">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-base font-bold text-neutral-900 dark:text-neutral-50">
                {icon} {label}
              </Text>
              <Text className="text-sm text-neutral-500">
                {fmt(sectionTotals.calories)} kcal · {money(sectionTotals.cost, currency)}
              </Text>
            </View>

            {sectionRows.length === 0 ? (
              <Muted className="text-sm py-1">Nothing logged yet.</Muted>
            ) : (
              sectionRows.map((r) => (
                <Pressable
                  key={r.log.id}
                  onLongPress={() => confirmDelete(r.log.id, r.food.name)}
                  onPress={() =>
                    router.push({
                      pathname: '/log/[id]',
                      params: {
                        id: r.log.id,
                        grams: String(r.log.grams),
                        mealType: r.log.mealType,
                        name: r.food.name,
                      },
                    })
                  }
                  className="py-2 border-t border-neutral-100 dark:border-neutral-800"
                >
                  <View className="flex-row justify-between">
                    <Text className="text-neutral-800 dark:text-neutral-100 flex-1 pr-2" numberOfLines={1}>
                      {r.food.name.replace(/_/g, ' ')}
                    </Text>
                    <Text className="text-neutral-500">{fmt(r.log.grams)}g</Text>
                  </View>
                  <MacroChips totals={entryTotals(r.food, r.log.grams)} currency={currency} />
                </Pressable>
              ))
            )}

            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/pick-food',
                  params: { mode: 'log', date, mealType: key as MealType },
                })
              }
              className="mt-2 py-2 items-center rounded-xl bg-sky-50 dark:bg-sky-950"
            >
              <Text className="text-sky-600 font-semibold">+ Add food</Text>
            </Pressable>
          </Card>
        );
      })}
    </ScrollView>
  );
}
