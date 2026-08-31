import { useMemo } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { allMealItemsQuery, mealsQuery, settingsQuery, softDeleteMeal } from '@/db/queries';
import { nutritionFor, sumNutrition, type NutritionTotals } from '@/lib/nutrition';
import { fmt, money } from '@/lib/format';
import { AppHeader, cardShadow, EmptyState, Fab } from '@/components/ui';
import { IconChevronRight, IconMeal } from '@/components/icons';
import type { FoodItem, Meal, MealItem } from '@/db/schema';

type ItemRow = { item: MealItem; food: FoodItem };
type MealStats = { count: number; totals: NutritionTotals };

export default function MealsScreen() {
  const { data } = useLiveQuery(mealsQuery());
  const { data: itemRows } = useLiveQuery(allMealItemsQuery());
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const meals = (data ?? []) as Meal[];
  const currency = settingsRows?.[0]?.currency ?? '$';

  const statsByMeal = useMemo(() => {
    const grouped = new Map<string, NutritionTotals[]>();
    for (const { item, food } of (itemRows ?? []) as ItemRow[]) {
      const list = grouped.get(item.mealId) ?? [];
      list.push(nutritionFor(food, item.grams));
      grouped.set(item.mealId, list);
    }
    const stats = new Map<string, MealStats>();
    for (const [mealId, totalsList] of grouped) {
      stats.set(mealId, { count: totalsList.length, totals: sumNutrition(totalsList) });
    }
    return stats;
  }, [itemRows]);

  const newMeal = () => {
    router.push({ pathname: '/meal/[id]', params: { id: 'new' } });
  };

  const confirmDeleteMeal = (id: string, name: string) => {
    Alert.alert('Delete meal', `Delete “${name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => softDeleteMeal(id) },
    ]);
  };

  return (
    <View className="flex-1 bg-paper">
      <FlatList
        data={meals}
        keyExtractor={(m) => m.id}
        contentContainerClassName="px-4 pb-24"
        ListHeaderComponent={
          <AppHeader
            kicker="Templates"
            title="Meals"
            subtitle="Build reusable meals and log them in one tap."
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No meal templates yet"
            subtitle="Tap + to build a reusable meal and log it in one tap."
          />
        }
        renderItem={({ item }) => {
          const stats = statsByMeal.get(item.id);
          const count = stats?.count ?? 0;
          const totals = stats?.totals ?? sumNutrition([]);
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/meal/[id]', params: { id: item.id } })}
              onLongPress={() => confirmDeleteMeal(item.id, item.name)}
              className="rounded-3xl bg-card border border-hair p-4 mb-3 flex-row items-center justify-between active:opacity-90"
              style={cardShadow}
            >
              <View className="flex-row items-center flex-1" style={{ gap: 12 }}>
                <View className="w-[44px] h-[44px] rounded-2xl bg-[#EAF7EC] items-center justify-center">
                  <IconMeal size={22} color="#2F9E44" />
                </View>
                <View className="flex-1 pr-2">
                  <Text className="font-display-sb text-[17px] text-ink" numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.notes ? (
                    <Text className="font-body text-[12.5px] text-ink3 mt-[2px]" numberOfLines={1}>
                      {item.notes}
                    </Text>
                  ) : null}
                  <Text className="font-body-b text-[13px] text-ink2 mt-[3px]">
                    {count} {count === 1 ? 'item' : 'items'} · <Text className="text-cal">{fmt(totals.calories)} kcal</Text> · {money(totals.cost, currency)}
                  </Text>
                  {count > 0 ? (
                    <View className="flex-row gap-x-2 mt-[3px]">
                      <Text className="font-body-sb text-protein text-[11px]">P {fmt(totals.proteinG, 1)}g</Text>
                      <Text className="font-body-sb text-carbs text-[11px]">C {fmt(totals.carbsG, 1)}g</Text>
                      <Text className="font-body-sb text-fat text-[11px]">F {fmt(totals.fatG, 1)}g</Text>
                      <Text className="font-body-sb text-fiber text-[11px]">Fib {fmt(totals.fiberG, 1)}g</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <IconChevronRight size={20} color="#C2CDBF" />
            </Pressable>
          );
        }}
      />
      <Fab onPress={newMeal} />
    </View>
  );
}
