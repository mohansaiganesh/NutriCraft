import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery } from '@/db/queries';
import { useFoodSearch } from '@/lib/useFoodSearch';
import { AppHeader, cardShadow, EmptyState, Fab, Field, Muted } from '@/components/ui';
import { IconChevronRight, IconPencil } from '@/components/icons';
import { Cost, MacroChips } from '@/components/nutrition';
import { nutritionFor } from '@/lib/nutrition';
import { fmt, titleCase } from '@/lib/format';
import type { FoodItem } from '@/db/schema';
import { SOURCE_LABEL, type RemoteFood } from '@/lib/foodSearch';

type Row = FoodItem | RemoteFood;

export default function FoodsScreen() {
  const [q, setQ] = useState('');
  const { localFoods, remoteFoods, remoteStatus, failedSources } = useFoodSearch(q);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const currency = settingsRows?.[0]?.currency ?? '$';

  // Open a found food in the form, PREFILLED but not yet saved — it only lands in the
  // catalog when the user taps the save button inside.
  const openRemote = useCallback((r: RemoteFood) => {
    router.push({ pathname: '/food/[id]', params: { id: 'new', prefill: JSON.stringify(r) } });
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
        <LocalFoodRow item={item as FoodItem} currency={currency} />
      ) : (
        <RemoteFoodRow item={item as RemoteFood} currency={currency} onAdd={openRemote} />
      ),
    [currency, openRemote],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { kind: 'local' | 'remote' } }) =>
      section.kind === 'remote' ? (
        <View className="flex-row items-center justify-between pt-2 pb-2">
          <Text className="font-display-sb text-[13px] text-ink3 uppercase tracking-wide">
            Online results
          </Text>
          {remoteStatus === 'loading' ? (
            <Muted className="text-[12px]">Searching…</Muted>
          ) : remoteStatus === 'error' ? (
            <Muted className="text-[12px]">Couldn’t reach — local results only</Muted>
          ) : remoteFoods.length > 0 ? (
            <Muted className="text-[12px]">{remoteFoods.length} items</Muted>
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

  const listEmpty = useMemo(
    () => (
      <EmptyState
        title={q ? 'No matches' : 'No foods yet'}
        subtitle={q ? 'Try a different search.' : 'Tap + to add your first food.'}
      />
    ),
    [q],
  );

  return (
    <View className="flex-1 bg-paper">
      <View className="px-4 pt-2">
        <AppHeader
          kicker="Catalog"
          title="Foods"
          right={<Text className="font-body-b text-[13px] text-ink3 pb-1">{localFoods.length} items</Text>}
        />
        <Field
          placeholder="Search foods…"
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          className="mb-3"
        />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        contentContainerClassName="px-4 pb-24"
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        updateCellsBatchingPeriod={50}
        ListEmptyComponent={listEmpty}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        renderItem={renderItem}
      />
      <Fab onPress={() => router.push({ pathname: '/food/[id]', params: { id: 'new' } })} />
    </View>
  );
}

const LocalFoodRow = React.memo(function LocalFoodRow({
  item,
  currency,
}: {
  item: FoodItem;
  currency: string;
}) {
  const isShared = item.userId == null;
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
    <View className="rounded-3xl bg-card border border-hair p-4 mb-3" style={cardShadow}>
      <View className="flex-row justify-between items-center">
        <View className="flex-1 pr-2 flex-row items-baseline gap-2">
          <Text className="font-display-sb text-[16px] text-ink shrink" numberOfLines={1}>
            {titleCase(item.name)}
          </Text>
          <Text className="font-body-sb text-[12px] text-ink3">({fmt(item.servingSizeG)}g)</Text>
          {isShared ? (
            <Text className="font-body-b text-[10px] text-[#7A5A1E] bg-[#FBF3E4] border border-[#EAD9B8] rounded-full px-[7px] py-[1px]">
              SHARED
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push({ pathname: '/food/[id]', params: { id: item.id } })}
          hitSlop={8}
          className="flex-row items-center gap-[5px] rounded-full bg-[#EEF6EC] border border-[#DCEAD4] px-[10px] py-[5px] active:opacity-80"
        >
          <IconPencil size={13} color="#1B7A32" />
          <Text className="text-[#1B7A32] font-body-b text-[12px]">{isShared ? 'View' : 'Edit'}</Text>
        </Pressable>
      </View>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 mt-[2px]">
        <Muted className="text-[12px]">{titleCase(item.brand || 'Generic')}</Muted>
        <Text className="font-body-b text-cal text-[12px]">{fmt(per.calories)} kcal</Text>
        <Cost cost={per.cost} currency={currency} className="font-body-sb text-cost text-[12px]" />
      </View>
      <MacroChips macrosOnly totals={per} currency={currency} />
    </View>
  );
});

const RemoteFoodRow = React.memo(function RemoteFoodRow({
  item,
  currency,
  onAdd,
}: {
  item: RemoteFood;
  currency: string;
  onAdd: (r: RemoteFood) => void;
}) {
  // Online results are normalized to per-100 g/ml so figures are comparable across sources,
  // regardless of each provider's serving convention (item.basis is already per-100).
  const per = nutritionFor(item.basis, 100);
  return (
    <Pressable
      onPress={() => onAdd(item)}
      className="rounded-3xl bg-card border border-hair p-4 mb-3 active:opacity-90"
      style={cardShadow}
    >
      <View className="flex-row justify-between items-center">
        <View className="flex-1 pr-2 flex-row items-baseline gap-2">
          <Text className="font-display-sb text-[16px] text-ink shrink" numberOfLines={1}>
            {titleCase(item.name)}
          </Text>
          <Text className="font-body-sb text-[12px] text-ink3">(100g)</Text>
          <Text className="font-body-b text-[10px] text-[#2A5A7A] bg-[#E7F1F8] border border-[#C9DEEC] rounded-full px-[7px] py-[1px]">
            {SOURCE_LABEL[item.source]}
          </Text>
        </View>
        <IconChevronRight size={18} color="#9AA79B" />
      </View>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 mt-[2px]">
        <Muted className="text-[12px]">{titleCase(item.brand || 'Generic')}</Muted>
        <Text className="font-body-b text-cal text-[12px]">{fmt(per.calories)} kcal</Text>
        <Cost cost={per.cost} currency={currency} className="font-body-sb text-ink3 text-[12px]" />
      </View>
      <MacroChips macrosOnly totals={per} currency={currency} />
    </Pressable>
  );
});
