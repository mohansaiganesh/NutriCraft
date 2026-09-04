import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { importBackup, shareBackup } from '@/lib/backup';
import { num } from '@/lib/format';
import { useSession } from '@/lib/session';
import { AppHeader, Button, Card, Field, Muted } from '@/components/ui';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[17px] text-ink mb-1">{children}</Text>;
}

export default function SettingsScreen() {
  const { data } = useLiveQuery(settingsQuery());
  const settings = data?.[0];
  const { email, signOut } = useSession();

  const onSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You’ll return to the login screen, where you or a different user can sign in. Any changes not yet synced will upload next time you sign in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ]
    );
  };

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

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="px-4 pb-16 gap-[14px]">
      <AppHeader kicker="Preferences" title="Settings" />

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
        <Button label="Save targets" onPress={saveTargets} />
      </Card>

      <Card className="gap-3">
        <CardTitle>Backup</CardTitle>
        <Muted className="text-[13.5px] leading-5">
          Export your foods, meals and logs to a JSON file, or merge one back in.
        </Muted>
        <Button label="Export data (JSON)" onPress={onExport} variant="secondary" />
        <Button label="Import data (JSON)" onPress={onImport} variant="secondary" />
      </Card>

      <Card className="gap-3">
        <CardTitle>Account</CardTitle>
        <Muted className="text-[13.5px] leading-5">
          {email ? `Signed in as ${email}.` : 'Signed in.'} Your data syncs across your devices
          and is restored when you reinstall. Sign out to switch to a different account on this
          device.
        </Muted>
        <Button label="Sign out" onPress={onSignOut} variant="danger" />
      </Card>

      <Muted className="text-center text-[12px] mt-2">
        NutriCraft · local-first + cloud sync
      </Muted>
    </ScrollView>
  );
}
