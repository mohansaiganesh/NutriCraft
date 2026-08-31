import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { createMeal, mealsQuery } from '@/db/queries';
import { EmptyState, Fab, Muted } from '@/components/ui';
import type { Meal } from '@/db/schema';

export default function MealsScreen() {
  const { data } = useLiveQuery(mealsQuery());
  const meals = (data ?? []) as Meal[];

  const newMeal = async () => {
    const id = await createMeal('New meal');
    router.push({ pathname: '/meal/[id]', params: { id } });
  };

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <FlatList
        data={meals}
        keyExtractor={(m) => m.id}
        contentContainerClassName="p-4 pb-24"
        ListEmptyComponent={
          <EmptyState
            title="No meal templates yet"
            subtitle="Build reusable meals (like your old meal1…meal5) and log them in one tap."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/meal/[id]', params: { id: item.id } })}
            className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 mb-2 active:opacity-80"
          >
            <Text className="font-semibold text-neutral-900 dark:text-neutral-50">{item.name}</Text>
            {item.notes ? <Muted className="text-sm mt-1">{item.notes}</Muted> : null}
          </Pressable>
        )}
      />
      <Fab onPress={newMeal} />
    </View>
  );
}
