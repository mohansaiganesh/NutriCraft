import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { settingsQuery, updateSettings } from '@/db/queries';
import { num } from '@/lib/format';
import { useSession } from '@/lib/session';
import { clearApiKey, hasApiKey, setApiKey } from '@/lib/assistant/keyStore';
import type { LlmProvider } from '@/lib/assistant/provider';
import { Button, Card, DetailHeader, Field, Muted } from '@/components/ui';
import { IconCheck } from '@/components/icons';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text className="font-display-sb text-[15px] text-ink mb-1">{children}</Text>;
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <Text className="font-body-md text-ink2">{children}</Text>
);

/** One provider's key: shows a saved badge or an entry field, with save/replace/remove. Each provider's
 * key is stored independently on-device via `keyStore` (never synced). */
function ProviderKeyRow({
  userId,
  provider,
  label,
  placeholder,
  hint,
}: {
  userId: string | null;
  provider: LlmProvider;
  label: string;
  placeholder: string;
  hint: React.ReactNode;
}) {
  const [stored, setStored] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (userId) {
      hasApiKey(userId, provider).then((v) => active && setStored(v));
    }
    return () => {
      active = false;
    };
  }, [userId, provider]);

  const save = async () => {
    if (!userId || !value.trim()) return;
    setBusy(true);
    await setApiKey(userId, provider, value.trim());
    setBusy(false);
    setValue('');
    setStored(true);
    setEditing(false);
    Alert.alert('Saved', `Your ${label} API key was saved on this device.`);
  };

  const remove = async () => {
    if (!userId) return;
    setBusy(true);
    await clearApiKey(userId, provider);
    setBusy(false);
    setValue('');
    setStored(false);
    setEditing(false);
  };

  const showSaved = stored && !editing;

  return (
    <View className="gap-2">
      <Text className="font-body-sb text-[13px] text-ink">{label}</Text>
      <Muted className="text-[12px] leading-[17px] -mt-0.5">{hint}</Muted>

      {showSaved ? (
        <View className="flex-row items-center gap-2 rounded-2xl bg-[#F1F4EE] border border-[#E4E9DF] px-[14px] py-[12px]">
          <IconCheck size={16} color="#2F9E44" />
          <Text className="font-body-md text-[13.5px] text-ink2">Key saved · ••••••••</Text>
        </View>
      ) : (
        <Field
          label={`${label} API key`}
          value={value}
          onChangeText={setValue}
          editable={!busy}
          placeholder={placeholder}
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
    </View>
  );
}

/** Lets the user store their own provider API keys (device-only) — one per provider, powering the
 * assistant. Which provider answers is chosen by the model picked in the chat. */
function AiAssistantCard() {
  const { userId } = useSession();

  return (
    <Card className="gap-4">
      <View>
        <CardTitle>AI Assistant</CardTitle>
        <Muted className="text-[12.5px] leading-[18px] -mt-1">
          Ask questions about your data using Google Gemini or Groq. Add a key for whichever provider
          you want to use — keys are stored only on this device (encrypted) and never synced.
        </Muted>
      </View>

      <ProviderKeyRow
        userId={userId}
        provider="google"
        label="Google Gemini"
        placeholder="AQ.…"
        hint={
          <>
            Create a free key at Google AI Studio (aistudio.google.com/apikey) — it must be a new auth
            key (starts with <Mono>AQ.</Mono>); older keys that start with <Mono>AIza</Mono> are no
            longer accepted by Google.
          </>
        }
      />

      <ProviderKeyRow
        userId={userId}
        provider="groq"
        label="Groq"
        placeholder="gsk_…"
        hint={<>Create a key at console.groq.com/keys. Powers the GPT-OSS models.</>}
      />

      <Muted className="text-[11.5px] leading-[16px] text-ink3">
        Pick which model answers from the dropdown next to the chat box. Note: on a provider&apos;s free
        tier, it may use your questions and data to improve its models.
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
