import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { allMealItemsQuery, mealsQuery, settingsQuery, softDeleteMeal } from '@/db/queries';
import { nutritionFor, sumNutrition, type NutritionTotals } from '@/lib/nutrition';
import { fmt, titleCase } from '@/lib/format';
import { Cost } from '@/components/nutrition';
import { AppHeader, Card, EmptyState, Fab, Muted } from '@/components/ui';
import { IconChevronDown, IconChevronRight, IconMeal, IconPencil, IconPlus } from '@/components/icons';
import type { FoodItem, Meal, MealItem } from '@/db/schema';

type ItemRow = { item: MealItem; food: FoodItem };
type MealStats = { count: number; unpriced: number; totals: NutritionTotals };

export default function MealsScreen() {
  const { data } = useLiveQuery(mealsQuery());
  const { data: itemRows } = useLiveQuery(allMealItemsQuery());
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const meals = (data ?? []) as Meal[];
  const currency = settingsRows?.[0]?.currency ?? '$';
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { statsByMeal, itemsByMeal } = useMemo(() => {
    const grouped = new Map<string, { totalsList: NutritionTotals[]; unpriced: number }>();
    const items = new Map<string, ItemRow[]>();
    for (const row of (itemRows ?? []) as ItemRow[]) {
      const { item, food } = row;
      const entry = grouped.get(item.mealId) ?? { totalsList: [], unpriced: 0 };
      entry.totalsList.push(nutritionFor(food, item.grams));
      if (!(food.pricePer100 > 0)) entry.unpriced += 1;
      grouped.set(item.mealId, entry);
      const list = items.get(item.mealId) ?? [];
      list.push(row);
      items.set(item.mealId, list);
    }
    const stats = new Map<string, MealStats>();
    for (const [mealId, { totalsList, unpriced }] of grouped) {
      stats.set(mealId, { count: totalsList.length, unpriced, totals: sumNutrition(totalsList) });
    }
    return { statsByMeal: stats, itemsByMeal: items };
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
          const unpriced = stats?.unpriced ?? 0;
          const totals = stats?.totals ?? sumNutrition([]);
          const rows = itemsByMeal.get(item.id) ?? [];
          const isOpen = !!open[item.id];
          return (
            <Card className="mb-3 p-0 overflow-hidden" style={{ backgroundColor: '#5A7D21' }}>
              <View>
                <View
                  className="flex-row items-center justify-between relative p-4 pb-[15px]"
                  style={{ gap: 8 }}
                >
                  <Pressable
                    onPress={() => setOpen((o) => ({ ...o, [item.id]: !o[item.id] }))}
                    onLongPress={() => confirmDeleteMeal(item.id, item.name)}
                    className="flex-row items-center flex-1 active:opacity-70"
                    style={{ gap: 10 }}
                  >
                    <View
                      className="w-[34px] h-[34px] rounded-xl items-center justify-center"
                      style={{
                        backgroundColor: '#DCFCE7',
                        marginLeft: -6,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.18)',
                      }}
                    >
                      <IconMeal size={19} color="#2F9E44" />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center" style={{ gap: 6 }}>
                        <Text className="font-display-sb text-[17px] text-white shrink" numberOfLines={1}>
                          {item.name}
                        </Text>
                        {isOpen ? (
                          <IconChevronDown size={16} color="#E4EDD5" />
                        ) : (
                          <IconChevronRight size={16} color="#E4EDD5" />
                        )}
                      </View>
                      {item.notes ? (
                        <Text className="font-body text-[12.5px] text-[#DCE7C6] mt-[2px]" numberOfLines={1}>
                          {item.notes}
                        </Text>
                      ) : null}
                      <Text className="font-body-b text-[13px] text-white mt-[1px]">
                        {count} {count === 1 ? 'item' : 'items'} · <Text className="text-[#D8F5B0]">{fmt(totals.calories)} kcal</Text> · <Cost cost={totals.cost} currency={currency} count={count} />
                      </Text>
                      {count > 0 ? (
                        <View className="flex-row gap-x-2 mt-[3px]">
                          <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#FFC078' }}>P</Text> {fmt(totals.proteinG, 1)}g</Text>
                          <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#FFE066' }}>C</Text> {fmt(totals.carbsG, 1)}g</Text>
                          <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#D0BFFF' }}>F</Text> {fmt(totals.fatG, 1)}g</Text>
                          <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#96F2D7' }}>Fib</Text> {fmt(totals.fiberG, 1)}g</Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                  {unpriced > 0 ? (
                    <Text className="absolute right-4 top-4 font-body-sb text-[12px] text-[#FFC9C9]">
                      {unpriced} {unpriced === 1 ? 'item' : 'items'} · prices N/A
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/pick-food',
                        params: { mode: 'meal', mealId: item.id, mealName: item.name },
                      })
                    }
                    className="w-[42px] h-[42px] rounded-full bg-white items-center justify-center active:opacity-80"
                    style={{ marginTop: 15, marginRight: -2 }}
                  >
                    <IconPlus size={16} color="#5A7D21" />
                  </Pressable>
                </View>
              </View>

              {isOpen ? (
                <View className="bg-card px-[18px] pt-[2px] pb-[10px]">
                {rows.length === 0 ? (
                  <View className="flex-row items-center flex-wrap py-2" style={{ gap: 4 }}>
                    <Muted className="text-[13px]">Tap</Muted>
                    <View className="w-[20px] h-[20px] rounded-full bg-brand items-center justify-center">
                      <IconPlus size={13} color="#FFFFFF" />
                    </View>
                    <Muted className="text-[13px]">to add food to this meal.</Muted>
                  </View>
                ) : (
                  rows.map((r) => {
                    const itemTotals = nutritionFor(r.food, r.item.grams);
                    return (
                      <View
                        key={r.item.id}
                        className="py-[11px] border-t border-[#F0F3EC] flex-row items-center"
                        style={{ gap: 10 }}
                      >
                        <View className="flex-1">
                          <View className="flex-row items-baseline shrink">
                            <Text className="font-body-sb text-ink text-[16px] shrink" numberOfLines={1}>
                              {titleCase(r.food.name)}
                            </Text>
                            <Text className="font-body-sb text-ink3 text-[13px] ml-2">
                              ({fmt(r.item.grams)} g)
                            </Text>
                          </View>
                          {r.food.brand ? (
                            <Text className="font-body text-ink3 text-[11px] mt-[1px]" numberOfLines={1}>
                              {titleCase(r.food.brand)}
                            </Text>
                          ) : null}
                          <View className="flex-row gap-x-3 mt-[6px]">
                            <Text className="font-body-sb text-ink text-[13px]"><Text className="text-protein font-body-b">P</Text> {fmt(itemTotals.proteinG, 1)}g</Text>
                            <Text className="font-body-sb text-ink text-[13px]"><Text className="text-carbs font-body-b">C</Text> {fmt(itemTotals.carbsG, 1)}g</Text>
                            <Text className="font-body-sb text-ink text-[13px]"><Text className="text-fat font-body-b">F</Text> {fmt(itemTotals.fatG, 1)}g</Text>
                            <Text className="font-body-sb text-ink text-[13px]"><Text className="text-fiber font-body-b">Fib</Text> {fmt(itemTotals.fiberG, 1)}g</Text>
                          </View>
                          <View className="flex-row gap-x-3 mt-[4px]">
                            <Text className="font-body-b text-cal text-[13px]">{fmt(itemTotals.calories)} kcal</Text>
                            <Cost cost={itemTotals.cost} currency={currency} className="font-body-sb text-cost text-[13px]" />
                          </View>
                        </View>
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/meal-item/[id]',
                              params: { id: r.item.id, grams: String(r.item.grams), name: r.food.name },
                            })
                          }
                          hitSlop={8}
                          className="w-[36px] h-[36px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
                        >
                          <IconPencil size={16} color="#1B7A32" />
                        </Pressable>
                      </View>
                    );
                  })
                )}
                </View>
              ) : null}
            </Card>
          );
        }}
      />
      <Fab onPress={newMeal} />
    </View>
  );
}
