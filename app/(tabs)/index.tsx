import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { dayLogsQuery, removeLog, settingsQuery, updateLog } from '@/db/queries';
import { nutritionFor, sumNutrition, type NutritionTotals } from '@/lib/nutrition';
import { dateLabel, fmt, titleCase, todayISO } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { AccountButton, Card, Muted } from '@/components/ui';
import { GramStepper } from '@/components/GramStepper';
import { CalendarField } from '@/components/CalendarField';
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash, MealIcon } from '@/components/icons';
import { Cost, TargetProgress } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

type Row = { log: { id: string; grams: number; mealType: string }; food: FoodItem };

function entryTotals(food: FoodItem, grams: number): NutritionTotals {
  return nutritionFor(food, grams);
}

/**
 * Uniformly downscales its child to fit the height its parent gives it (never upscales).
 * Measures the available box + the child's natural size, then applies a `scale` transform
 * anchored top-left; the inner width is grown to `box.w / scale` so the content re-fills the
 * full width after the transform instead of shrinking toward the center.
 */
function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [content, setContent] = useState({ w: 0, h: 0 });
  const scale = content.h > 0 && box.h > 0 ? Math.min(1, box.h / content.h) : 1;
  return (
    <View
      className="flex-1"
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <View
        onLayout={(e) => setContent({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{
          transform: [{ scale }],
          transformOrigin: 'top left',
          width: scale < 1 && box.w > 0 ? box.w / scale : undefined,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const headerH = screenH * 0.38;
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
    <View className="flex-1 bg-paper">
      {/* Fixed header: date navigator + calorie-ring hero, sized to 30% of screen height */}
      <View className="px-4" style={{ paddingTop: insets.top }}>
        <View style={{ height: headerH }}>
          {/* Date navigator */}
          <View className="flex-row items-center justify-between mt-2 mb-4">
            <CalendarField value={date} onChange={setDate} className="py-[5px]" textClassName="font-body-b text-[14px]" />
            <AccountButton />
          </View>

          {/* Calorie-ring hero — fills remaining space, content scaled to fit */}
          {settings ? (
            <Card className="flex-1 px-[14px] py-[10px] overflow-hidden" style={{ minHeight: 0 }}>
              <ScaleToFit>
                <TargetProgress
                  totals={dayTotals}
                  settings={settings}
                  itemCount={allRows.length}
                  unpricedCount={dayUnpricedCount}
                />
              </ScaleToFit>
            </Card>
          ) : null}
        </View>
      </View>

      {/* Scrolling meal sections */}
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-24">
      {MEAL_TYPES.map(({ key, label, icon, tint, tintBg }) => {
        const sectionRows = allRows.filter((r) => r.log.mealType === key);
        const sectionTotals = sumNutrition(
          sectionRows.map((r) => entryTotals(r.food, r.log.grams))
        );
        const unpricedCount = sectionRows.filter((r) => !(r.food.pricePer100 > 0)).length;
        const isOpen = !!open[key];
        return (
          <Card key={key} className="mb-4 p-0 overflow-hidden" style={{ backgroundColor: '#5A7D21' }}>
            <View>
              <View
                className="flex-row items-center justify-between relative px-4 pt-[1px] pb-[3px]"
                style={{ gap: 4 }}
              >
                <Pressable
                  onPress={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                  className="flex-row items-center flex-1 active:opacity-70"
                  style={{ gap: 8 }}
                >
                  <View
                    className="w-[34px] h-[34px] rounded-xl items-center justify-center"
                    style={{
                      backgroundColor: tintBg,
                      marginLeft: -16,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.18)',
                    }}
                  >
                    <MealIcon name={icon} size={19} color={tint} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <Text className="font-display-sb text-[15px] text-white">{label}</Text>
                      {isOpen ? (
                        <IconChevronDown size={16} color="#E4EDD5" />
                      ) : (
                        <IconChevronRight size={16} color="#E4EDD5" />
                      )}
                      {unpricedCount > 0 ? (
                        <Text
                          className="font-body-sb text-[11px] text-[#FFC9C9]"
                          numberOfLines={1}
                          style={{ flexShrink: 1 }}
                        >
                          {unpricedCount} {unpricedCount === 1 ? 'item' : 'items'} prices N/A
                        </Text>
                      ) : null}
                    </View>
                    <Text className="font-body-b text-[12px] text-white mt-[1px]">
                      {sectionRows.length} {sectionRows.length === 1 ? 'item' : 'items'} · <Text className="text-[#D8F5B0]">{fmt(sectionTotals.calories)} kcal</Text> · <Cost cost={sectionTotals.cost} currency={currency} count={sectionRows.length} naColor="#FFC9C9" />
                    </Text>
                    {sectionRows.length > 0 ? (
                      <View className="flex-row gap-x-1.5 mt-[3px]">
                        <Text className="font-body-sb text-[#F2F7E9] text-[11px]"><Text className="font-body-b" style={{ color: '#FFC078' }}>P</Text> {fmt(sectionTotals.proteinG, 1)}g</Text>
                        <Text className="font-body-sb text-[#F2F7E9] text-[11px]"><Text className="font-body-b" style={{ color: '#FFE066' }}>C</Text> {fmt(sectionTotals.carbsG, 1)}g</Text>
                        <Text className="font-body-sb text-[#F2F7E9] text-[11px]"><Text className="font-body-b" style={{ color: '#D0BFFF' }}>F</Text> {fmt(sectionTotals.fatG, 1)}g</Text>
                        <Text className="font-body-sb text-[#F2F7E9] text-[11px]"><Text className="font-body-b" style={{ color: '#96F2D7' }}>Fib</Text> {fmt(sectionTotals.fiberG, 1)}g</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/pick-food',
                      params: { mode: 'log', date, mealType: key as MealType },
                    })
                  }
                  className="w-[42px] h-[42px] rounded-full bg-white items-center justify-center active:opacity-80"
                  style={{ marginTop: 10, marginRight: -16 }}
                >
                  <IconPlus size={16} color="#5A7D21" />
                </Pressable>
              </View>
            </View>

            {isOpen ? (
              <View className={`bg-card px-[18px] ${sectionRows.length === 0 ? 'py-[6px]' : 'pt-[2px] pb-[10px]'}`}>
              {sectionRows.length === 0 ? (
                <View className="flex-row items-center flex-wrap" style={{ gap: 4 }}>
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
                    <View
                      key={r.log.id}
                      className="py-[7px] border-t border-[#F0F3EC] flex-row items-center"
                      style={{ gap: 10 }}
                    >
                      <View className="flex-1">
                        <View className="flex-row items-center" style={{ gap: 8 }}>
                          <Text className="font-body-sb text-ink text-[14px] flex-1" numberOfLines={1}>
                            {titleCase(r.food.name)}
                          </Text>
                          <GramStepper
                            grams={r.log.grams}
                            onChange={(g) => updateLog(r.log.id, { grams: g })}
                          />
                        </View>
                        <Text className="font-body text-ink3 text-[11px] mt-[1px]" numberOfLines={1}>
                          {titleCase(r.food.brand)}
                        </Text>
                        <View className="flex-row items-center justify-between mt-[4px]">
                          <View className="flex-1">
                            <View className="flex-row gap-x-3">
                              <Text className="font-body-b text-cal text-[11px]">{fmt(totals.calories)} kcal</Text>
                              <Cost cost={totals.cost} currency={currency} className="font-body-sb text-cost text-[11px]" />
                            </View>
                            <View className="flex-row gap-x-3 mt-[3px]">
                              <Text className="font-body-sb text-ink text-[11px]"><Text className="text-protein font-body-b">P</Text> {fmt(totals.proteinG, 1)}g</Text>
                              <Text className="font-body-sb text-ink text-[11px]"><Text className="text-carbs font-body-b">C</Text> {fmt(totals.carbsG, 1)}g</Text>
                              <Text className="font-body-sb text-ink text-[11px]"><Text className="text-fat font-body-b">F</Text> {fmt(totals.fatG, 1)}g</Text>
                              <Text className="font-body-sb text-ink text-[11px]"><Text className="text-fiber font-body-b">Fib</Text> {fmt(totals.fiberG, 1)}g</Text>
                            </View>
                          </View>
                          <Pressable
                            onPress={() => confirmDelete(r.log.id, r.food.name)}
                            className="w-[30px] h-[30px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80 -mr-[13px]"
                          >
                            <IconTrash size={16} color="#E03131" />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
              </View>
            ) : null}
          </Card>
        );
      })}
      </ScrollView>
    </View>
  );
}
