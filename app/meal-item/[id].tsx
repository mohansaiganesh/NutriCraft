import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { removeMealItem, updateMealItemGrams } from '@/db/queries';
import { num } from '@/lib/format';
import { Button, DetailHeader, Field } from '@/components/ui';

export default function MealItemEditScreen() {
  const p = useLocalSearchParams<{ id: string; grams: string; name: string }>();
  const [grams, setGrams] = useState(p.grams ?? '0');

  const save = async () => {
    await updateMealItemGrams(p.id, num(grams));
    router.back();
  };

  const remove = () => {
    Alert.alert('Remove item', 'Remove this food from the meal?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeMealItem(p.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title={p.name?.replace(/_/g, ' ') ?? 'Item'} />
      <ScrollView className="flex-1" contentContainerClassName="p-4 gap-3">
        <Field label="Amount (g/ml)" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" autoFocus />
        <Button label="Save" onPress={save} className="mt-2" />
        <Button label="Remove item" variant="danger" onPress={remove} />
      </ScrollView>
    </View>
  );
}
