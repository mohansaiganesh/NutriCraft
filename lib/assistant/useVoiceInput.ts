import { requireOptionalNativeModule } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

/**
 * Thin wrapper around expo-speech-recognition so the assistant overlay only sees a tiny surface —
 * mirrors how keyStore/modelStore each isolate a single native concern. On-device dictation runs
 * *continuously* (until the user taps stop) and *appends* to whatever is already in the composer:
 * `start(baseText)` captures the existing draft, then every result emits `base + everything dictated
 * so far` via `onTranscript`. This hook never sends — it only produces text. RN-thin; the pure agent
 * code stays untouched.
 *
 * Why we accumulate ourselves: in continuous mode expo-speech-recognition emits each `result` event
 * for the *current segment only*, not a running transcript (its own docs: "Partial results cover new
 * segments… concatenate with the previous final result"). So we keep the finalized segments in a ref
 * and join the live interim segment onto them.
 *
 * IMPORTANT: the library's JS entry calls `requireNativeModule(...)` at import time, which THROWS in
 * Expo Go (no native module). So we load the native module via `requireOptionalNativeModule` (returns
 * null instead of throwing) and keep only type-only imports from the library — otherwise importing
 * this file would crash the whole app in Expo Go, since AssistantOverlay is mounted globally.
 */

type EventSubscription = { remove: () => void };

// The slice of the native module we actually use, typed off the library's own types.
type SpeechNativeModule = {
  start: (options: ExpoSpeechRecognitionOptions) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  isRecognitionAvailable: () => boolean;
  addListener: (
    eventName: 'start' | 'end' | 'result' | 'error',
    listener: (event: any) => void,
  ) => EventSubscription;
};

// null in Expo Go / anywhere the native module isn't linked. Safe at module-eval (never throws).
const SpeechModule = requireOptionalNativeModule<SpeechNativeModule>('ExpoSpeechRecognition');

type VoiceInputOptions = {
  /**
   * The full text the composer should show right now: the text present when `start()` was called,
   * with everything dictated so far (finalized segments + the live interim segment) appended. Fires
   * on every partial and final result. Does NOT auto-send.
   */
  onTranscript: (text: string) => void;
};

export type VoiceInput = {
  /** The native recognizer is present and available on this device/platform. */
  supported: boolean;
  /** A dictation session is currently running. */
  listening: boolean;
  /**
   * Request permission (first use) then begin continuous dictation. Pass the current composer text so
   * new speech is appended to it rather than replacing it.
   */
  start: (baseText?: string) => Promise<void>;
  /** Stop dictation gracefully and let the trailing final segment append. */
  stop: () => void;
  /** Cancel dictation immediately, discarding any in-flight result (used when the message is sent). */
  abort: () => void;
  /** Human-readable error, or null. Cleared on the next successful start. */
  error: string | null;
};

/** Append `b` onto `a`, inserting a single space only when one is needed. */
function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return /\s$/.test(a) ? a + b : a + ' ' + b;
}

// Whether the native module is usable at all. In Expo Go SpeechModule is null; guard the availability
// probe too since it can throw on platforms without a recognizer.
function detectSupport(): boolean {
  if (!SpeechModule) return false;
  try {
    return SpeechModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

function friendlyError(code: ExpoSpeechRecognitionErrorCode, message: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is off. Enable it for NutriCraft in your device settings.';
    case 'no-speech':
    case 'speech-timeout':
      return "Didn't catch that — tap the mic and try again.";
    case 'network':
      return 'Speech recognition needs a connection right now. Check your network and retry.';
    case 'language-not-supported':
      return 'Voice input isn’t available for this language on your device.';
    case 'audio-capture':
      return 'Could not access the microphone. Make sure nothing else is using it.';
    default:
      return message || 'Voice input hit a snag. Tap the mic to try again.';
  }
}

export function useVoiceInput({ onTranscript }: VoiceInputOptions): VoiceInput {
  const [supported] = useState(detectSupport);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest callback in a ref so the native event listeners never read a stale closure.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Composer text captured at start (appended onto), and the finalized segments so far this session.
  const baseRef = useRef('');
  const finalRef = useRef('');

  // Register native listeners manually (instead of the library's useSpeechRecognitionEvent, which
  // imports the throwing module) so we can early-return when the module isn't present.
  useEffect(() => {
    if (!SpeechModule) return;
    // Emit base + (finalized-so-far joined with the live interim segment).
    const emit = (session: string) => onTranscriptRef.current(joinText(baseRef.current, session));
    const subs: EventSubscription[] = [
      SpeechModule.addListener('start', () => setListening(true)),
      SpeechModule.addListener('end', () => setListening(false)),
      SpeechModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        // Continuous mode: each event carries only the current segment, so accumulate finals here.
        const transcript = event.results?.[0]?.transcript ?? '';
        if (event.isFinal) {
          if (transcript) finalRef.current = joinText(finalRef.current, transcript);
          emit(finalRef.current);
        } else if (transcript) {
          emit(joinText(finalRef.current, transcript));
        }
      }),
      SpeechModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        setError(friendlyError(event.error, event.message));
        setListening(false);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const start = useCallback(async (baseText?: string) => {
    if (!SpeechModule) {
      setError('Voice input needs the full app build (it isn’t available in Expo Go).');
      return;
    }
    setError(null);
    // Fresh session: append onto whatever is already in the composer, no finals yet.
    baseRef.current = baseText ?? '';
    finalRef.current = '';
    try {
      const perm = await SpeechModule.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone access is off. Enable it for NutriCraft in your device settings.');
        return;
      }
      // continuous: keep listening until the user taps stop (also mutes Android's start/stop beep).
      SpeechModule.start({ lang: 'en-US', interimResults: true, continuous: true, iosTaskHint: 'dictation' });
    } catch {
      setError('Could not start voice input. Tap the mic to try again.');
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    try {
      SpeechModule?.stop();
    } catch {
      // Already stopped / native unavailable — nothing to do.
    }
  }, []);

  const abort = useCallback(() => {
    try {
      SpeechModule?.abort();
    } catch {
      // Already stopped / native unavailable — nothing to do.
    }
  }, []);

  // Never leave the recognizer running if the overlay unmounts mid-session.
  useEffect(() => {
    return () => {
      try {
        SpeechModule?.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  return { supported, listening, start, stop, abort, error };
}
