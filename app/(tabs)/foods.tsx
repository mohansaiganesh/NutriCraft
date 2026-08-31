import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { foodsQuery, settingsQuery } from '@/db/queries';
import { AppHeader, cardShadow, EmptyState, Fab, Field, Muted } from '@/components/ui';
import { IconPencil } from '@/components/icons';
import { MacroChips } from '@/components/nutrition';
import { nutritionFor } from '@/lib/nutrition';
import { fmt, money, titleCase } from '@/lib/format';
import type { FoodItem } from '@/db/schema';

export default function FoodsScreen() {
  const [q, setQ] = useState('');
  const { data } = useLiveQuery(foodsQuery(q), [q]);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const currency = settingsRows?.[0]?.currency ?? '$';
  const foods = (data ?? []) as FoodItem[];

  return (
    <View className="flex-1 bg-paper">
      <View className="px-4 pt-2">
        <AppHeader
          kicker="Catalog"
          title="Foods"
          right={<Text className="font-body-b text-[13px] text-ink3 pb-1">{foods.length} items</Text>}
        />
        <Field
          placeholder="Search foods…"
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          className="mb-3"
        />
      </View>
      <FlatList
        data={foods}
        keyExtractor={(f) => f.id}
        contentContainerClassName="px-4 pb-24"
        ListEmptyComponent={
          <EmptyState
            title={q ? 'No matches' : 'No foods yet'}
            subtitle={q ? 'Try a different search.' : 'Tap + to add your first food.'}
          />
        }
        renderItem={({ item }) => {
          const per = nutritionFor(
            {
              calories: item.calories,
              proteinG: item.proteinG,
              carbsG: item.carbsG,
              fatG: item.fatG,
              fiberG: item.fiberG,
              sodiumMg: item.sodiumMg,
              pricePer100: item.pricePer100,
            },
            item.servingSizeG,
          );
          return (
            <View
              className="rounded-3xl bg-card border border-hair p-4 mb-3"
              style={cardShadow}
            >
              <View className="flex-row justify-between items-center">
                <View className="flex-1 pr-2 flex-row items-baseline gap-2">
                  <Text className="font-display-sb text-[16px] text-ink shrink" numberOfLines={1}>
                    {titleCase(item.name)}
                  </Text>
                  <Text className="font-body-sb text-[12px] text-ink3">({fmt(item.servingSizeG)}g)</Text>
                </View>
                <Pressable
                  onPress={() => router.push({ pathname: '/food/[id]', params: { id: item.id } })}
                  hitSlop={8}
                  className="flex-row items-center gap-[5px] rounded-full bg-[#EEF6EC] border border-[#DCEAD4] px-[10px] py-[5px] active:opacity-80"
                >
                  <IconPencil size={13} color="#1B7A32" />
                  <Text className="text-[#1B7A32] font-body-b text-[12px]">Edit</Text>
                </Pressable>
              </View>
              <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 mt-[2px]">
                <Muted className="text-[12px]">{titleCase(item.brand || 'Generic')}</Muted>
                <Text className="font-body-b text-cal text-[12px]">{fmt(per.calories)} kcal</Text>
                <Text className="font-body-sb text-cost text-[12px]">{money(per.cost, currency)}</Text>
              </View>
              <MacroChips macrosOnly totals={per} currency={currency} />
            </View>
          );
        }}
      />
      <Fab onPress={() => router.push({ pathname: '/food/[id]', params: { id: 'new' } })} />
    </View>
  );
}
