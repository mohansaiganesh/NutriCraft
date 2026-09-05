import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { dayLogsQuery, removeLog, settingsQuery } from '@/db/queries';
import { nutritionFor, sumNutrition, type NutritionTotals } from '@/lib/nutrition';
import { addDaysISO, dateLabel, fmt, titleCase, todayISO } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { Card, Muted } from '@/components/ui';
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconPencil, IconPlus, MealIcon } from '@/components/icons';
import { Cost, TargetProgress } from '@/components/nutrition';
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
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const { data: rows } = useLiveQuery(dayLogsQuery(date), [date]);

  const settings = settingsRows?.[0];
  const allRows = (rows ?? []) as Row[];
  const dayTotals = sumNutrition(allRows.map((r) => entryTotals(r.food, r.log.grams)));
  const dayUnpricedCount = allRows.filter((r) => !(r.food.pricePer100 > 0)).length;
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
          <TargetProgress
            totals={dayTotals}
            settings={settings}
            itemCount={allRows.length}
            unpricedCount={dayUnpricedCount}
          />
        </Card>
      ) : null}

      {/* Meal sections */}
      {MEAL_TYPES.map(({ key, label, icon, tint, tintBg }) => {
        const sectionRows = allRows.filter((r) => r.log.mealType === key);
        const sectionTotals = sumNutrition(
          sectionRows.map((r) => entryTotals(r.food, r.log.grams))
        );
        const unpricedCount = sectionRows.filter((r) => !(r.food.pricePer100 > 0)).length;
        const isOpen = !!open[key];
        return (
          <Card key={key} className="mb-3 p-0 overflow-hidden" style={{ backgroundColor: '#5A7D21' }}>
            <View>
              <View
                className="flex-row items-center justify-between relative p-4 pb-[15px]"
                style={{ gap: 8 }}
              >
                <Pressable
                  onPress={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                  className="flex-row items-center flex-1 active:opacity-70"
                  style={{ gap: 10 }}
                >
                  <View
                    className="w-[34px] h-[34px] rounded-xl items-center justify-center"
                    style={{
                      backgroundColor: tintBg,
                      marginLeft: -6,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.18)',
                    }}
                  >
                    <MealIcon name={icon} size={19} color={tint} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <Text className="font-display-sb text-[17px] text-white">{label}</Text>
                      {isOpen ? (
                        <IconChevronDown size={16} color="#E4EDD5" />
                      ) : (
                        <IconChevronRight size={16} color="#E4EDD5" />
                      )}
                    </View>
                    <Text className="font-body-b text-[13px] text-white mt-[1px]">
                      {sectionRows.length} {sectionRows.length === 1 ? 'item' : 'items'} · <Text className="text-[#D8F5B0]">{fmt(sectionTotals.calories)} kcal</Text> · <Cost cost={sectionTotals.cost} currency={currency} count={sectionRows.length} />
                    </Text>
                    {sectionRows.length > 0 ? (
                      <View className="flex-row gap-x-2 mt-[3px]">
                        <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#FFC078' }}>P</Text> {fmt(sectionTotals.proteinG, 1)}g</Text>
                        <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#FFE066' }}>C</Text> {fmt(sectionTotals.carbsG, 1)}g</Text>
                        <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#D0BFFF' }}>F</Text> {fmt(sectionTotals.fatG, 1)}g</Text>
                        <Text className="font-body-sb text-[#F2F7E9] text-[13px]"><Text className="font-body-b" style={{ color: '#96F2D7' }}>Fib</Text> {fmt(sectionTotals.fiberG, 1)}g</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
                {unpricedCount > 0 ? (
                  <Text className="absolute right-4 top-4 font-body-sb text-[12px] text-[#FFC9C9]">
                    {unpricedCount} {unpricedCount === 1 ? 'item' : 'items'} prices N/A
                  </Text>
                ) : null}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/pick-food',
                      params: { mode: 'log', date, mealType: key as MealType },
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
              {sectionRows.length === 0 ? (
                <View className="flex-row items-center flex-wrap py-2" style={{ gap: 4 }}>
                  <Muted className="text-[13px]">Tap</Muted>
                  <View className="w-[20px] h-[20px] rounded-full bg-card border border-hair items-center justify-center">
                    <IconPlus size={13} color="#1B7A32" />
                  </View>
                  <Muted className="text-[13px]">to add food here.</Muted>
                </View>
              ) : (
                sectionRows.map((r) => {
                  const totals = entryTotals(r.food, r.log.grams);
                  return (
                    <Pressable
                      key={r.log.id}
                      onLongPress={() => confirmDelete(r.log.id, r.food.name)}
                      className="py-[11px] border-t border-[#F0F3EC] flex-row items-center"
                      style={{ gap: 10 }}
                    >
                      <View className="flex-1">
                        <View className="flex-row items-baseline shrink">
                          <Text className="font-body-sb text-ink text-[16px] shrink" numberOfLines={1}>
                            {titleCase(r.food.name)}
                          </Text>
                          <Text className="font-body-sb text-ink3 text-[13px] ml-2">
                            ({fmt(r.log.grams)} g)
                          </Text>
                        </View>
                        <Text className="font-body text-ink3 text-[11px] mt-[1px]" numberOfLines={1}>
                          {titleCase(r.food.brand)}
                        </Text>
                        <View className="flex-row gap-x-3 mt-[6px]">
                          <Text className="font-body-sb text-ink text-[13px]"><Text className="text-protein font-body-b">P</Text> {fmt(totals.proteinG, 1)}g</Text>
                          <Text className="font-body-sb text-ink text-[13px]"><Text className="text-carbs font-body-b">C</Text> {fmt(totals.carbsG, 1)}g</Text>
                          <Text className="font-body-sb text-ink text-[13px]"><Text className="text-fat font-body-b">F</Text> {fmt(totals.fatG, 1)}g</Text>
                          <Text className="font-body-sb text-ink text-[13px]"><Text className="text-fiber font-body-b">Fib</Text> {fmt(totals.fiberG, 1)}g</Text>
                        </View>
                        <View className="flex-row gap-x-3 mt-[4px]">
                          <Text className="font-body-b text-cal text-[13px]">{fmt(totals.calories)} kcal</Text>
                          <Cost cost={totals.cost} currency={currency} className="font-body-sb text-cost text-[13px]" />
                        </View>
                      </View>
                      <Pressable
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
                        className="w-[36px] h-[36px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
                      >
                        <IconPencil size={16} color="#1B7A32" />
                      </Pressable>
                    </Pressable>
                  );
                })
              )}
              </View>
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}
