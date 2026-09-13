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
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, type Href } from 'expo-router';
import { IconCheck, IconChevronDown, IconChevronRight, IconHistory, IconMic, IconSparkles, IconTrash, IconX } from './icons';
import { DataBlock } from './assistant/DataBlock';
import { MarkdownText } from './assistant/MarkdownText';
import { settingsQuery } from '@/db/queries';
import { useAssistant } from '@/lib/assistant/useAssistant';
import { useSession } from '@/lib/session';
import { getFabCorner, setFabCorner, DEFAULT_CORNER, type Corner } from '@/lib/assistant/fabPositionStore';
import { useVoiceInput } from '@/lib/assistant/useVoiceInput';
import type { Message } from '@/lib/assistant/useAssistant';
import type { ConfirmRequest } from '@/lib/assistant/agent';
import type { WriteEdit } from '@/lib/assistant/tools';
import { MEAL_TYPES } from '@/constants/meals';
import type { MealType } from '@/constants/meals';
import { AVAILABLE_MODELS } from '@/lib/assistant/gemini';
import { errorTitle, previewJson, traceUsage } from '@/lib/assistant/events';
import type { StopReason, TraceStep } from '@/lib/assistant/events';
import { parseMarkdown } from '@/lib/assistant/markdown';

const TAB_BAR_HEIGHT = 56; // matches app/(tabs)/_layout.tsx
const STARTERS = ['Calories this week', 'Most expensive meal', 'Am I over target today?'];

// The floating bubble is draggable and snaps to a corner. FAB_SIZE/MARGIN drive both the resting
// coordinates and the nearest-corner math.
const FAB_SIZE = 68;
const FAB_MARGIN = 20;
// Height of the app header bar below the safe-area inset (the AppHeader title/account row in
// components/ui.tsx: ~8px top padding + a 34px title + 16px bottom margin). A top-resting bubble
// lands just under it.
const HEADER_HEIGHT = 64;
// Small downward nudge so a bottom-resting bubble tucks right up against the tab bar (closes the
// hairline gap left by the avatar's transparent ring).
const FOOTER_NUDGE = 20;

/**
 * Absolute top-left coordinates the bubble rests at for a given corner, in screen space.
 * The bubble parks flush inside the content area with no vertical padding: top corners sit just
 * below the app header bar, bottom corners sit right above the tab bar (footer).
 */
