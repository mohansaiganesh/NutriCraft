import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import {
  applyMealToDay,
  getMeal,
  mealItemsQuery,
  removeMealItem,
  settingsQuery,
  softDeleteMeal,
  updateMeal,
  updateMealItemGrams,
} from '@/db/queries';
import { nutritionFor, sumNutrition } from '@/lib/nutrition';
import { num, todayISO } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { Button, Card, Chip, EmptyState, Field, Muted } from '@/components/ui';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem, MealItem } from '@/db/schema';

type Row = { item: MealItem; food: FoodItem };

function ItemRow({ row, currency }: { row: Row; currency: string }) {
  const [grams, setGrams] = useState(String(row.item.grams));
  useEffect(() => setGrams(String(row.item.grams)), [row.item.grams]);
  return (
    <View className="py-2 border-t border-neutral-100 dark:border-neutral-800">
      <View className="flex-row items-center justify-between">
        <Text className="text-neutral-800 dark:text-neutral-100 flex-1 pr-2" numberOfLines={1}>
          {row.food.name.replace(/_/g, ' ')}
        </Text>
        <TextInput
          value={grams}
          onChangeText={setGrams}
          onEndEditing={() => updateMealItemGrams(row.item.id, num(grams))}
          keyboardType="decimal-pad"
          className="w-16 text-right rounded-lg border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-neutral-900 dark:text-neutral-50"
        />
        <Text className="text-neutral-500 ml-1">g</Text>
        <Pressable onPress={() => removeMealItem(row.item.id)} className="ml-2 px-2">
          <Text className="text-red-500 text-lg">✕</Text>
        </Pressable>
      </View>
      <MacroChips totals={nutritionFor(row.food, num(grams))} currency={currency} />
    </View>
  );
}

export default function MealBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [target, setTarget] = useState<MealType>('breakfast');

  const { data: itemRows } = useLiveQuery(mealItemsQuery(id), [id]);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const rows = (itemRows ?? []) as Row[];
  const currency = settingsRows?.[0]?.currency ?? '$';
  const totals = sumNutrition(rows.map((r) => nutritionFor(r.food, r.item.grams)));

  useEffect(() => {
    navigation.setOptions({ title: 'Meal' });
    (async () => {
      const m = await getMeal(id);
      if (m) setName(m.name);
    })();
  }, [id]);

  const logToday = async () => {
    const count = await applyMealToDay(id, todayISO(), target);
    Alert.alert('Logged', `Added ${count} item${count === 1 ? '' : 's'} to today's ${target}.`);
  };

  const remove = () => {
    Alert.alert('Delete meal', `Delete “${name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await softDeleteMeal(id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-neutral-50 dark:bg-black" contentContainerClassName="p-4 pb-16 gap-3">
      <Field
        label="Meal name"
        value={name}
        onChangeText={setName}
        onEndEditing={() => updateMeal(id, { name })}
      />

      <Card>
        <View className="flex-row items-center justify-between mb-1">
          <Text className="font-bold text-neutral-900 dark:text-neutral-50">Items</Text>
        </View>
        {rows.length === 0 ? (
          <EmptyState title="No items" subtitle="Add foods with the button below." />
        ) : (
          rows.map((r) => <ItemRow key={r.item.id} row={r} currency={currency} />)
        )}
        <Pressable
          onPress={() =>
            router.push({ pathname: '/pick-food', params: { mode: 'mealItem', mealId: id } })
          }
          className="mt-2 py-2 items-center rounded-xl bg-sky-50 dark:bg-sky-950"
        >
          <Text className="text-sky-600 font-semibold">+ Add food</Text>
        </Pressable>
      </Card>

      <Card>
        <Text className="font-bold text-neutral-900 dark:text-neutral-50 mb-1">Meal totals</Text>
        <MacroChips totals={totals} currency={currency} />
      </Card>

      <Card>
        <Text className="font-bold text-neutral-900 dark:text-neutral-50 mb-2">Log to today</Text>
        <View className="flex-row flex-wrap mb-2">
          {MEAL_TYPES.map((m) => (
            <Chip key={m.key} label={m.label} active={target === m.key} onPress={() => setTarget(m.key)} />
          ))}
        </View>
        <Button label="Log this meal to today" onPress={logToday} />
      </Card>

      <Button label="Delete meal" variant="danger" onPress={remove} />
    </ScrollView>
  );
}
