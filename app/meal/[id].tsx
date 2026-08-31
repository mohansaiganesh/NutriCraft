import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
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
import { fmt, num, todayISO } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { AddFoodButton, Button, Card, Chip, DetailHeader, EmptyState, Field } from '@/components/ui';
import { IconX } from '@/components/icons';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem, MealItem } from '@/db/schema';

type Row = { item: MealItem; food: FoodItem };

function ItemRow({ row, currency }: { row: Row; currency: string }) {
  const [grams, setGrams] = useState(String(row.item.grams));
  useEffect(() => setGrams(String(row.item.grams)), [row.item.grams]);
  return (
    <View className="py-3 border-t border-[#F0F3EC]">
      <View className="flex-row items-center justify-between">
        <Text className="font-body-sb text-ink flex-1 pr-2" numberOfLines={1}>
          {row.food.name.replace(/_/g, ' ')}
        </Text>
        <TextInput
          value={grams}
          onChangeText={setGrams}
          onEndEditing={() => updateMealItemGrams(row.item.id, num(grams))}
          keyboardType="decimal-pad"
          className="w-14 text-right rounded-xl border border-[#DCE5D4] bg-card px-2 py-1 font-body-b text-[14px] text-ink"
        />
        <Text className="font-body text-ink3 ml-1">g</Text>
        <Pressable
          onPress={() => removeMealItem(row.item.id)}
          className="ml-2 w-7 h-7 rounded-full bg-[#FDECEC] items-center justify-center active:opacity-70"
        >
          <IconX size={13} color="#E03131" />
        </Pressable>
      </View>
      <MacroChips totals={nutritionFor(row.food, num(grams))} currency={currency} />
    </View>
  );
}

export default function MealBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [target, setTarget] = useState<MealType>('breakfast');

  const { data: itemRows } = useLiveQuery(mealItemsQuery(id), [id]);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const rows = (itemRows ?? []) as Row[];
  const currency = settingsRows?.[0]?.currency ?? '$';
  const totals = sumNutrition(rows.map((r) => nutritionFor(r.food, r.item.grams)));

  useEffect(() => {
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
    <View className="flex-1 bg-paper">
      <DetailHeader title="Meal" />
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-16 gap-[14px]">
      <Field
        label="Meal name"
        value={name}
        onChangeText={setName}
        onEndEditing={() => updateMeal(id, { name })}
      />

      <Card>
        <Text className="font-display-sb text-[16px] text-ink mb-1">Items</Text>
        {rows.length === 0 ? (
          <EmptyState title="No items" subtitle="Add foods with the button below." />
        ) : (
          rows.map((r) => <ItemRow key={r.item.id} row={r} currency={currency} />)
        )}
        <AddFoodButton
          onPress={() =>
            router.push({ pathname: '/pick-food', params: { mode: 'mealItem', mealId: id } })
          }
        />
      </Card>

      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="font-display-sb text-[16px] text-ink">Meal totals</Text>
          <Text className="font-display-sb text-[20px] text-brand">{fmt(totals.calories)} kcal</Text>
        </View>
        <MacroChips totals={totals} currency={currency} />
      </Card>

      <Card>
        <Text className="font-display-sb text-[16px] text-ink mb-2">Log to today</Text>
        <View className="flex-row flex-wrap mb-1">
          {MEAL_TYPES.map((m) => (
            <Chip key={m.key} label={m.label} active={target === m.key} onPress={() => setTarget(m.key)} />
          ))}
        </View>
        <Button label="Log this meal to today" onPress={logToday} />
      </Card>

      <Button label="Delete meal" variant="danger" onPress={remove} />
      </ScrollView>
    </View>
  );
}
