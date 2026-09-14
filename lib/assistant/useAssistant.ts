/**
 * React state for the assistant chat panel: message list, send/stop, and which providers the
 * current user has a key stored for. Owns an AbortController so closing the panel or asking a new
 * question cancels an in-flight request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { newId } from '@/lib/id';
import { saveTrace } from '@/db/queries';
import { getApiKey, hasApiKey } from './keyStore';
import { getModel, setModel } from './modelStore';
import { getCachePref, setCachePref } from './cachePrefStore';
import { ALL_PROVIDERS, AVAILABLE_MODELS, DEFAULT_MODEL, providerForModel } from './models';
import type { LlmProvider } from './provider';
import { runAssistant } from './agent';
import type { ChatTurn, ConfirmDecision, ConfirmRequest, NavTarget } from './agent';
import type { WriteEdit } from './tools';
import { traceUsage } from './events';
import type { AssistantErrorKind, StopReason, TraceStep } from './events';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True when this assistant bubble is an error (excluded from the model's history). */
  error?: boolean;
  /** Structured error info for the titled error card (only on error bubbles). */
  errorKind?: AssistantErrorKind;
  errorDetail?: string;
  /** Set on a SUCCESSFUL answer that the loop cut short — shown as a note under the reply. */
  stoppedEarly?: StopReason;
  /** A screen the answer offers to open — rendered as a tappable button under the reply. */
  navigation?: NavTarget;
  /** The activity trace this answer/error was produced by, kept for the post-hoc disclosure. */
  steps?: TraceStep[];
}

/** Merge adjacent same-role turns (joining text with a blank line) so any run of same-role bubbles
 * reads as one turn to Gemini. Alternating histories pass through unchanged. */
function coalesceTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text = `${last.text}\n\n${t.text}`;
    else out.push({ ...t });
  }
  return out;
}

