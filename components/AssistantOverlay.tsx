// Scenario: A home cook on the couch after dinner, phone in one hand, thumbing a quick
// "did I hit my protein today?" without leaving whatever screen they're on — so the entry
// point must float over everything and the sheet must sit above the thumb + keyboard.
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { IconCheck, IconChevronDown, IconChevronRight, IconSparkles, IconTrash, IconX } from './icons';
import { settingsQuery } from '@/db/queries';
import { useAssistant } from '@/lib/assistant/useAssistant';
import type { Message } from '@/lib/assistant/useAssistant';
import { AVAILABLE_MODELS } from '@/lib/assistant/gemini';
import { errorTitle, previewJson, traceUsage } from '@/lib/assistant/events';
import type { StopReason, TraceStep } from '@/lib/assistant/events';
import { parseMarkdown } from '@/lib/assistant/markdown';
import type { MdBlock, MdSpan } from '@/lib/assistant/markdown';

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
  const { messages, sending, trace, hasKey, model, chooseModel, send, stop, clear, refreshKey } = useAssistant();
  const scrollRef = useRef<ScrollView>(null);
  const activeModelLabel = AVAILABLE_MODELS.find((m) => m.id === model)?.label ?? model;

  // Re-check the stored key each time the panel opens (the user may have just added it).
  useEffect(() => {
    if (open) refreshKey();
    else setMenuOpen(false); // never reopen the panel with a stale model menu showing
  }, [open, refreshKey]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending, trace, open]);

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
        className="absolute w-[68px] h-[68px] rounded-full overflow-hidden items-center justify-center active:opacity-90"
        style={[{ right: 20, bottom: TAB_BAR_HEIGHT + insets.bottom + 16 }, fabShadow]}
      >
        <Image source={require('../assets/assistant-avatar.png')} style={{ width: 68, height: 68 }} />
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
                <View className="w-[50px] h-[50px] rounded-full overflow-hidden mr-3">
                  <Image source={require('../assets/assistant-avatar.png')} style={{ width: 55, height: 55 }} />
                </View>
                <View className="flex-1">
                  <Text className="font-display-sb text-[17px] text-ink">Nico</Text>
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
                    {sending ? <ActivityTrace steps={trace} /> : null}
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
  const { data } = useLiveQuery(settingsQuery());
  const firstName = data?.[0]?.displayName?.trim().split(/\s+/)[0] ?? '';
  return (
    <View className="flex-1 items-center justify-center py-10">
      <Text className="font-display-sb text-[18px] text-ink text-center mb-1">
        {firstName ? `Hi ${firstName}, I'm Nico` : "Hi, I'm Nico"}
      </Text>
      <Text className="font-body text-[13px] text-ink2 text-center max-w-[260px] mb-5">
        I can help with what you&apos;ve logged — your meals, macros and costs. Just ask.
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
  if (message.error) return <ErrorCard message={message} />;

  const hasTrace = !!message.steps?.length;
  return (
    <View className="self-start max-w-[88%] rounded-3xl rounded-bl-lg px-4 py-[10px] border bg-card border-hair">
      <MarkdownText blocks={parseMarkdown(message.text)} />
      {message.stoppedEarly ? <StoppedEarlyNotice reason={message.stoppedEarly} /> : null}
      {hasTrace ? <StepsDisclosure steps={message.steps!} /> : null}
    </View>
  );
}

/** Subtle note under an answer the loop cut short: the partial answer stands, with a "may be incomplete" caveat. */
function StoppedEarlyNotice({ reason }: { reason: StopReason }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <View className="mt-2 rounded-lg bg-[#FBF3E2] border border-[#F0DEB4] px-2.5 py-2">
      <Text className="font-body-md text-[12px] leading-4 text-[#8A6D1F]">{reason.message}</Text>
      <Pressable onPress={() => setShowDetail((v) => !v)} className="mt-1 flex-row items-center gap-1.5 active:opacity-70">
        {showDetail ? <IconChevronDown size={12} color="#A98A2E" /> : <IconChevronRight size={12} color="#A98A2E" />}
        <Text className="font-body-sb text-[11px] text-[#A98A2E]">Why</Text>
      </Pressable>
      {showDetail ? <Text className="mt-1 font-body-md text-[11px] leading-4 text-[#8A6D1F]">{reason.detail}</Text> : null}
    </View>
  );
}

