import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import {
  addMealItem,
  applyMealToDay,
  createMeal,
  getMeal,
  mealItemsQuery,
  removeMealItem,
  settingsQuery,
  softDeleteMeal,
  updateMeal,
  updateMealItemGrams,
} from '@/db/queries';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { nutritionFor, sumNutrition } from '@/lib/nutrition';
import { fmt, money, num, todayISO } from '@/lib/format';
import { newId } from '@/lib/id';
import { takePendingPick } from '@/lib/pendingPick';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { AddFoodButton, Button, Card, Chip, DetailHeader, EmptyState, Field } from '@/components/ui';
import { IconX } from '@/components/icons';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';

/** A meal line item held in memory; `mealItemId` is set only for rows already in the DB. */
type DraftItem = { key: string; mealItemId?: string; food: FoodItem; grams: number };

/** Order-independent signature of the item set (food + grams), for dirty comparison. */
const itemsSig = (items: { foodId: string; grams: number }[]) =>
  items.map((i) => `${i.foodId}:${i.grams}`).sort().join('|');

function ItemRow({
  row,
  currency,
  onChangeGrams,
  onRemove,
}: {
  row: DraftItem;
  currency: string;
  onChangeGrams: (key: string, grams: number) => void;
  onRemove: (key: string) => void;
}) {
  const [grams, setGrams] = useState(String(row.grams));
  useEffect(() => setGrams(String(row.grams)), [row.grams]);
  return (
    <View className="py-3 border-t border-[#F0F3EC]">
      <View className="flex-row items-center justify-between">
        <Text className="font-body-sb text-ink flex-1 pr-2" numberOfLines={1}>
          {row.food.name.replace(/_/g, ' ')}
        </Text>
        <TextInput
          value={grams}
          onChangeText={setGrams}
          onEndEditing={() => onChangeGrams(row.key, num(grams))}
          keyboardType="decimal-pad"
          className="w-14 text-right rounded-xl border border-[#DCE5D4] bg-card px-2 py-1 font-body-b text-[14px] text-ink"
        />
        <Text className="font-body text-ink3 ml-1">g</Text>
        <Pressable
          onPress={() => onRemove(row.key)}
          className="ml-2 w-7 h-7 rounded-full bg-[#FDECEC] items-center justify-center active:opacity-70"
        >
          <IconX size={13} color="#E03131" />
        </Pressable>
      </View>
      <MacroChips split totals={nutritionFor(row.food, num(grams))} currency={currency} />
    </View>
  );
}

