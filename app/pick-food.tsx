import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { addLog, addMealItem, foodsQuery } from '@/db/queries';
import { nutritionFor } from '@/lib/nutrition';
import { num } from '@/lib/format';
import { mealLabel, type MealType } from '@/constants/meals';
import { Button, Card, cardShadow, Chip, EmptyState, Field, Muted } from '@/components/ui';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

export default function PickFood() {
  const params = useLocalSearchParams<{
    mode: string;
    date?: string;
    mealType?: string;
    mealId?: string;
  }>();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState('100');
  const { data } = useLiveQuery(foodsQuery(q), [q]);
  const foods = (data ?? []) as FoodItem[];

  const confirm = async () => {
    if (!selected) return;
    const g = num(grams);
    if (params.mode === 'log') {
      await addLog(params.date!, (params.mealType as MealType) ?? 'snack', selected.id, g);
    } else if (params.mode === 'mealItem') {
      await addMealItem(params.mealId!, selected.id, g);
    }
    router.back();
  };

  // Step 2: amount entry for the chosen food.
  if (selected) {
    const preview = nutritionFor(selected, num(grams));
    return (
      <View className="flex-1 bg-paper p-4 gap-3">
        <Card>
          <Text className="font-display-sb text-[15px] text-ink" numberOfLines={1}>
            {selected.name.replace(/_/g, ' ')}
          </Text>
          <MacroChips totals={preview} />
        </Card>
        <Field label="Amount (g/ml)" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" autoFocus />
        <View className="flex-row flex-wrap">
          {[25, 50, 100, 150, 200, 250].map((g) => (
            <Chip key={g} label={`${g}g`} active={num(grams) === g} onPress={() => setGrams(String(g))} />
          ))}
        </View>
        {params.mode === 'log' ? (
          <Muted className="text-[13px]">
            Logging to {mealLabel(params.mealType ?? '')} · {params.date}
          </Muted>
        ) : null}
        <Button label="Add" onPress={confirm} className="mt-1" />
        <Button label="Back to list" variant="secondary" onPress={() => setSelected(null)} />
      </View>
    );
  }

  // Step 1: search + pick a food.
  return (
    <View className="flex-1 bg-paper">
      <FlatList
        data={foods}
        keyExtractor={(f) => f.id}
        contentContainerClassName="p-4 pb-8"
        ListHeaderComponent={
          <Field placeholder="Search foods…" value={q} onChangeText={setQ} autoCapitalize="none" className="mb-3" />
        }
        ListEmptyComponent={
          <EmptyState title="No foods found" subtitle="Add foods in the Foods tab first." />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              setSelected(item);
              setGrams(String(item.servingSizeG || 100));
            }}
            className="rounded-2xl bg-card border border-hair p-[14px] mb-2 active:opacity-90"
            style={cardShadow}
          >
            <Text className="font-body-sb text-ink" numberOfLines={1}>
              {item.name.replace(/_/g, ' ')}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
