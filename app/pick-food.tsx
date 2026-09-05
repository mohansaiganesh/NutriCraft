import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, SectionList, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { addLog, addMealItem, createFoodFromRemote, getFood } from '@/db/queries';
import { useFoodSearch } from '@/lib/useFoodSearch';
import { setPendingPick } from '@/lib/pendingPick';
import { nutritionFor } from '@/lib/nutrition';
import { num, titleCase } from '@/lib/format';
import { mealLabel, type MealType } from '@/constants/meals';
import { Button, Card, cardShadow, Chip, DetailHeader, EmptyState, Field, Muted } from '@/components/ui';
import { MacroChips } from '@/components/nutrition';
import type { FoodItem } from '@/db/schema';
import { SOURCE_LABEL, type RemoteFood } from '@/lib/foodSearch';

type Row = FoodItem | RemoteFood;

export default function PickFood() {
  const params = useLocalSearchParams<{
    mode: string;
    date?: string;
    mealType?: string;
    mealId?: string;
    mealName?: string;
  }>();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState('100');
  const { localFoods, remoteFoods, remoteStatus, failedSources } = useFoodSearch(q);

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
    } else if (params.mode === 'meal') {
      await addMealItem(params.mealId!, selected.id, g);
    } else if (params.mode === 'mealDraft') {
      setPendingPick({ food: selected, grams: g });
    }
    router.back();
  };

  // Save an Open Food Facts hit as a private food, then continue to the amount step.
  const pickRemote = useCallback(async (r: RemoteFood) => {
    const id = await createFoodFromRemote(r);
    const food = await getFood(id);
    if (!food) return;
    setSelected(food);
    setGrams(String(food.servingSizeG || 100));
  }, []);

  // Pick a local/shared food, then continue to the amount step.
  const pickLocal = useCallback((f: FoodItem) => {
    setSelected(f);
    setGrams(String(f.servingSizeG || 100));
  }, []);

  // The "Open Food Facts" section shows only once the query is long enough to search.
  const showRemote = remoteStatus !== 'idle' && (remoteFoods.length > 0 || remoteStatus !== 'ok');
  const sections = useMemo<{ kind: 'local' | 'remote'; data: Row[] }[]>(() => {
    const s: { kind: 'local' | 'remote'; data: Row[] }[] = [{ kind: 'local', data: localFoods }];
    if (showRemote) s.push({ kind: 'remote', data: remoteFoods });
    return s;
  }, [localFoods, remoteFoods, showRemote]);

  const keyExtractor = useCallback(
    (item: Row, i: number) =>
      'id' in item ? (item as FoodItem).id : `${(item as RemoteFood).remoteId}-${i}`,
    [],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: Row; section: { kind: 'local' | 'remote' } }) =>
      section.kind === 'local' ? (
        <LocalPickRow item={item as FoodItem} onPick={pickLocal} />
      ) : (
        <RemotePickRow item={item as RemoteFood} onPick={pickRemote} />
      ),
    [pickLocal, pickRemote],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { kind: 'local' | 'remote' } }) =>
      section.kind === 'remote' ? (
        <View className="flex-row items-center justify-between pt-1 pb-2">
          <Text className="font-display-sb text-[12px] text-ink3 uppercase tracking-wide">
            Online results
          </Text>
          {remoteStatus === 'loading' ? (
            <Muted className="text-[12px]">Searching…</Muted>
          ) : remoteStatus === 'error' ? (
            <Muted className="text-[12px]">Couldn’t reach — local results only</Muted>
          ) : remoteFoods.length > 0 ? (
            <Text className="font-display-sb text-[12px] text-ink3 flex-1 text-right">
              {remoteFoods.length} items
            </Text>
          ) : null}
        </View>
      ) : null,
    [remoteStatus, remoteFoods.length],
  );

  const renderSectionFooter = useCallback(
    ({ section }: { section: { kind: 'local' | 'remote' } }) =>
      section.kind === 'remote' && failedSources.length > 0 && remoteFoods.length > 0 ? (
        <Muted className="text-[12px] pb-2">{failedSources.join(', ')} unavailable</Muted>
      ) : null,
    [failedSources, remoteFoods.length],
  );

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
          ) : params.mode === 'meal' && params.mealName ? (
            <Muted className="text-[13px]">
              Adding to {params.mealName.replace(/_/g, ' ')}
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
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        contentContainerClassName="px-4 pb-8"
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        updateCellsBatchingPeriod={50}
        ListEmptyComponent={
          <EmptyState title="No foods found" subtitle="Type to search your catalog or Open Food Facts." />
        }
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        renderItem={renderItem}
      />
    </View>
  );
}

const LocalPickRow = React.memo(function LocalPickRow({
  item,
  onPick,
}: {
  item: FoodItem;
  onPick: (f: FoodItem) => void;
}) {
  return (
    <Pressable
      onPress={() => onPick(item)}
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
  );
});

const RemotePickRow = React.memo(function RemotePickRow({
  item,
  onPick,
}: {
  item: RemoteFood;
  onPick: (r: RemoteFood) => void;
}) {
  return (
    <Pressable
      onPress={() => onPick(item)}
      className="rounded-2xl bg-card border border-hair p-[14px] mb-2 active:opacity-90"
      style={cardShadow}
    >
      <View className="flex-row items-baseline gap-1.5">
        <Text className="font-body-sb text-ink shrink" numberOfLines={1}>
          {titleCase(item.name)}
        </Text>
        <Text className="font-body-sb text-[12px] text-ink3" numberOfLines={1}>
          ({titleCase(item.brand || 'Generic')})
        </Text>
        <Text className="font-body-b text-[10px] text-[#2A5A7A] bg-[#E7F1F8] border border-[#C9DEEC] rounded-full px-[6px] py-[1px]">
          {SOURCE_LABEL[item.source]}
        </Text>
      </View>
    </Pressable>
  );
});
