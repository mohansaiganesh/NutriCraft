import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { num } from '@/lib/format';
import { AccountButton, AppHeader, Button, Card, Field, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

export default function SettingsScreen() {
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

  useEffect(() => {
    if (settings && !loaded) {
      setCalories(String(settings.targetCalories));
      setProtein(String(settings.targetProteinG));
      setCarbs(String(settings.targetCarbsG));
      setFat(String(settings.targetFatG));
      setFiber(String(settings.targetFiberG));
      setSodium(String(settings.targetSodiumMg));
      setCurrency(settings.currency);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const saveTargets = async () => {
    await updateSettings({
      targetCalories: num(calories),
      targetProteinG: num(protein),
      targetCarbsG: num(carbs),
      targetFatG: num(fat),
      targetFiberG: num(fiber),
      targetSodiumMg: num(sodium),
      currency: currency.trim() || '$',
    });
    Alert.alert('Saved', 'Your daily targets were updated.');
  };

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="px-4 pb-16 gap-[14px]">
      <AppHeader kicker="Nutrition" title="Preferences" kickerBelow right={<AccountButton />} />

      <Card className="gap-3">
        <CardTitle>Daily targets</CardTitle>
        <View className="flex-row gap-3">
          <Field label="Calories" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" className="flex-1" />
          <Field label="Protein (g)" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" className="flex-1" />
        </View>
        <View className="flex-row gap-3">
          <Field label="Carbs (g)" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" className="flex-1" />
          <Field label="Fat (g)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" className="flex-1" />
        </View>
        <View className="flex-row gap-3">
          <Field label="Fiber (g)" value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" className="flex-1" />
          <Field label="Sodium (mg)" value={sodium} onChangeText={setSodium} keyboardType="decimal-pad" className="flex-1" />
        </View>
        <Field label="Currency symbol" value={currency} onChangeText={setCurrency} className="w-28" />
        <Button label="Save targets" onPress={saveTargets} className="py-[8px] rounded-xl" textClassName="text-[12px]" />
      </Card>

      <Muted className="text-center text-[12px] mt-2">
        NutriCraft · local-first + cloud sync
      </Muted>
    </ScrollView>
  );
}
