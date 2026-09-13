import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { num } from '@/lib/format';
import { useSession } from '@/lib/session';
import { clearApiKey, hasApiKey, setApiKey } from '@/lib/assistant/keyStore';
import { Button, Card, DetailHeader, Field, Muted } from '@/components/ui';
import { IconCheck } from '@/components/icons';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

/** Lets the user store their own Google Gemini API key (device-only, powers the assistant). */
function AiAssistantCard() {
  const { userId } = useSession();
  const [stored, setStored] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (userId) {
      hasApiKey(userId).then((v) => active && setStored(v));
    }
    return () => {
      active = false;
    };
  }, [userId]);

  const save = async () => {
    if (!userId || !value.trim()) return;
    setBusy(true);
    await setApiKey(userId, value.trim());
    setBusy(false);
    setValue('');
    setStored(true);
    setEditing(false);
    Alert.alert('Saved', 'Your Gemini API key was saved on this device.');
  };

  const remove = async () => {
    if (!userId) return;
    setBusy(true);
    await clearApiKey(userId);
    setBusy(false);
    setValue('');
    setStored(false);
    setEditing(false);
  };

  const showSaved = stored && !editing;

  return (
    <Card className="gap-3">
      <CardTitle>AI Assistant</CardTitle>
      <Muted className="text-[12.5px] leading-[18px] -mt-1">
        Ask questions about your data using Google Gemini. Create a free key at Google AI Studio
        (aistudio.google.com/apikey) — it must be a new auth key (starts with{' '}
        <Text className="font-body-md text-ink2">AQ.</Text>); older keys that start with{' '}
        <Text className="font-body-md text-ink2">AIza</Text> are no longer accepted by Google. Your
        key is stored only on this device (encrypted) and never synced.
      </Muted>

      {showSaved ? (
        <View className="flex-row items-center gap-2 rounded-2xl bg-[#F1F4EE] border border-[#E4E9DF] px-[14px] py-[12px]">
          <IconCheck size={16} color="#2F9E44" />
          <Text className="font-body-md text-[13.5px] text-ink2">Key saved · ••••••••</Text>
        </View>
      ) : (
        <Field
          label="Gemini API key"
          value={value}
          onChangeText={setValue}
          editable={!busy}
          placeholder="AQ.…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}

      {showSaved ? (
        <View className="flex-row gap-3">
          <Button
            label="Replace key"
            variant="secondary"
            onPress={() => {
              setEditing(true);
              setValue('');
            }}
            className="flex-1 py-[8px] rounded-xl"
            textClassName="text-[12px]"
          />
          <Button label="Remove" variant="danger" onPress={remove} className="flex-1 py-[8px] rounded-xl" textClassName="text-[12px]" />
        </View>
      ) : (
        <View className="flex-row gap-3">
          <Button label="Save key" onPress={save} disabled={!value.trim() || busy} className="flex-1 py-[8px] rounded-xl" textClassName="text-[12px]" />
          {stored ? (
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setEditing(false);
                setValue('');
              }}
              className="flex-1 py-[8px] rounded-xl"
              textClassName="text-[12px]"
            />
          ) : null}
        </View>
      )}

      <Muted className="text-[11.5px] leading-[16px] text-ink3">
        Pick which model answers from the dropdown next to the chat box. Note: on Gemini&apos;s free
        tier, Google may use your questions and data to improve their models.
      </Muted>
    </Card>
  );
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

        <AiAssistantCard />

        <Muted className="text-center text-[12px] mt-2">
          NutriCraft · local-first + cloud sync
        </Muted>
      </ScrollView>
    </View>
  );
}
