import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
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

export default function AssistantScreen() {
  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="AI assistant" />
      <ScrollView contentContainerClassName="px-4 pb-16 gap-[14px]">
        <AiAssistantCard />
      </ScrollView>
    </View>
  );
}
