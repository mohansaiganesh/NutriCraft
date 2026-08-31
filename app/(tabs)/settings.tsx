import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { importSeedCatalog } from '@/lib/seed';
import { importBackup, shareBackup } from '@/lib/backup';
import { num } from '@/lib/format';
import { Button, Card, Field, Muted } from '@/components/ui';

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

  const onExport = async () => {
    try {
      await shareBackup();
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message ?? e));
    }
  };

  const onImport = async () => {
    try {
      const res = await importBackup();
      if (!res) return; // cancelled
      Alert.alert(
        'Import complete',
        `Foods: ${res.foods}, Meals: ${res.meals}, Meal items: ${res.mealItems}, Logs: ${res.logs}`
      );
    } catch (e: any) {
      Alert.alert('Import failed', String(e?.message ?? e));
    }
  };

  const onReimportSeed = async () => {
    const { inserted, skipped } = await importSeedCatalog();
    Alert.alert('Starter catalog', `Added ${inserted} foods (${skipped} already present).`);
  };

  return (
    <ScrollView className="flex-1 bg-neutral-50 dark:bg-black" contentContainerClassName="p-4 pb-16 gap-3">
      <Card className="gap-3">
        <Text className="font-bold text-lg text-neutral-900 dark:text-neutral-50">Daily targets</Text>
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
        <Field label="Currency symbol" value={currency} onChangeText={setCurrency} className="w-24" />
        <Button label="Save targets" onPress={saveTargets} />
      </Card>

      <Card className="gap-3">
        <Text className="font-bold text-lg text-neutral-900 dark:text-neutral-50">Backup</Text>
        <Muted className="text-sm">Export your entire database to a JSON file, or merge one back in.</Muted>
        <Button label="Export data (JSON)" onPress={onExport} variant="secondary" />
        <Button label="Import data (JSON)" onPress={onImport} variant="secondary" />
      </Card>

      <Card className="gap-2">
        <Text className="font-bold text-lg text-neutral-900 dark:text-neutral-50">Starter catalog</Text>
        <Muted className="text-sm">
          Re-import the built-in starter foods (skips ones already in your catalog).
        </Muted>
        <Button label="Import starter foods" onPress={onReimportSeed} variant="secondary" />
      </Card>

      <Muted className="text-center text-xs mt-2">NutriCraft · local-first (SQLite)</Muted>
    </ScrollView>
  );
}
