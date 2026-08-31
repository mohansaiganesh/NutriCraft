import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { removeLog, updateLog } from '@/db/queries';
import { num } from '@/lib/format';
import { MEAL_TYPES, type MealType } from '@/constants/meals';
import { Button, Chip, Field } from '@/components/ui';

export default function LogEditScreen() {
  const p = useLocalSearchParams<{ id: string; grams: string; mealType: string; name: string }>();
  const navigation = useNavigation();
  const [grams, setGrams] = useState(p.grams ?? '0');
  const [mealType, setMealType] = useState<MealType>((p.mealType as MealType) ?? 'snack');

  useEffect(() => {
    navigation.setOptions({ title: p.name?.replace(/_/g, ' ') ?? 'Entry' });
  }, [navigation, p.name]);

  const save = async () => {
    await updateLog(p.id, { grams: num(grams), mealType });
    router.back();
  };

  const remove = () => {
    Alert.alert('Remove entry', 'Remove this entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeLog(p.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-neutral-50 dark:bg-black" contentContainerClassName="p-4 gap-3">
      <Field label="Amount (g/ml)" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" autoFocus />
      <View>
        <Text className="text-sm font-medium text-neutral-600 dark:text-neutral-300 mb-1">Meal</Text>
        <View className="flex-row flex-wrap">
          {MEAL_TYPES.map((m) => (
            <Chip key={m.key} label={m.label} active={mealType === m.key} onPress={() => setMealType(m.key)} />
          ))}
        </View>
      </View>
      <Button label="Save" onPress={save} className="mt-2" />
      <Button label="Remove entry" variant="danger" onPress={remove} />
    </ScrollView>
  );
}