export function useAssistant() {
  const { userId } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]); // live activity for the in-flight question
  // Which providers have a stored key (null = not checked yet). Drives the picker (only keyed
  // providers are offered) and the no-key gate (empty ⇒ show the "Open Preferences" prompt).
  const [keyedProviders, setKeyedProviders] = useState<LlmProvider[] | null>(null);
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);
  const [explicitCache, setExplicitCacheState] = useState<boolean>(false); // explicit prompt caching toggle
  const [pendingWrite, setPendingWrite] = useState<ConfirmRequest | null>(null); // a write awaiting Confirm/Cancel
  const abortRef = useRef<AbortController | null>(null);
  const resolveConfirmRef = useRef<((d: ConfirmDecision) => void) | null>(null); // resolves the paused onConfirm
  const runSeq = useRef(0); // bumped per send / stop / clear so stale emits are ignored

  // The provider serving the currently-selected model — drives which key we read and the NoKey copy.
  const provider = providerForModel(model);

  // Settle any in-flight confirmation with a decision and clear the card. Used by the Confirm/Cancel
  // buttons and, defensively, by stop/clear/unmount so a paused write can never dangle or auto-run.
  const settleConfirm = useCallback((decision: ConfirmDecision) => {
    const resolve = resolveConfirmRef.current;
    resolveConfirmRef.current = null;
    setPendingWrite(null);
    resolve?.(decision);
  }, []);

  // Probe every provider's stored key in parallel and keep the ones that are set. Depends only on the
  // account (not the selected model), so it's a single check the panel re-runs on open.
  const refreshKey = useCallback(async () => {
    if (!userId) {
      setKeyedProviders([]);
      return;
    }
    const present = await Promise.all(ALL_PROVIDERS.map((p) => hasApiKey(userId, p)));
    setKeyedProviders(ALL_PROVIDERS.filter((_, i) => present[i]));
  }, [userId]);

  useEffect(() => {
    refreshKey();
  }, [refreshKey]);

  // The no-key gate: null while unchecked, then true iff ANY provider has a key. The overlay shows the
  // "Open Preferences" prompt only when this is false (no provider keyed at all).
  const hasKey = keyedProviders === null ? null : keyedProviders.length > 0;

  // Load the user's chosen model + caching preference (both fall back to defaults); re-runs when the
  // account changes.
  useEffect(() => {
    let active = true;
    if (userId) {
      getModel(userId).then((m) => active && setModelState(m));
      getCachePref(userId).then((c) => active && setExplicitCacheState(c));
    }
    return () => {
      active = false;
    };
  }, [userId]);

  // Change the model from the chat picker: update state now, persist per-user in the background.
  const chooseModel = useCallback(
    (id: string) => {
      setModelState(id);
      if (userId) setModel(userId, id);
    },
    [userId]
  );

  // Keep the active model runnable: if the selected model's provider has no key but another provider
  // does, switch to the first keyed model. (No-op when nothing is keyed — the NoKey prompt shows.)
  useEffect(() => {
    if (!keyedProviders || keyedProviders.length === 0) return;
    if (keyedProviders.includes(providerForModel(model))) return;
    const next = AVAILABLE_MODELS.find((m) => keyedProviders.includes(m.provider));
    if (next) chooseModel(next.id);
  }, [keyedProviders, model, chooseModel]);

  // Toggle explicit prompt caching from the chat: update state now, persist per-user in the background.
  const setExplicitCache = useCallback(
    (on: boolean) => {
      setExplicitCacheState(on);
      if (userId) setCachePref(userId, on);
    },
    [userId]
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending || !userId) return;

      const key = await getApiKey(userId, provider);
      if (!key) {
        refreshKey(); // the active provider lost its key — re-probe so the picker / gate update
        return;
      }

      // History = prior non-error turns, captured before we append the new question. Coalesce any
      // adjacent same-role turns into one — a no-op for plain alternating chats, and a guard that
      // keeps Gemini from ever seeing two back-to-back model turns.
      const history = coalesceTurns(
        messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }))
      );

      setMessages((prev) => [...prev, { id: newId(), role: 'user', text }]);
      setSending(true);
      const startedAt = new Date().toISOString();
      const startMs = Date.now();

      // Fresh run token + trace. `steps` is the authoritative accumulator (avoids stale async state);
      // `setTrace` just mirrors it for rendering. Upsert by id so a step's running→done replaces in place.
      const myRun = ++runSeq.current;
      setTrace([]);
      const steps: TraceStep[] = [];
      const onEvent = (step: TraceStep) => {
        if (myRun !== runSeq.current) return; // a newer send / stop / clear superseded this run
        const idx = steps.findIndex((s) => s.id === step.id);
        if (idx === -1) steps.push(step);
        else steps[idx] = step;
        setTrace([...steps]);
      };

      // The confirmation gate: show the card and pause until the user (or a superseding run) decides.
      const onConfirm = (req: ConfirmRequest) =>
        new Promise<ConfirmDecision>((resolve) => {
          if (myRun !== runSeq.current) return resolve({ kind: 'reject' }); // superseded before we could prompt
          resolveConfirmRef.current = resolve;
          setPendingWrite(req);
        });

      const controller = new AbortController();
      abortRef.current = controller;
      const res = await runAssistant({ question: text, history, apiKey: key, model, explicitCache, signal: controller.signal, onEvent, onConfirm });
      if (myRun !== runSeq.current || controller.signal.aborted) {
        // Cancelled or superseded — drop the partial trace and append no bubble.
        if (myRun === runSeq.current) setTrace([]);
        setSending(false);
        return;
      }
      setMessages((prev) => [
        ...prev,
        res.ok
          ? { id: newId(), role: 'assistant', text: res.text, stoppedEarly: res.stoppedEarly, navigation: res.navigation, steps }
          : {
              id: newId(),
              role: 'assistant',
              text: res.error.message,
              error: true,
              errorKind: res.error.kind,
              errorDetail: res.error.detail,
              steps,
            },
      ]);
      setTrace([]); // the trace now lives on the message

      // Persist the completed request as a durable trace (success OR error — a failed LLM call is the
      // most useful thing to inspect later). Never let a DB hiccup break the chat. Aborted/superseded
      // runs are dropped above, so they are never saved.
      try {
        const usage = traceUsage(steps);
        await saveTrace({
          question: text,
          answer: res.ok ? res.text : res.error.message,
          status: res.ok ? (res.stoppedEarly ? 'stopped_early' : 'ok') : 'error',
          errorKind: res.ok ? null : res.error.kind,
          stopReason: res.ok && res.stoppedEarly ? res.stoppedEarly.kind : null,
          model,
          llmCalls: usage.calls,
          toolCalls: steps.filter((s) => s.kind === 'tool').length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens,
          durationMs: Date.now() - startMs,
          startedAt,
          steps: JSON.stringify(steps),
        });
      } catch (e) {
        if (__DEV__) console.warn('[assistant] saveTrace failed', e);
      }

      setSending(false);
      abortRef.current = null;
    },
    [messages, sending, userId, model, provider, explicitCache, refreshKey]
  );

  const confirmWrite = useCallback(
    (edits?: Record<string, WriteEdit>) => settleConfirm({ kind: 'approve', edits }),
    [settleConfirm]
  );
  const cancelWrite = useCallback(() => settleConfirm({ kind: 'reject' }), [settleConfirm]);

  const stop = useCallback(() => {
    runSeq.current++; // ignore any in-flight emit/result from the aborted run
    settleConfirm({ kind: 'reject' }); // a paused write is abandoned, not run
    abortRef.current?.abort();
    setTrace([]);
    setSending(false);
  }, [settleConfirm]);

  const clear = useCallback(() => {
    runSeq.current++;
    settleConfirm({ kind: 'reject' });
    abortRef.current?.abort();
    setMessages([]);
    setTrace([]);
    setSending(false);
  }, [settleConfirm]);

  // Cancel any in-flight request (and reject a dangling confirmation) if the component unmounts.
  useEffect(
    () => () => {
      resolveConfirmRef.current?.({ kind: 'reject' });
      resolveConfirmRef.current = null;
      abortRef.current?.abort();
    },
    []
  );

  return {
    messages,
    sending,
    trace,
    hasKey,
    keyedProviders: keyedProviders ?? [],
    model,
    provider,
    chooseModel,
    explicitCache,
    setExplicitCache,
    send,
    stop,
    clear,
    refreshKey,
    pendingWrite,
    confirmWrite,
    cancelWrite,
  };
}
