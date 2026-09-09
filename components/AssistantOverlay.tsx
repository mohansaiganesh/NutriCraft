// Scenario: A home cook on the couch after dinner, phone in one hand, thumbing a quick
// "did I hit my protein today?" without leaving whatever screen they're on — so the entry
// point must float over everything and the sheet must sit above the thumb + keyboard.
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { IconCheck, IconChevronDown, IconChevronRight, IconSparkles, IconTrash, IconX } from './icons';
import { settingsQuery } from '@/db/queries';
import { useAssistant } from '@/lib/assistant/useAssistant';
import type { Message } from '@/lib/assistant/useAssistant';
import type { ConfirmRequest } from '@/lib/assistant/agent';
import type { WriteEdit } from '@/lib/assistant/tools';
import { MEAL_TYPES } from '@/constants/meals';
import type { MealType } from '@/constants/meals';
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
  const { height: screenH } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [kbInset, setKbInset] = useState(0);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const { messages, sending, trace, hasKey, model, chooseModel, send, stop, clear, refreshKey, pendingWrite, confirmWrite, cancelWrite } =
    useAssistant();
  const scrollRef = useRef<ScrollView>(null);
  const activeModelLabel = AVAILABLE_MODELS.find((m) => m.id === model)?.label ?? model;

  // Re-check the stored key each time the panel opens (the user may have just added it).
  useEffect(() => {
    if (open) refreshKey();
    else setMenuOpen(false); // never reopen the panel with a stale model menu showing
  }, [open, refreshKey]);

  // The panel is an in-window overlay (not a Modal), so Android's back button would otherwise pop the
  // underlying screen. Intercept it while open: close the model menu first, then the panel.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }
      setOpen(false);
      return true; // handled → don't pop the underlying screen
    });
    return () => sub.remove();
  }, [open, menuOpen]);

  // Edge-to-edge (the SDK 54 default) means the IME never resizes the window — the app just draws
  // behind the keyboard — so measure it ourselves. Android reports the IME height *above* the nav
  // bar, while the root view still spans the nav bar, so add that inset back to get the real offset
  // from the bottom of the screen. iOS already measures from the screen bottom.
  useEffect(() => {
    if (!open) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) =>
      setKbInset(e.endCoordinates.height + (Platform.OS === 'android' ? insets.bottom : 0)),
    );
    const hide = Keyboard.addListener(hideEvt, () => setKbInset(0));
    return () => {
      show.remove();
      hide.remove();
      setKbInset(0); // never reopen the panel with a stale inset
    };
  }, [open, insets.bottom]);

  // Keyboard closed: the usual 82%. Keyboard open: grow into whatever is left above it, but stop
  // short of the status bar so the header stays reachable.
  const sheetHeight = Math.min(screenH * 0.82, screenH - kbInset - insets.top - 8);

  useEffect(() => {
    if (open) scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending, trace, open, kbInset]);

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

      {open ? (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          style={[StyleSheet.absoluteFill, { bottom: kbInset, backgroundColor: 'rgba(11,20,14,0.35)' }]}
        >
          {/* Same-window overlay instead of a Modal: the assistant is mounted after <Stack>, so this
              sits on top of the app. Under edge-to-edge the window is never resized by the keyboard,
              so the overlay ends at `bottom: kbInset` — right where the keyboard begins — and the
              justify-end sheet lands on top of it. No native keyboard module needed. */}
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            {/* Tap the dim backdrop to dismiss. */}
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />

            <Animated.View
              entering={SlideInDown.duration(240)}
              exiting={SlideOutDown.duration(180)}
              className="bg-paper rounded-t-3xl border-t border-hair overflow-hidden"
              style={{ height: sheetHeight, paddingBottom: kbInset > 0 ? 0 : insets.bottom }}
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
                    {pendingWrite ? (
                      <ConfirmCard req={pendingWrite} onConfirm={confirmWrite} onCancel={cancelWrite} />
                    ) : null}
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
            </Animated.View>
          </View>
        </Animated.View>
      ) : null}
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
    <View className="self-start w-[88%] rounded-3xl rounded-bl-lg px-4 py-[10px] border bg-card border-hair">
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
            <Text key={i} className="font-body text-[14.5px] leading-6 text-ink">
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
                  className={`text-[14.5px] leading-6 mr-2 ${
                    ordered ? 'font-body-sb text-ink2' : 'font-body-b text-brand'
                  }`}
                >
                  {ordered ? `${j + 1}.` : '•'}
                </Text>
                <Text className="flex-1 font-body text-[14.5px] leading-6 text-ink">
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

