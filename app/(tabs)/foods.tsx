import { useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { createFoodFromRemote, settingsQuery } from '@/db/queries';
import { useFoodSearch } from '@/lib/useFoodSearch';
import { AppHeader, cardShadow, EmptyState, Fab, Field, Muted } from '@/components/ui';
import { IconPencil, IconPlus } from '@/components/icons';
import { MacroChips } from '@/components/nutrition';
import { nutritionFor } from '@/lib/nutrition';
import { fmt, money, titleCase } from '@/lib/format';
import type { FoodItem } from '@/db/schema';
import { SOURCE_LABEL, type RemoteFood } from '@/lib/foodSearch';

type Row = FoodItem | RemoteFood;

export default function FoodsScreen() {
  const [q, setQ] = useState('');
  const { localFoods, remoteFoods, remoteStatus, failedSources } = useFoodSearch(q);
  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const currency = settingsRows?.[0]?.currency ?? '$';

  // Save an Open Food Facts hit as a private food, then open it to add price / adjust.
  const addRemote = async (r: RemoteFood) => {
    const id = await createFoodFromRemote(r);
    router.push({ pathname: '/food/[id]', params: { id } });
  };

  // The "Open Food Facts" section shows only once the query is long enough to search.
  const showRemote = remoteStatus !== 'idle' && (remoteFoods.length > 0 || remoteStatus !== 'ok');
  const sections: { kind: 'local' | 'remote'; data: Row[] }[] = [
    { kind: 'local', data: localFoods },
  ];
  if (showRemote) sections.push({ kind: 'remote', data: remoteFoods });

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
        keyExtractor={(item, i) =>
          'id' in item ? (item as FoodItem).id : `${(item as RemoteFood).remoteId}-${i}`
        }
        contentContainerClassName="px-4 pb-24"
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <EmptyState
            title={q ? 'No matches' : 'No foods yet'}
            subtitle={q ? 'Try a different search.' : 'Tap + to add your first food.'}
          />
        }
        renderSectionHeader={({ section }) =>
          section.kind === 'remote' ? (
            <View className="flex-row items-center justify-between pt-2 pb-2">
              <Text className="font-display-sb text-[13px] text-ink3 uppercase tracking-wide">
                Online results
                {remoteFoods.length > 0 ? (
                  <Text className="text-ink3"> · {remoteFoods.length}</Text>
                ) : null}
              </Text>
              {remoteStatus === 'loading' ? (
                <Muted className="text-[12px]">Searching…</Muted>
              ) : remoteStatus === 'error' ? (
                <Muted className="text-[12px]">Couldn’t reach — local results only</Muted>
              ) : null}
            </View>
          ) : null
        }
        renderSectionFooter={({ section }) =>
          section.kind === 'remote' && failedSources.length > 0 && remoteFoods.length > 0 ? (
            <Muted className="text-[12px] pb-2">{failedSources.join(', ')} unavailable</Muted>
          ) : null
        }
        renderItem={({ item, section }) =>
          section.kind === 'local'
            ? renderLocal(item as FoodItem, currency)
            : renderRemote(item as RemoteFood, addRemote)
        }
      />
      <Fab onPress={() => router.push({ pathname: '/food/[id]', params: { id: 'new' } })} />
    </View>
  );
}

function renderLocal(item: FoodItem, currency: string) {
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
        <Text className="font-body-sb text-cost text-[12px]">{money(per.cost, currency)}</Text>
      </View>
      <MacroChips macrosOnly totals={per} currency={currency} />
    </View>
  );
}

function renderRemote(item: RemoteFood, onAdd: (r: RemoteFood) => void) {
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
          <Text className="font-body-sb text-[12px] text-ink3">({fmt(item.servingSizeG)}g)</Text>
          <Text className="font-body-b text-[10px] text-[#2A5A7A] bg-[#E7F1F8] border border-[#C9DEEC] rounded-full px-[7px] py-[1px]">
            {SOURCE_LABEL[item.source]}
          </Text>
        </View>
        <View className="flex-row items-center gap-[5px] rounded-full bg-[#EEF6EC] border border-[#DCEAD4] px-[10px] py-[5px]">
          <IconPlus size={13} color="#1B7A32" />
          <Text className="text-[#1B7A32] font-body-b text-[12px]">Add</Text>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 mt-[2px]">
        <Muted className="text-[12px]">{titleCase(item.brand || 'Generic')}</Muted>
        <Text className="font-body-b text-cal text-[12px]">{fmt(item.basis.calories)} kcal/100g</Text>
      </View>
    </Pressable>
  );
}
