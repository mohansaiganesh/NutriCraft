/**
 * React state for the assistant chat panel: message list, send/stop, and whether the current
 * user has a Gemini key stored. Owns an AbortController so closing the panel or asking a new
 * question cancels an in-flight request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { newId } from '@/lib/id';
import { getApiKey, hasApiKey } from './keyStore';
import { getModel, setModel } from './modelStore';
import { DEFAULT_MODEL } from './gemini';
import { runAssistant } from './agent';
import type { ChatTurn } from './agent';
import type { AssistantErrorKind, TraceStep } from './events';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True when this assistant bubble is an error (excluded from the model's history). */
  error?: boolean;
  /** Structured error info for the titled error card (only on error bubbles). */
  errorKind?: AssistantErrorKind;
  errorDetail?: string;
  /** The activity trace this answer/error was produced by, kept for the post-hoc disclosure. */
  steps?: TraceStep[];
}

export function useAssistant() {
  const { userId } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]); // live activity for the in-flight question
  const [hasKey, setHasKey] = useState<boolean | null>(null); // null = not checked yet
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);
  const abortRef = useRef<AbortController | null>(null);
  const runSeq = useRef(0); // bumped per send / stop / clear so stale emits are ignored

  const refreshKey = useCallback(async () => {
    setHasKey(userId ? await hasApiKey(userId) : false);
  }, [userId]);

  useEffect(() => {
    refreshKey();
  }, [refreshKey]);

  // Load the user's chosen model (falls back to DEFAULT_MODEL); re-runs when the account changes.
  useEffect(() => {
    let active = true;
    if (userId) getModel(userId).then((m) => active && setModelState(m));
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

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending || !userId) return;

      const key = await getApiKey(userId);
      if (!key) {
        setHasKey(false);
        return;
      }
      setHasKey(true);

      // History = prior non-error turns, captured before we append the new question.
      const history: ChatTurn[] = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, text: m.text }));

      setMessages((prev) => [...prev, { id: newId(), role: 'user', text }]);
      setSending(true);

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

      const controller = new AbortController();
      abortRef.current = controller;
      const res = await runAssistant({ question: text, history, apiKey: key, model, signal: controller.signal, onEvent });
      if (myRun !== runSeq.current || controller.signal.aborted) {
        // Cancelled or superseded — drop the partial trace and append no bubble.
        if (myRun === runSeq.current) setTrace([]);
        setSending(false);
        return;
      }
      setMessages((prev) => [
        ...prev,
        res.ok
          ? { id: newId(), role: 'assistant', text: res.text, steps }
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
      setSending(false);
      abortRef.current = null;
    },
    [messages, sending, userId, model]
  );

  const stop = useCallback(() => {
    runSeq.current++; // ignore any in-flight emit/result from the aborted run
    abortRef.current?.abort();
    setTrace([]);
    setSending(false);
  }, []);

  const clear = useCallback(() => {
    runSeq.current++;
    abortRef.current?.abort();
    setMessages([]);
    setTrace([]);
    setSending(false);
  }, []);

  // Cancel any in-flight request if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, sending, trace, hasKey, model, chooseModel, send, stop, clear, refreshKey };
}