/** Collapsed usage recap kept on an answered bubble — reopens the full step list + token totals. */
function StepsDisclosure({ steps }: { steps: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  const usage = traceUsage(steps);
  const toolCount = steps.filter((s) => s.kind === 'tool').length;
  const callsLine = [
    `${usage.calls} ${usage.calls === 1 ? 'LLM call' : 'LLM calls'}`,
    toolCount > 0 ? `${toolCount} ${toolCount === 1 ? 'tool call' : 'tool calls'}` : null,
    `${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens`,
  ]
    .filter(Boolean)
    .join(' · ');
  const tokensLine = `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out`;
  return (
    <View className="mt-2 pt-2 border-t border-hair">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-start gap-1.5 active:opacity-70">
        <View className="mt-0.5">
          {open ? <IconChevronDown size={14} color="#8B9A8D" /> : <IconChevronRight size={14} color="#8B9A8D" />}
        </View>
        <View className="flex-1">
          <Text className="font-body-md text-[12px] text-ink3">{callsLine}</Text>
          <Text className="font-body-md text-[12px] text-ink3">{tokensLine}</Text>
        </View>
      </Pressable>
      {open ? (
        <View className="mt-1">
          <StepList steps={steps} />
        </View>
      ) : null}
    </View>
  );
}

/** Titled error card: friendly message + an expandable raw "Technical details" block. */
function ErrorCard({ message }: { message: Message }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <View className="self-start max-w-[88%] rounded-3xl rounded-bl-lg px-4 py-3 border bg-[#FDECEC] border-[#F6CDCD]">
      <View className="flex-row items-center gap-2 mb-1.5">
        <View className="w-[20px] h-[20px] rounded-full bg-[#F6CDCD] items-center justify-center">
          <IconX size={13} color="#E03131" />
        </View>
        <Text className="font-body-b text-[13.5px] text-over">{errorTitle(message.errorKind)}</Text>
      </View>
      <Text className="font-body text-[14px] leading-5 text-over">{message.text}</Text>
      {message.errorDetail ? (
        <View className="mt-2">
          <Pressable
            onPress={() => setShowDetail((v) => !v)}
            className="flex-row items-center gap-1.5 active:opacity-70"
          >
            {showDetail ? (
              <IconChevronDown size={13} color="#B0433F" />
            ) : (
              <IconChevronRight size={13} color="#B0433F" />
            )}
            <Text className="font-body-sb text-[11.5px] text-[#B0433F]">Technical details</Text>
          </Pressable>
          {showDetail ? (
            <View className="mt-1 rounded-lg bg-[#F9DADA] px-2.5 py-2">
              <Text className="font-body-md text-[11.5px] leading-4 text-[#8A2C2C]">{message.errorDetail}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Renders an inline run (bold / italic / code) as a nested <Text>. */
function InlineSpans({ spans }: { spans: MdSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          return (
            <Text key={i} className="font-body-md text-[13px] text-ink bg-[#EEF3EA] rounded px-1">
              {s.text}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            className={s.bold ? 'font-body-b text-ink' : 'font-body text-ink'}
            style={s.italic ? { fontStyle: 'italic' } : undefined}
          >
            {s.text}
          </Text>
        );
      })}
    </>
  );
}

/** Renders parsed markdown blocks with the Garden type tokens — paragraphs and bullet/ordered lists. */
function MarkdownText({ blocks }: { blocks: MdBlock[] }) {
  return (
    <View className="gap-1.5">
      {blocks.map((b, i) => {
        if (b.type === 'paragraph') {
          return (
            <Text key={i} className="font-body text-[14.5px] leading-5 text-ink">
              <InlineSpans spans={b.spans} />
            </Text>
          );
        }
        const ordered = b.type === 'ordered';
        return (
          <View key={i} className="gap-1">
            {b.items.map((item, j) => (
              <View key={j} className="flex-row">
                <Text
                  className={`text-[14.5px] leading-5 mr-2 ${
                    ordered ? 'font-body-sb text-ink2' : 'font-body-b text-brand'
                  }`}
                >
                  {ordered ? `${j + 1}.` : '•'}
                </Text>
                <Text className="flex-1 font-body text-[14.5px] leading-5 text-ink">
                  <InlineSpans spans={item} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** Live activity while the assistant works — the step list (each Gemini call + tool call is a row)
 * plus a running token-usage summary. Replaces the old static "Thinking…" bubble. */
function ActivityTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <View className="self-start w-[88%] rounded-3xl rounded-bl-lg px-4 py-3 border border-hair bg-card">
      <View className="flex-row items-center gap-2 mb-1">
        <View className="w-[22px] h-[22px] rounded-full bg-[#EAF7EC] items-center justify-center">
          <IconSparkles size={13} color="#2F9E44" />
        </View>
        <Text className="font-body-sb text-[12.5px] text-ink2">Working…</Text>
      </View>
      {steps.length === 0 ? (
        // Split-second before the first model step lands — the running rows carry the spinner after.
        <View className="flex-row items-center gap-2 py-1">
          <View className="w-[18px] items-center">
            <ActivityIndicator size="small" color="#2F9E44" />
          </View>
          <Text className="font-body text-[13px] text-ink3">Thinking…</Text>
        </View>
      ) : (
        <StepList steps={steps} />
      )}
    </View>
  );
}

/** Renders the tool/retry rows of a trace (model rounds aren't rows). Shared live + post-hoc. */
function StepList({ steps }: { steps: TraceStep[] }) {
  return (
    <View>
      {steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
    </View>
  );
}

/** One trace row: a retry note, or a tool with a status glyph and tap-to-expand args + result. */
function StepRow({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);

  if (step.kind === 'model') {
    const running = step.status === 'running';
    const hasTokens = step.inputTokens != null || step.outputTokens != null;
    return (
      <View className="flex-row items-center gap-2 py-1">
        <View className="w-[18px] items-center">
          {running ? (
            <ActivityIndicator size="small" color="#2F9E44" />
          ) : (
            <IconSparkles size={14} color="#2F9E44" />
          )}
        </View>
        <Text className="flex-1 font-body-md text-[12.5px] text-ink3">
          Gemini call {step.iteration + 1}
          {running ? '…' : ''}
        </Text>
        {hasTokens ? (
          <Text className="font-body-md text-[11px] text-ink3">
            {(step.inputTokens ?? 0).toLocaleString()} in · {(step.outputTokens ?? 0).toLocaleString()} out
          </Text>
        ) : null}
      </View>
    );
  }

  if (step.kind === 'retry') {
    return (
      <View className="flex-row items-center gap-2 py-1">
        <View className="w-[18px] items-center">
          {step.settled ? (
            <View className="w-2 h-2 rounded-full bg-[#C2820A]" />
          ) : (
            <ActivityIndicator size="small" color="#C2820A" />
          )}
        </View>
        <Text className="font-body text-[12.5px] text-ink3">
          {step.settled
            ? `Server hiccup — retried (attempt ${step.attempt})`
            : `Server hiccup — retrying (attempt ${step.attempt})…`}
        </Text>
      </View>
    );
  }

  const running = step.status === 'running';
  const failed = step.status === 'error';
  return (
    <View className="py-1">
      <Pressable
        onPress={() => !running && setExpanded((v) => !v)}
        className="flex-row items-center gap-2 active:opacity-70"
      >
        <View className="w-[18px] items-center">
          {running ? (
            <ActivityIndicator size="small" color="#2F9E44" />
          ) : failed ? (
            <View className="w-[18px] h-[18px] rounded-full bg-[#FDECEC] items-center justify-center">
              <IconX size={12} color="#E03131" />
            </View>
          ) : (
            <IconCheck size={16} color="#2F9E44" />
          )}
        </View>
        <Text className={`flex-1 font-body-md text-[13px] ${failed ? 'text-over' : 'text-ink2'}`}>
          {step.label}
        </Text>
        {!running ? (
          expanded ? (
            <IconChevronDown size={14} color="#8B9A8D" />
          ) : (
            <IconChevronRight size={14} color="#8B9A8D" />
          )
        ) : null}
      </Pressable>

      {expanded ? (
        <View className="mt-1.5 ml-[26px] gap-1.5">
          <DataBlock label="Arguments" text={previewJson(step.args)} />
          <DataBlock
            label={failed ? 'Error' : 'Result'}
            text={failed ? step.error ?? 'Tool failed' : previewJson(step.result)}
            error={failed}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A labelled monospace-ish block of JSON/text used inside an expanded tool step. */
function DataBlock({ label, text, error = false }: { label: string; text: string; error?: boolean }) {
  return (
    <View>
      <Text className="font-body-sb text-[10px] tracking-wide text-ink3 mb-0.5">{label.toUpperCase()}</Text>
      <View className={`rounded-lg px-2.5 py-2 ${error ? 'bg-[#FDECEC]' : 'bg-[#EEF3EA]'}`}>
        <Text className={`font-body-md text-[11.5px] leading-4 ${error ? 'text-over' : 'text-ink2'}`}>{text}</Text>
      </View>
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
