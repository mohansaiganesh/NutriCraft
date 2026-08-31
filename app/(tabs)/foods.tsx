import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { foodsQuery, settingsQuery } from '@/db/queries';
import { EmptyState, Fab, Field, Muted } from '@/components/ui';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

export default function FoodsScreen() {
  const [q, setQ] = useState('');
  const { data } = useLiveQuery(foodsQuery(q), [q]);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const currency = settingsRows?.[0]?.currency ?? '$';
  const foods = (data ?? []) as FoodItem[];

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <FlatList
        data={foods}
        keyExtractor={(f) => f.id}
        contentContainerClassName="p-4 pb-24"
        ListHeaderComponent={
          <Field
            placeholder="Search foods…"
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            className="mb-3"
          />
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
            className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 mb-2 active:opacity-80"
          >
            <View className="flex-row justify-between items-center mb-1">
              <Text className="font-semibold text-neutral-900 dark:text-neutral-50 flex-1 pr-2" numberOfLines={1}>
                {item.name.replace(/_/g, ' ')}
              </Text>
              <Muted className="text-xs">per 100g</Muted>
            </View>
            {item.brand && item.brand !== 'Generic' ? (
              <Muted className="text-xs mb-1">{item.brand}</Muted>
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
