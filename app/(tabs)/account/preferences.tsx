import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { num } from '@/lib/format';
import { Button, Card, DetailHeader, Field, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

export default function PreferencesScreen() {
  const { data } = useLiveQuery(settingsQuery());
  const settings = data?.[0];

  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [sodium, setSodium] = useState('');
  const [currency, setCurrency] = useState('$');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState({
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    sodium: '',
    currency: '$',
  });

  useEffect(() => {
    if (settings && !loaded) {
      const snapshot = {
        calories: String(settings.targetCalories),
        protein: String(settings.targetProteinG),
        carbs: String(settings.targetCarbsG),
        fat: String(settings.targetFatG),
        fiber: String(settings.targetFiberG),
        sodium: String(settings.targetSodiumMg),
        currency: settings.currency,
      };
      setCalories(snapshot.calories);
      setProtein(snapshot.protein);
      setCarbs(snapshot.carbs);
      setFat(snapshot.fat);
      setFiber(snapshot.fiber);
      setSodium(snapshot.sodium);
      setCurrency(snapshot.currency);
      setBaseline(snapshot);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const dirty =
    editing &&
    (calories !== baseline.calories ||
      protein !== baseline.protein ||
      carbs !== baseline.carbs ||
      fat !== baseline.fat ||
      fiber !== baseline.fiber ||
      sodium !== baseline.sodium ||
      currency !== baseline.currency);

  const saveTargets = async () => {
    const nextCurrency = currency.trim() || '$';
    await updateSettings({
      targetCalories: num(calories),
      targetProteinG: num(protein),
      targetCarbsG: num(carbs),
      targetFatG: num(fat),
      targetFiberG: num(fiber),
      targetSodiumMg: num(sodium),
      currency: nextCurrency,
    });
    setCurrency(nextCurrency);
    setBaseline({ calories, protein, carbs, fat, fiber, sodium, currency: nextCurrency });
    setEditing(false);
    Alert.alert('Saved', 'Your daily targets were updated.');
  };

  const cancelEdit = () => {
    setCalories(baseline.calories);
    setProtein(baseline.protein);
    setCarbs(baseline.carbs);
    setFat(baseline.fat);
    setFiber(baseline.fiber);
    setSodium(baseline.sodium);
    setCurrency(baseline.currency);
    setEditing(false);
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Preferences" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <Card className="gap-3">
          <CardTitle>Daily targets</CardTitle>
          <View className="flex-row gap-3">
            <Field label="Calories" value={calories} onChangeText={setCalories} editable={editing} keyboardType="decimal-pad" className="flex-1" />
            <Field label="Protein (g)" value={protein} onChangeText={setProtein} editable={editing} keyboardType="decimal-pad" className="flex-1" />
          </View>
          <View className="flex-row gap-3">
            <Field label="Carbs (g)" value={carbs} onChangeText={setCarbs} editable={editing} keyboardType="decimal-pad" className="flex-1" />
            <Field label="Fat (g)" value={fat} onChangeText={setFat} editable={editing} keyboardType="decimal-pad" className="flex-1" />
          </View>
          <View className="flex-row gap-3">
            <Field label="Fiber (g)" value={fiber} onChangeText={setFiber} editable={editing} keyboardType="decimal-pad" className="flex-1" />
            <Field label="Sodium (mg)" value={sodium} onChangeText={setSodium} editable={editing} keyboardType="decimal-pad" className="flex-1" />
          </View>
          <Field label="Currency symbol" value={currency} onChangeText={setCurrency} editable={editing} className="w-28" />
          {editing ? (
            <View className="flex-row gap-3">
              <Button label="Save targets" onPress={saveTargets} disabled={!dirty} className="flex-1 py-[8px] rounded-xl" textClassName="text-[12px]" />
              <Button label="Cancel" variant="secondary" onPress={cancelEdit} className="flex-1 py-[8px] rounded-xl" textClassName="text-[12px]" />
            </View>
          ) : (
            <Button label="Edit targets" variant="secondary" onPress={() => setEditing(true)} className="py-[8px] rounded-xl" textClassName="text-[12px]" />
          )}
        </Card>

        <Muted className="text-center text-[12px] mt-2">
          NutriCraft · local-first + cloud sync
        </Muted>
      </ScrollView>
    </View>
  );
}