export default function MealBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const navigation = useNavigation();

  const [name, setName] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [original, setOriginal] = useState<{ name: string; items: { foodId: string; grams: number }[] }>({
    name: '',
    items: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<MealType>('breakfast');

  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const currency = settingsRows?.[0]?.currency ?? '$';
  const totals = sumNutrition(items.map((i) => nutritionFor(i.food, i.grams)));

  // One-time load of the persisted meal (existing) or a blank draft (new).
  useEffect(() => {
    takePendingPick(); // drop any stale hand-off from a previous session
    if (isNew) {
      setLoaded(true);
      return;
    }
    (async () => {
      const m = await getMeal(id);
      const rows = (await mealItemsQuery(id)) as { item: { id: string; grams: number }; food: FoodItem }[];
      const draft: DraftItem[] = rows.map((r) => ({
        key: r.item.id,
        mealItemId: r.item.id,
        food: r.food,
        grams: r.item.grams,
      }));
      setName(m?.name ?? '');
      setItems(draft);
      setOriginal({
        name: m?.name ?? '',
        items: draft.map((d) => ({ foodId: d.food.id, grams: d.grams })),
      });
      setLoaded(true);
    })();
  }, [id, isNew]);

  const dirty =
    name.trim() !== original.name.trim() ||
    itemsSig(items.map((i) => ({ foodId: i.food.id, grams: i.grams }))) !== itemsSig(original.items);

  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = dirty;
  }, [dirty]);

  // Drain a food picked on the pick-food screen into draft state.
  useFocusEffect(
    useCallback(() => {
      const picked = takePendingPick();
      if (picked) {
        setItems((prev) => [
          ...prev,
          { key: newId(), food: picked.food, grams: picked.grams },
        ]);
      }
    }, [])
  );

  // Discard-confirm on any back navigation (header button, hardware back, swipe gesture).
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'You have unsaved changes to this meal.', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            isDirtyRef.current = false;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return sub;
  }, [navigation]);

  const changeGrams = (key: string, grams: number) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, grams } : i)));

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const save = async () => {
    if (!name.trim()) return;
    if (isNew) {
      const mealId = await createMeal(name);
      for (const it of items) {
        await addMealItem(mealId, it.food.id, it.grams);
      }
      isDirtyRef.current = false;
      router.replace({ pathname: '/meal/[id]', params: { id: mealId } });
      return;
    }

    // Existing meal: reconcile the draft against the authoritative saved rows.
    const currentMealItemIds = new Set(items.filter((i) => i.mealItemId).map((i) => i.mealItemId));
    const savedRows = (await mealItemsQuery(id)) as { item: { id: string; grams: number } }[];
    // Removed: a saved row that's no longer in the draft.
    for (const r of savedRows) {
      if (!currentMealItemIds.has(r.item.id)) {
        await removeMealItem(r.item.id);
      }
    }

    const reconciled: DraftItem[] = [];
    const savedGrams = new Map(savedRows.map((r) => [r.item.id, r.item.grams] as const));
    for (const it of items) {
      if (!it.mealItemId) {
        const miId = await addMealItem(id, it.food.id, it.grams);
        reconciled.push({ ...it, key: miId, mealItemId: miId });
      } else {
        if (savedGrams.get(it.mealItemId) !== it.grams) {
          await updateMealItemGrams(it.mealItemId, it.grams);
        }
        reconciled.push(it);
      }
    }
    if (name.trim() !== original.name.trim()) {
      await updateMeal(id, { name });
    }

    setItems(reconciled);
    setOriginal({
      name: name.trim(),
      items: reconciled.map((d) => ({ foodId: d.food.id, grams: d.grams })),
    });
    isDirtyRef.current = false;
  };

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
          isDirtyRef.current = false;
          await softDeleteMeal(id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title={isNew ? 'New meal' : 'Edit meal'} />
      {!loaded ? null : (
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-16 gap-[14px]">
        <Field
          label="Meal name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Chicken & rice bowl"
        />

        <Card>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="font-display-sb text-[16px] text-ink">
              {items.length} item{items.length === 1 ? '' : 's'}
            </Text>
            <View className="flex-row items-baseline gap-x-2">
              <Text className="font-display-sb text-[16px] text-brand">{fmt(totals.calories)} kcal</Text>
              <Text className="font-display-sb text-cost text-[16px]">{money(totals.cost, currency)}</Text>
            </View>
          </View>
          <MacroChips macrosOnly emphasizeMacros totals={totals} currency={currency} />
          {items.length === 0 ? (
            <EmptyState title="No items" subtitle="Add foods with the button below." />
          ) : (
            items.map((r) => (
              <ItemRow
                key={r.key}
                row={r}
                currency={currency}
                onChangeGrams={changeGrams}
                onRemove={removeItem}
              />
            ))
          )}
          <AddFoodButton
            onPress={() => router.push({ pathname: '/pick-food', params: { mode: 'mealDraft' } })}
          />
        </Card>

        {isNew || dirty ? (
          <Button
            label={isNew ? 'Save meal' : 'Save changes'}
            onPress={save}
            disabled={!name.trim()}
          />
        ) : null}

        {!isNew && !dirty ? (
          <Card>
            <Text className="font-display-sb text-[16px] text-ink mb-2">Log to today</Text>
            <View className="flex-row flex-wrap mb-1">
              {MEAL_TYPES.map((m) => (
                <Chip key={m.key} label={m.label} active={target === m.key} onPress={() => setTarget(m.key)} />
              ))}
            </View>
            <Button label="Log this meal to today" onPress={logToday} />
          </Card>
        ) : null}

        {!isNew ? <Button label="Delete meal" variant="danger" onPress={remove} /> : null}
      </ScrollView>
      )}
    </View>
  );
}
