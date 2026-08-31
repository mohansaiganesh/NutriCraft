import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { dayLogsQuery, removeLog, settingsQuery } from '@/db/queries';
import { nutritionFor, sumNutrition, type NutritionTotals } from '@/lib/nutrition';
import { addDaysISO, dateLabel, fmt, money, todayISO } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { AddFoodButton, Card, Muted } from '@/components/ui';
import { IconChevronLeft, IconChevronRight, MealIcon } from '@/components/icons';
import { MacroChips, TargetProgress } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

type Row = { log: { id: string; grams: number; mealType: string }; food: FoodItem };

function entryTotals(food: FoodItem, grams: number): NutritionTotals {
  return nutritionFor(food, grams);
}

function NavButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      className="w-[42px] h-[42px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
    >
      {children}
    </Pressable>
  );
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(todayISO());
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const { data: rows } = useLiveQuery(dayLogsQuery(date), [date]);

  const settings = settingsRows?.[0];
  const allRows = (rows ?? []) as Row[];
  const dayTotals = sumNutrition(allRows.map((r) => entryTotals(r.food, r.log.grams)));
  const currency = settings?.currency ?? '$';

  const confirmDelete = (id: string, name: string) => {
    Alert.alert('Remove entry', `Remove ${name.replace(/_/g, ' ')} from ${dateLabel(date)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeLog(id) },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="px-4 pb-24">
      {/* Date navigator */}
      <View
        className="flex-row items-center justify-between mb-4"
        style={{ paddingTop: insets.top + 10 }}
      >
        <NavButton onPress={() => setDate((d) => addDaysISO(d, -1))}>
          <IconChevronLeft size={20} color="#3A4A3D" />
        </NavButton>
        <Pressable onPress={() => setDate(todayISO())} className="items-center">
          <Text className="font-display text-[22px] text-ink">{dateLabel(date)}</Text>
          <Text className="font-body text-[12px] text-ink3 mt-[1px]">{date}</Text>
        </Pressable>
        <NavButton onPress={() => setDate((d) => addDaysISO(d, 1))}>
          <IconChevronRight size={20} color="#3A4A3D" />
        </NavButton>
      </View>

      {/* Calorie-ring hero */}
      {settings ? (
        <Card className="mb-4">
          <TargetProgress totals={dayTotals} settings={settings} />
        </Card>
      ) : null}

      {/* Meal sections */}
      {MEAL_TYPES.map(({ key, label, icon, tint, tintBg }) => {
        const sectionRows = allRows.filter((r) => r.log.mealType === key);
        const sectionTotals = sumNutrition(
          sectionRows.map((r) => entryTotals(r.food, r.log.grams))
        );
        return (
          <Card key={key} className="mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 10 }}>
                <View
                  className="w-[34px] h-[34px] rounded-xl items-center justify-center"
                  style={{ backgroundColor: tintBg }}
                >
                  <MealIcon name={icon} size={19} color={tint} />
                </View>
                <Text className="font-display-sb text-[17px] text-ink">{label}</Text>
              </View>
              <Text className="font-body-b text-[13px] text-ink2">
                {fmt(sectionTotals.calories)} kcal · {money(sectionTotals.cost, currency)}
              </Text>
            </View>

            {sectionRows.length === 0 ? (
              <Muted className="text-[13px] py-2">Nothing logged yet.</Muted>
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
                  className="py-[11px] border-t border-[#F0F3EC] active:opacity-70"
                >
                  <View className="flex-row justify-between items-center">
                    <Text
                      className="font-body-sb text-ink flex-1 pr-2"
                      numberOfLines={1}
                    >
                      {r.food.name.replace(/_/g, ' ')}
                    </Text>
                    <Text className="font-body-sb text-ink3 text-[13px]">{fmt(r.log.grams)} g</Text>
                  </View>
                  <MacroChips totals={entryTotals(r.food, r.log.grams)} currency={currency} />
                </Pressable>
              ))
            )}

            <AddFoodButton
              onPress={() =>
                router.push({
                  pathname: '/pick-food',
                  params: { mode: 'log', date, mealType: key as MealType },
                })
              }
            />
          </Card>
        );
      })}
    </ScrollView>
  );
}
