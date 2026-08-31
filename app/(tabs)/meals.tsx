import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { createMeal, mealsQuery } from '@/db/queries';
import { AppHeader, cardShadow, EmptyState, Fab } from '@/components/ui';
import { IconChevronRight, IconMeal } from '@/components/icons';
import type { Meal } from '@/db/schema';

export default function MealsScreen() {
  const { data } = useLiveQuery(mealsQuery());
  const meals = (data ?? []) as Meal[];

  const newMeal = async () => {
    const id = await createMeal('New meal');
    router.push({ pathname: '/meal/[id]', params: { id } });
  };

  return (
    <View className="flex-1 bg-paper">
      <FlatList
        data={meals}
        keyExtractor={(m) => m.id}
        contentContainerClassName="px-4 pb-24"
        ListHeaderComponent={
          <AppHeader
            kicker="Templates"
            title="Meals"
            subtitle="Build reusable meals and log them in one tap."
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No meal templates yet"
            subtitle="Tap + to build a reusable meal and log it in one tap."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/meal/[id]', params: { id: item.id } })}
            className="rounded-3xl bg-card border border-hair p-4 mb-3 flex-row items-center justify-between active:opacity-90"
            style={cardShadow}
          >
            <View className="flex-row items-center flex-1" style={{ gap: 12 }}>
              <View className="w-[44px] h-[44px] rounded-2xl bg-[#EAF7EC] items-center justify-center">
                <IconMeal size={22} color="#2F9E44" />
              </View>
              <View className="flex-1 pr-2">
                <Text className="font-display-sb text-[17px] text-ink" numberOfLines={1}>
                  {item.name}
                </Text>
                {item.notes ? (
                  <Text className="font-body text-[12.5px] text-ink3 mt-[2px]" numberOfLines={1}>
                    {item.notes}
                  </Text>
                ) : null}
              </View>
            </View>
            <IconChevronRight size={20} color="#C2CDBF" />
          </Pressable>
        )}
      />
      <Fab onPress={newMeal} />
    </View>
  );
}