function cornerCoords(
  corner: Corner,
  screenW: number,
  screenH: number,
  insets: EdgeInsets,
): { x: number; y: number } {
  'worklet'; // callable from the pan gesture worklet (UI thread) as well as from JS effects
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? FAB_MARGIN : screenW - FAB_MARGIN - FAB_SIZE,
    y: top
      ? insets.top + HEADER_HEIGHT
      : screenH - (TAB_BAR_HEIGHT + insets.bottom) - FAB_SIZE + FOOTER_NUDGE,
  };
}

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
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { userId } = useSession();
  const [open, setOpen] = useState(false);
  const [kbInset, setKbInset] = useState(0);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const { messages, sending, trace, hasKey, model, chooseModel, explicitCache, setExplicitCache, send, stop, clear, refreshKey, pendingWrite, confirmWrite, cancelWrite } =
    useAssistant();
  // Dictation appends to the composer live and keeps listening until the user taps stop; the text
  // stays put for the user to review, then send.
  const voice = useVoiceInput({ onTranscript: setDraft });
  const scrollRef = useRef<ScrollView>(null);
  const activeModelLabel = AVAILABLE_MODELS.find((m) => m.id === model)?.label ?? model;

  // --- Draggable bubble --------------------------------------------------------------------------
  // The bubble can be dragged and snaps to the nearest corner on release; the chosen corner is
  // remembered per user (device-local). The expanded sheet is a full-width bottom sheet and is
  // deliberately independent of the bubble's corner — it never follows the button.
  const [corner, setCorner] = useState<Corner>(DEFAULT_CORNER);
  const dragging = useSharedValue(false);
  const startXY = useSharedValue({ x: 0, y: 0 });
  const initial = cornerCoords(DEFAULT_CORNER, screenW, screenH, insets);
  const x = useSharedValue(initial.x);
  const y = useSharedValue(initial.y);

  // Load the persisted corner once a user is active.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getFabCorner(userId).then((c) => {
      if (active) setCorner(c);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  // Keep the bubble parked on its corner as the corner or the screen geometry changes (rotation,
  // safe-area changes). Don't fight an in-progress drag.
  useEffect(() => {
    if (dragging.value) return;
    const { x: tx, y: ty } = cornerCoords(corner, screenW, screenH, insets);
    x.value = withSpring(tx, { damping: 18, stiffness: 200 });
    y.value = withSpring(ty, { damping: 18, stiffness: 200 });
  }, [corner, screenW, screenH, insets.top, insets.bottom]);

  const applyCorner = (next: Corner) => {
    setCorner(next);
    if (userId) setFabCorner(userId, next);
  };

  const panGesture = Gesture.Pan()
    .minDistance(6) // a stationary press falls through to the tap gesture → opens the assistant
    .onStart(() => {
      dragging.value = true;
      startXY.value = { x: x.value, y: y.value };
    })
    .onUpdate((e) => {
      x.value = startXY.value.x + e.translationX;
      y.value = startXY.value.y + e.translationY;
    })
    .onEnd(() => {
      const centerX = x.value + FAB_SIZE / 2;
      const centerY = y.value + FAB_SIZE / 2;
      const left = centerX < screenW / 2;
      const top = centerY < screenH / 2;
      const next: Corner = top
        ? left
          ? 'top-left'
          : 'top-right'
        : left
          ? 'bottom-left'
          : 'bottom-right';
      const { x: tx, y: ty } = cornerCoords(next, screenW, screenH, insets);
      x.value = withSpring(tx, { damping: 18, stiffness: 200 });
      y.value = withSpring(ty, { damping: 18, stiffness: 200 });
      dragging.value = false;
      runOnJS(applyCorner)(next);
    });

  const tapGesture = Gesture.Tap().onEnd(() => runOnJS(setOpen)(true));
  const fabGesture = Gesture.Exclusive(panGesture, tapGesture);

  const fabAnimatedStyle = useAnimatedStyle(() => ({ left: x.value, top: y.value }));

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
    if (voice.listening) voice.abort(); // discard any in-flight result so it can't refill the draft
    setDraft('');
    send(t);
  };

  const goToSettings = () => {
    setOpen(false);
    router.push('/(tabs)/account/preferences');
  };

  const goToHistory = () => {
    setOpen(false);
    router.push('/(tabs)/account/traces');
  };

  // Follow a nav button on an answer bubble (e.g. "Open Foods catalog") — close the panel, then
  // navigate. Same close-then-push pattern as goToSettings; the target comes from NAV_TOOLS.
  const goTo = (pathname: string) => {
    setOpen(false);
    router.push(pathname as Href);
  };

  const confirmClear = () => {
    Alert.alert('Clear conversation?', 'This erases the chat and what the assistant remembers.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clear },
    ]);
  };

  return (
    <>
      {/* Floating entry point — drag it to any corner (snaps on release), tap to open. Rests clear
          of the tab bar / status bar so it never collides with per-screen FABs or the notch. */}
      <GestureDetector gesture={fabGesture}>
        <Animated.View
          accessibilityLabel="Open the nutrition assistant"
          accessibilityRole="button"
          className="absolute w-[68px] h-[68px] rounded-full overflow-hidden items-center justify-center"
          style={[fabAnimatedStyle, fabShadow]}
        >
          <Image source={require('../assets/assistant-avatar.png')} style={{ width: 68, height: 68 }} />
        </Animated.View>
      </GestureDetector>

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
                <Pressable
                  onPress={goToHistory}
                  hitSlop={10}
                  accessibilityLabel="Request history"
                  className="w-9 h-9 rounded-full items-center justify-center active:opacity-60 mr-1"
                >
                  <IconHistory size={19} color="#5B6B5E" />
                </Pressable>
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
                      messages.map((m) => <Bubble key={m.id} message={m} onNavigate={goTo} />)
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

                    <View className="px-4 pt-2 flex-row items-center gap-2">
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

                      {/* Explicit prompt caching: reuses the system prompt + tool defs across calls to
                          save tokens. Needs a paid Gemini key; otherwise it falls back automatically,
                          so implicit caching still applies when this is off. */}
                      <Pressable
                        onPress={() => setExplicitCache(!explicitCache)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: explicitCache }}
                        accessibilityLabel="Toggle prompt caching to save tokens"
                        className={`flex-row items-center gap-1.5 rounded-full border px-[12px] py-[6px] active:opacity-80 ${
                          explicitCache ? 'border-brand bg-[#EAF7EC]' : 'border-hair bg-card'
                        }`}
                      >
                        <Text className="text-[12px]">⚡</Text>
                        <Text className={`font-body-md text-[12px] ${explicitCache ? 'text-brand' : 'text-ink3'}`}>
                          Caching {explicitCache ? 'on' : 'off'}
                        </Text>
                      </Pressable>
                    </View>

                    <View className="flex-row items-end gap-2 px-4 pt-2 pb-3">
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder={voice.listening ? 'Listening…' : 'Ask a question…'}
                      placeholderTextColor="#9AA79B"
                      multiline
                      onSubmitEditing={() => submit(draft)}
                      className="flex-1 max-h-28 rounded-2xl border border-[#DCE5D4] bg-card px-[14px] py-[11px] text-[15px] font-body-md text-ink"
                    />
                    {voice.supported && !sending ? (
                      <Pressable
                        onPress={() => (voice.listening ? voice.stop() : voice.start(draft))}
                        accessibilityLabel={voice.listening ? 'Stop dictation' : 'Dictate your message'}
                        className={`w-11 h-11 rounded-full items-center justify-center border ${
                          voice.listening
                            ? 'bg-brand border-brand active:opacity-90'
                            : 'bg-[#EEF3EA] border-[#DCEAD4] active:opacity-80'
                        }`}
                      >
                        <IconMic size={19} color={voice.listening ? '#fff' : '#3A4A3D'} />
                      </Pressable>
                    ) : null}
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
                    {voice.error ? (
                      <Text className="px-4 pb-2 -mt-1 font-body text-[12px] text-[#B4482F]">{voice.error}</Text>
                    ) : null}
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

