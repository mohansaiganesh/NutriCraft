import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { foodsQuery, settingsQuery } from '@/db/queries';
import { AppHeader, cardShadow, EmptyState, Fab, Field, Muted } from '@/components/ui';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

export default function FoodsScreen() {
  const [q, setQ] = useState('');
  const { data } = useLiveQuery(foodsQuery(q), [q]);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const currency = settingsRows?.[0]?.currency ?? '$';
  const foods = (data ?? []) as FoodItem[];

  return (
    <View className="flex-1 bg-paper">
      <FlatList
        data={foods}
        keyExtractor={(f) => f.id}
        contentContainerClassName="px-4 pb-24"
        ListHeaderComponent={
          <View>
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
        }
        ListEmptyComponent={
          <EmptyState
            title={q ? 'No matches' : 'No foods yet'}
            subtitle={q ? 'Try a different search.' : 'Tap + to add your first food.'}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/food/[id]', params: { id: item.id } })}
            className="rounded-3xl bg-card border border-hair p-4 mb-3 active:opacity-90"
            style={cardShadow}
          >
            <View className="flex-row justify-between items-center">
              <Text className="font-display-sb text-[16px] text-ink flex-1 pr-2" numberOfLines={1}>
                {item.name.replace(/_/g, ' ')}
              </Text>
              <Text className="font-body-b text-[11px] text-ink3 bg-[#F1F5EE] border border-[#E6ECDF] px-[9px] py-[3px] rounded-full">
                per 100g
              </Text>
            </View>
            {item.brand && item.brand !== 'Generic' ? (
              <Muted className="text-[12px] mt-[2px]">{item.brand}</Muted>
            ) : null}
            <MacroChips
              totals={{
                calories: item.calories,
                proteinG: item.proteinG,
                carbsG: item.carbsG,
                fatG: item.fatG,
                fiberG: item.fiberG,
                sodiumMg: item.sodiumMg,
                cost: item.pricePer100,
              }}
              currency={currency}
            />
          </Pressable>
        )}
      />
      <Fab onPress={() => router.push({ pathname: '/food/[id]', params: { id: 'new' } })} />
    </View>
  );
}