/** The batch of writes Nico proposes, paused for a SINGLE decision. Nothing is persisted until
 * Confirm is tapped. An all-removal batch gets the red treatment; a batch with any removal marks
 * those rows in red so a delete never hides among routine logs. One item reads as a single line.
 * Tapping Edit turns each grams-bearing row into a numeric input so the user can fix amounts before
 * confirming; the edited grams ride back on `onConfirm(edits)`, keyed by each item's id.
 * Rows that carry `editableMeal` show a meal picker inline — and when Nico DIDN'T know the meal
 * (editableMeal === null) the user MUST pick one before Confirm enables, so a food is never logged
 * to a guessed meal. */
function ConfirmCard({
  req,
  onConfirm,
  onCancel,
}: {
  req: ConfirmRequest;
  onConfirm: (edits?: Record<string, WriteEdit>) => void;
  onCancel: () => void;
}) {
  const items = req.items;
  const multi = items.length > 1;
  const allDestructive = items.length > 0 && items.every((i) => i.destructive);
  const anyEditable = items.some((i) => i.editableGrams != null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // item id → grams text (this session)
  // Amounts the user has saved but NOT yet finalized — kept across editing sessions, submitted only
  // when the main card's Confirm is tapped. Holds only rows that differ from their original grams.
  const [savedEdits, setSavedEdits] = useState<Record<string, number>>({});
  // The meal chosen per row. Seeded from the write's own meal when it had one; a row that reached
  // the card with no meal (editableMeal === null) starts unset and blocks Confirm until picked.
  const [mealDrafts, setMealDrafts] = useState<Record<string, MealType>>(() => {
    const seed: Record<string, MealType> = {};
    for (const it of items) if (it.editableMeal) seed[it.id] = it.editableMeal;
    return seed;
  });
  const mealRows = items.filter((i) => i.editableMeal !== undefined);
  const mealMissing = mealRows.some((i) => mealDrafts[i.id] == null); // a meal still needs picking
  const title = allDestructive
    ? multi
      ? 'Confirm removals'
      : 'Confirm removal'
    : editing
      ? multi
        ? 'Edit amounts'
        : 'Edit amount'
      : multi
        ? 'Confirm these changes'
        : 'Confirm this change';

  const startEditing = () => {
    const seed: Record<string, string> = {};
    // Pre-fill from the last saved amount if there is one, otherwise the model's original grams.
    for (const it of items) if (it.editableGrams != null) seed[it.id] = String(savedEdits[it.id] ?? it.editableGrams);
    setDrafts(seed);
    setEditing(true);
  };

  // A draft is valid only as a positive number; an invalid field blocks Save so no bad grams stick.
  const parsed = (id: string): number | null => {
    const n = Number(drafts[id]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const anyInvalid = editing && items.some((i) => i.editableGrams != null && parsed(i.id) === null);

  // Save/Cancel stay inside the card: neither finalizes. Save stashes the changed amounts and returns
  // to the main card; Cancel just drops this session's drafts.
  const saveEdits = () => {
    if (anyInvalid) return;
    const next: Record<string, number> = {};
    for (const it of items) {
      if (it.editableGrams == null) continue;
      const n = parsed(it.id);
      if (n != null && n !== it.editableGrams) next[it.id] = n; // keep only what actually changed
    }
    setSavedEdits(next);
    setEditing(false);
  };
  const cancelEditing = () => setEditing(false);

  // Main-card Confirm is the only thing that finalizes, carrying whatever was saved: the edited
  // grams and any meal the user picked (sent only when it differs from the write's original meal).
  const confirm = () => {
    if (mealMissing) return; // guarded by the disabled button too — never confirm a meal-less log
    const edits: Record<string, WriteEdit> = {};
    for (const it of items) {
      const e: WriteEdit = {};
      if (savedEdits[it.id] != null) e.grams = savedEdits[it.id];
      const meal = mealDrafts[it.id];
      if (meal != null && meal !== it.editableMeal) e.mealType = meal;
      if (e.grams != null || e.mealType != null) edits[it.id] = e;
    }
    onConfirm(Object.keys(edits).length ? edits : undefined);
  };

  return (
    <View
      className={`self-start w-[88%] rounded-3xl rounded-bl-lg px-4 py-3 border ${
        allDestructive ? 'bg-[#FDECEC] border-[#F6CDCD]' : 'bg-[#F1FAF2] border-[#CDE9D3]'
      }`}
    >
      <View className="flex-row items-center gap-2 mb-2">
        <View
          className={`w-[22px] h-[22px] rounded-full items-center justify-center ${
            allDestructive ? 'bg-[#F6CDCD]' : 'bg-[#D8F0DD]'
          }`}
        >
          {allDestructive ? <IconTrash size={13} color="#E03131" /> : <IconSparkles size={13} color="#2F9E44" />}
        </View>
        <Text className={`font-body-b text-[13px] ${allDestructive ? 'text-over' : 'text-brand'}`}>{title}</Text>
      </View>

      {editing ? (
        <View className="gap-2 mb-1">
          {items.map((item) =>
            item.editableGrams != null ? (
              <View key={item.id} className="flex-row items-center gap-2">
                <Text className="flex-1 font-body text-[14px] leading-5 text-ink" numberOfLines={2}>
                  {item.editNoun}
                </Text>
                <TextInput
                  value={drafts[item.id] ?? ''}
                  onChangeText={(t) => setDrafts((d) => ({ ...d, [item.id]: t }))}
                  keyboardType="numeric"
                  selectTextOnFocus
                  accessibilityLabel={`Grams of ${item.editNoun}`}
                  className="w-[72px] text-right rounded-xl border border-[#DCE5D4] bg-card px-2.5 py-[7px] text-[14px] font-body-md text-ink"
                />
                <Text className="font-body-md text-[13px] text-ink3 w-[14px]">g</Text>
              </View>
            ) : (
              // Non-editable rows (removals, meal bundles) stay as-is even in edit mode.
              <View key={item.id} className="flex-row">
                <Text className={`text-[14px] leading-5 mr-2 ${item.destructive ? 'text-over' : 'font-body-b text-brand'}`}>•</Text>
                <Text className={`flex-1 font-body text-[14px] leading-5 ${item.destructive ? 'text-over' : 'text-ink'}`}>
                  {item.summary}
                </Text>
              </View>
            )
          )}
          <Text className={`font-body text-[11.5px] text-[#B0433F] ${anyInvalid ? '' : 'opacity-0'}`}>
            Enter an amount greater than 0.
          </Text>
        </View>
      ) : multi ? (
        <View className="gap-2 mb-3">
          {items.map((item) => (
            <View key={item.id} className="gap-1">
              <View className="flex-row items-baseline">
                <Text className={`text-[14px] leading-5 mr-2 ${item.destructive ? 'text-over' : 'font-body-b text-brand'}`}>•</Text>
                <Text className={`flex-1 font-body text-[14px] leading-5 ${item.destructive ? 'text-over' : 'text-ink'}`}>
                  {item.summary}
                  {savedEdits[item.id] != null ? (
                    <Text className="font-body-sb text-[12px] text-brand">{`  → ${savedEdits[item.id]} g`}</Text>
                  ) : null}
                </Text>
              </View>
              {item.editableMeal !== undefined ? (
                <View className="pl-4">
                  <MealPicker
                    value={mealDrafts[item.id] ?? null}
                    onPick={(m) => setMealDrafts((d) => ({ ...d, [item.id]: m }))}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <View className="mb-3">
          <Text className="font-body text-[14px] leading-5 text-ink">
            {items[0]?.summary}
            {items[0] && savedEdits[items[0].id] != null ? (
              <Text className="font-body-sb text-[12px] text-brand">{`  → ${savedEdits[items[0].id]} g`}</Text>
            ) : null}
          </Text>
          {items[0] && items[0].editableMeal !== undefined ? (
            <MealPicker
              value={mealDrafts[items[0].id] ?? null}
              onPick={(m) => setMealDrafts((d) => ({ ...d, [items[0].id]: m }))}
            />
          ) : null}
        </View>
      )}

      {!editing && mealMissing ? (
        <Text className="font-body text-[12px] leading-4 text-ink3 -mt-1 mb-2">
          Pick a meal to log this to.
        </Text>
      ) : null}

      {editing ? (
        // Edit mode: Cancel/Save both return to the main card without finalizing anything.
        <View className="flex-row justify-end items-center gap-2">
          <Pressable
            onPress={cancelEditing}
            className="rounded-full px-4 py-[9px] border border-hair bg-card active:opacity-80"
          >
            <Text className="font-body-sb text-[13px] text-ink2">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={saveEdits}
            disabled={anyInvalid}
            className={`rounded-full px-4 py-[9px] active:opacity-90 ${anyInvalid ? 'bg-[#CFE0C6]' : 'bg-brand'}`}
          >
            <Text className="font-body-b text-[13px] text-white">Save</Text>
          </Pressable>
        </View>
      ) : (
        // Main card: only these finalize — Confirm commits (with any saved edits), Cancel rejects.
        <View className="flex-row justify-end items-center gap-2">
          <Pressable
            onPress={onCancel}
            className="rounded-full px-4 py-[9px] border border-hair bg-card active:opacity-80"
          >
            <Text className="font-body-sb text-[13px] text-ink2">Cancel</Text>
          </Pressable>
          {anyEditable ? (
            <Pressable
              onPress={startEditing}
              className="rounded-full px-4 py-[9px] border border-[#CDE9D3] bg-card active:opacity-80"
            >
              <Text className="font-body-sb text-[13px] text-brand">Edit</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={confirm}
            disabled={mealMissing}
            className={`rounded-full px-4 py-[9px] active:opacity-90 ${
              mealMissing ? 'bg-[#CFE0C6]' : allDestructive ? 'bg-[#E03131]' : 'bg-brand'
            }`}
          >
            <Text className="font-body-b text-[13px] text-white">{allDestructive ? 'Remove' : 'Confirm'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** The four meal chips on a confirm row. `value` null ⇒ nothing chosen yet (Nico didn't know the
 * meal); tapping one selects it (and re-selecting is how the user corrects a meal Nico guessed).
 * Uses each meal's own tint so the choice reads at a glance, matching the day screen's meal colors. */
function MealPicker({ value, onPick }: { value: MealType | null; onPick: (m: MealType) => void }) {
  return (
    <View className="flex-row flex-wrap gap-1.5 mt-1.5">
      {MEAL_TYPES.map((m) => {
        const active = value === m.key;
        return (
          <Pressable
            key={m.key}
            onPress={() => onPick(m.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={m.label}
            className={`rounded-full px-3 py-[6px] border ${active ? '' : 'bg-card border-[#DCE5D4]'} active:opacity-80`}
            style={active ? { backgroundColor: m.tintBg, borderColor: m.tint } : undefined}
          >
            <Text
              className={`font-body-sb text-[12.5px] ${active ? '' : 'text-ink2'}`}
              style={active ? { color: m.tint } : undefined}
            >
              {m.label}
            </Text>
          </Pressable>
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

  if (step.kind === 'confirm') {
    const awaiting = step.status === 'awaiting';
    const approved = step.status === 'approved';
    return (
      <View className="py-1">
        <View className="flex-row items-center gap-2">
          <View className="w-[18px] items-center">
            {awaiting ? (
              <ActivityIndicator size="small" color="#2F9E44" />
            ) : approved ? (
              <IconCheck size={16} color="#2F9E44" />
            ) : (
              <View className="w-[18px] h-[18px] rounded-full bg-[#EEF1EE] items-center justify-center">
                <IconX size={11} color="#8B9A8D" />
              </View>
            )}
          </View>
          <Text className="flex-1 font-body-md text-[13px] text-ink2">
            {step.label}
            {awaiting ? ' — awaiting confirmation…' : approved ? '' : ' — cancelled'}
          </Text>
        </View>
        <Text className="ml-[26px] mt-0.5 font-body text-[12px] leading-4 text-ink3">{step.summary}</Text>
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
