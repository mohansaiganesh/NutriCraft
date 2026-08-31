import { useEffect, useState } from 'react';
import { BackHandler, FlatList, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { addLog, foodsQuery } from '@/db/queries';
import { setPendingPick } from '@/lib/pendingPick';
import { nutritionFor } from '@/lib/nutrition';
import { num, titleCase } from '@/lib/format';
import { mealLabel, type MealType } from '@/constants/meals';
import { Button, Card, cardShadow, Chip, DetailHeader, EmptyState, Field, Muted } from '@/components/ui';
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

  // On Step 2, hardware/gesture back returns to the list instead of popping to Today.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selected) {
        setSelected(null);
        return true; // handled → don't pop the screen
      }
      return false; // Step 1 → allow normal pop to Today
    });
    return () => sub.remove();
  }, [selected]);

  const confirm = async () => {
    if (!selected) return;
    const g = num(grams);
    if (params.mode === 'log') {
      await addLog(params.date!, (params.mealType as MealType) ?? 'snack', selected.id, g);
    } else if (params.mode === 'mealDraft') {
      setPendingPick({ food: selected, grams: g });
    }
    router.back();
  };

  // Step 2: amount entry for the chosen food.
  if (selected) {
    const preview = nutritionFor(selected, num(grams));
    return (
      <View className="flex-1 bg-paper">
        <DetailHeader title="Add food" onBack={() => setSelected(null)} />
        <View className="p-4 gap-3">
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
      </View>
    );
  }

  // Step 1: search + pick a food.
  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Add food" />
      <View className="px-4 pt-1 pb-3">
        <Field placeholder="Search foods…" value={q} onChangeText={setQ} autoCapitalize="none" />
      </View>
      <FlatList
        data={foods}
        keyExtractor={(f) => f.id}
        contentContainerClassName="px-4 pb-8"
        keyboardShouldPersistTaps="handled"
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
            <View className="flex-row items-baseline gap-1.5">
              <Text className="font-body-sb text-ink shrink" numberOfLines={1}>
                {item.name.replace(/_/g, ' ')}
              </Text>
              <Text className="font-body-sb text-[12px] text-ink3" numberOfLines={1}>
                ({titleCase(item.brand || 'Generic')})
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
