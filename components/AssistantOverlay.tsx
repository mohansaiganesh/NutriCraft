// Scenario: A home cook on the couch after dinner, phone in one hand, thumbing a quick
// "did I hit my protein today?" without leaving whatever screen they're on — so the entry
// point must float over everything and the sheet must sit above the thumb + keyboard.
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { IconCheck, IconChevronDown, IconChevronRight, IconSparkles, IconTrash, IconX } from './icons';
import { useAssistant } from '@/lib/assistant/useAssistant';
import type { Message } from '@/lib/assistant/useAssistant';
import { AVAILABLE_MODELS } from '@/lib/assistant/gemini';

const TAB_BAR_HEIGHT = 56; // matches app/(tabs)/_layout.tsx
const STARTERS = ['Calories this week', 'Most expensive meal', 'Am I over target today?'];

const fabShadow = {
  shadowColor: '#2F9E44',
  shadowOpacity: 0.42,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 12 },
  elevation: 8,
} as const;

// Soft lift for the model dropdown so it reads as floating above the chat, not a flat card.
const menuShadow = {
  shadowColor: '#0B140E',
  shadowOpacity: 0.16,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 10,
} as const;

export function AssistantOverlay() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const { messages, sending, hasKey, model, chooseModel, send, stop, clear, refreshKey } = useAssistant();
  const scrollRef = useRef<ScrollView>(null);
  const activeModelLabel = AVAILABLE_MODELS.find((m) => m.id === model)?.label ?? model;

  // Re-check the stored key each time the panel opens (the user may have just added it).
  useEffect(() => {
    if (open) refreshKey();
    else setMenuOpen(false); // never reopen the panel with a stale model menu showing
  }, [open, refreshKey]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending, open]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setDraft('');
    send(t);
  };

  const goToSettings = () => {
    setOpen(false);
    router.push('/(tabs)/settings');
  };

  const confirmClear = () => {
    Alert.alert('Clear conversation?', 'This erases the chat and what the assistant remembers.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clear },
    ]);
  };

  return (
    <>
      {/* Floating entry point — clears the tab bar so it never collides with per-screen FABs. */}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Open the nutrition assistant"
        className="absolute w-[56px] h-[56px] rounded-full bg-brand items-center justify-center active:opacity-90"
        style={[{ right: 20, bottom: TAB_BAR_HEIGHT + insets.bottom + 16 }, fabShadow]}
      >
        <IconSparkles size={26} color="#fff" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(11,20,14,0.35)' }}>
          {/* Tap the dim backdrop to dismiss. */}
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setOpen(false)} />

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View
              className="bg-paper rounded-t-3xl border-t border-hair overflow-hidden"
              style={{ height: '82%', paddingBottom: insets.bottom }}
            >
              {/* Header */}
              <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-hair">
                <View className="w-[34px] h-[34px] rounded-full bg-[#EAF7EC] items-center justify-center mr-3">
                  <IconSparkles size={19} color="#2F9E44" />
                </View>
                <View className="flex-1">
                  <Text className="font-display-sb text-[17px] text-ink">Assistant</Text>
                  <Text className="font-body text-[12px] text-ink3">Ask about your foods, meals & logs</Text>
                </View>
                {messages.length > 0 ? (
                  <Pressable
                    onPress={confirmClear}
                    hitSlop={10}
                    accessibilityLabel="Clear conversation"
                    className="w-9 h-9 rounded-full items-center justify-center active:opacity-60 mr-1"
                  >
                    <IconTrash size={19} color="#5B6B5E" />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setOpen(false)}
                  hitSlop={10}
                  className="w-9 h-9 rounded-full items-center justify-center active:opacity-60"
                >
                  <IconX size={20} color="#5B6B5E" />
                </Pressable>
              </View>

              {/* Body */}
              {hasKey === false ? (
                <NoKey onAdd={goToSettings} />
              ) : (
                <>
                  <ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    contentContainerClassName="px-4 py-4 gap-3"
                    keyboardShouldPersistTaps="handled"
                  >
                    {messages.length === 0 ? (
                      <Welcome onPick={submit} disabled={sending} />
                    ) : (
                      messages.map((m) => <Bubble key={m.id} message={m} />)
                    )}
                    {sending ? <Thinking /> : null}
                  </ScrollView>

                  {/* Composer — with the model picker sitting just above the input. */}
                  <View className="border-t border-hair bg-paper">
                    {/* Backdrop: tap anywhere in the panel to dismiss an open model menu. */}
                    {menuOpen ? (
                      <Pressable
                        onPress={() => setMenuOpen(false)}
                        style={{ position: 'absolute', top: -2000, left: 0, right: 0, height: 2000 }}
                      />
                    ) : null}

                    <View className="px-4 pt-2">
                      <View className="relative self-start">
                        {menuOpen ? (
                          <View
                            className="absolute left-0 bottom-full mb-2 min-w-[210px] rounded-2xl bg-card border border-hair overflow-hidden"
                            style={menuShadow}
                          >
                            {AVAILABLE_MODELS.map((m, i) => {
                              const active = model === m.id;
                              return (
                                <Pressable
                                  key={m.id}
                                  onPress={() => {
                                    chooseModel(m.id);
                                    setMenuOpen(false);
                                  }}
                                  className={`flex-row items-center gap-2 px-[14px] py-[11px] ${
                                    i > 0 ? 'border-t border-hair' : ''
                                  } ${active ? 'bg-[#EAF7EC]' : 'active:bg-[#F1F4EE]'}`}
                                >
                                  <View className="w-[16px] items-center">
                                    {active ? <IconCheck size={15} color="#2F9E44" /> : null}
                                  </View>
                                  <Text
                                    className={`font-body-md text-[13.5px] ${active ? 'text-brand' : 'text-ink2'}`}
                                  >
                                    {m.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}

                        <Pressable
                          onPress={() => setMenuOpen((v) => !v)}
                          accessibilityLabel="Choose the AI model"
                          className="flex-row items-center gap-1.5 rounded-full border border-hair bg-card px-[12px] py-[6px] active:opacity-80"
                        >
                          <Text className="font-body-md text-[12px] text-ink3">Model</Text>
                          <Text className="font-body-md text-[12px] text-ink2">{activeModelLabel}</Text>
                          <IconChevronDown size={14} color="#5B6B5E" />
                        </Pressable>
                      </View>
                    </View>

                    <View className="flex-row items-end gap-2 px-4 pt-2 pb-3">
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="Ask a question…"
                      placeholderTextColor="#9AA79B"
                      multiline
                      onSubmitEditing={() => submit(draft)}
                      className="flex-1 max-h-28 rounded-2xl border border-[#DCE5D4] bg-card px-[14px] py-[11px] text-[15px] font-body-md text-ink"
                    />
                    {sending ? (
                      <Pressable
                        onPress={stop}
                        className="w-11 h-11 rounded-full bg-[#EEF3EA] border border-[#DCEAD4] items-center justify-center active:opacity-80"
                      >
                        <IconX size={18} color="#3A4A3D" />
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => submit(draft)}
                        disabled={!draft.trim()}
                        className={`w-11 h-11 rounded-full items-center justify-center ${draft.trim() ? 'bg-brand active:opacity-90' : 'bg-[#CFE0C6]'}`}
                      >
                        <IconChevronRight size={22} color="#fff" />
                      </Pressable>
                    )}
                    </View>
                  </View>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

function Welcome({ onPick, disabled }: { onPick: (t: string) => void; disabled: boolean }) {
  return (
    <View className="flex-1 items-center justify-center py-10">
      <View className="w-[56px] h-[56px] rounded-2xl bg-[#EAF7EC] items-center justify-center mb-4">
        <IconSparkles size={28} color="#2F9E44" />
      </View>
      <Text className="font-display-sb text-[18px] text-ink text-center mb-1">How can I help?</Text>
      <Text className="font-body text-[13px] text-ink2 text-center max-w-[260px] mb-5">
        I can answer questions about what you&apos;ve logged, your meals, macros and costs.
      </Text>
      <View className="flex-row flex-wrap justify-center px-4">
        {STARTERS.map((s) => (
          <Pressable
            key={s}
            onPress={() => !disabled && onPick(s)}
            className="rounded-full px-[14px] py-[9px] mr-2 mb-2 border border-[#DCE5D4] bg-card active:opacity-80"
          >
            <Text className="text-[13px] text-[#3A4A3D] font-body-sb">{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <View className="self-end max-w-[85%] rounded-3xl rounded-br-lg bg-brand px-4 py-[10px]">
        <Text className="font-body-md text-[14.5px] text-white leading-5">{message.text}</Text>
      </View>
    );
  }
  return (
    <View
      className={`self-start max-w-[88%] rounded-3xl rounded-bl-lg px-4 py-[10px] border ${
        message.error ? 'bg-[#FDECEC] border-[#F6CDCD]' : 'bg-card border-hair'
      }`}
    >
      <Text
        className={`font-body text-[14.5px] leading-5 ${message.error ? 'text-over' : 'text-ink'}`}
      >
        {message.text}
      </Text>
    </View>
  );
}

function Thinking() {
  return (
    <View className="self-start flex-row items-center gap-2 rounded-3xl rounded-bl-lg px-4 py-3 border border-hair bg-card">
      <ActivityIndicator size="small" color="#2F9E44" />
      <Text className="font-body text-[13.5px] text-ink2">Thinking…</Text>
    </View>
  );
}

function NoKey({ onAdd }: { onAdd: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="w-[56px] h-[56px] rounded-2xl bg-[#EAF7EC] items-center justify-center mb-4">
        <IconSparkles size={28} color="#2F9E44" />
      </View>
      <Text className="font-display-sb text-[18px] text-ink text-center mb-2">Add a Gemini key</Text>
      <Text className="font-body text-[13.5px] text-ink2 text-center leading-5 mb-6 max-w-[300px]">
        The assistant uses your own Google Gemini API key (free tier). Add it in Preferences to
        start asking questions about your data.
      </Text>
      <Pressable
        onPress={onAdd}
        className="rounded-2xl px-5 py-[13px] bg-brand active:opacity-90"
        style={fabShadow}
      >
        <Text className="text-white font-body-b text-[15px]">Open Preferences →</Text>
      </Pressable>
    </View>
  );
}