function Bubble({ message, onNavigate }: { message: Message; onNavigate: (pathname: string) => void }) {
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
      {message.navigation ? (
        <NavButton
          label={message.navigation.label}
          onPress={() => onNavigate(message.navigation!.pathname)}
        />
      ) : null}
      {message.stoppedEarly ? <StoppedEarlyNotice reason={message.stoppedEarly} /> : null}
      {hasTrace ? <StepsDisclosure steps={message.steps!} /> : null}
    </View>
  );
}

/** Tappable handoff on an answer — closes the panel and opens a screen (e.g. the Foods catalog). */
function NavButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-2.5 self-start flex-row items-center gap-[5px] rounded-full bg-[#EEF6EC] border border-[#DCEAD4] px-[13px] py-[7px] active:opacity-80"
    >
      <Text className="text-[#1B7A32] font-body-b text-[13px]">{label}</Text>
      <IconChevronRight size={15} color="#1B7A32" />
    </Pressable>
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
  // Which cache path ran across the whole answer: explicit if any round referenced a cachedContents
  // resource, else implicit if any round reported cached tokens.
  const usedExplicit = steps.some((s) => s.kind === 'model' && s.request?.cachedContent != null);
  const cacheTag = usedExplicit ? ' · explicit cache' : usage.cachedTokens > 0 ? ' · implicit cache' : '';
  const tokensLine = `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out · ${usage.cachedTokens.toLocaleString()} cached${cacheTag}`;
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
    const errored = step.status === 'error';
    const hasTokens = step.inputTokens != null || step.outputTokens != null;
    const cached = step.cachedTokens ?? 0;
    // Which cache path this round used: explicit if it referenced a cachedContents resource,
    // else implicit when Gemini reported a cached prefix on its own.
    const cacheTag = step.request?.cachedContent ? ' · explicit cache' : cached > 0 ? ' · implicit cache' : '';
    return (
      <View className="flex-row items-center gap-2 py-1">
        <View className="w-[18px] items-center">
          {running ? (
            <ActivityIndicator size="small" color="#2F9E44" />
          ) : errored ? (
            <View className="w-[18px] h-[18px] rounded-full bg-[#FDECEC] items-center justify-center">
              <IconX size={12} color="#E03131" />
            </View>
          ) : (
            <IconSparkles size={14} color="#2F9E44" />
          )}
        </View>
        <Text className={`flex-1 font-body-md text-[12.5px] ${errored ? 'text-over' : 'text-ink3'}`}>
          Gemini call {step.iteration + 1}
          {running ? '…' : errored ? ' — failed' : ''}
        </Text>
        {hasTokens ? (
          <Text className="font-body-md text-[11px] text-ink3">
            {(step.inputTokens ?? 0).toLocaleString()} in · {(step.outputTokens ?? 0).toLocaleString()} out ·{' '}
            {cached.toLocaleString()} cached{cacheTag}
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
