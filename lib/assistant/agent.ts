/**
 * The assistant's agentic loop: send the conversation to Gemini, let it decide which
 * read-only tools to call, execute them locally against SQLite, feed the results back, and
 * repeat until the model returns a plain text answer (or we hit the iteration cap).
 */
import { callGemini } from './gemini';
import type { GeminiContent, GeminiPart } from './gemini';
import { describeWrite, executeWrite, isWriteTool, runTool } from './tools';
import type { PendingWrite } from './tools';
import { newId } from '@/lib/id';
import { todayISO } from '@/lib/format';
import { callSignature, describeError, describeStop, toolErrorMessage, toolLabel, toolResultOk } from './events';
import type { AssistantErrorKind, RetryStep, StopReason, StopReasonKind, TraceStep } from './events';

// The loop adapts to observed progress rather than a single flat cap. These are safety BOUNDS, not
// the normal stop — most questions finish in 1–3 rounds when the model returns plain text.
const MAX_ROUNDS = 12; // absolute ceiling on Gemini round-trips (was a flat 6)
const MAX_TOOL_CALLS = 16; // cumulative tool executions across the whole run (rounds can batch calls)
const MAX_STALLED_ROUNDS = 1; // consecutive rounds with NO new tool call before we bail

/** The system prompt, stamped with the real current date so the model never guesses the year. */
function buildSystemPrompt(): string {
  const today = todayISO();
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  const year = today.slice(0, 4);
  return `You are NutriCraft's built-in nutrition assistant. You answer the user's questions about THEIR OWN data — logged foods, saved meals, daily logs, macros (calories, protein, carbs, fat, fiber, sodium) and costs — using the provided tools.

Today's date is ${weekday}, ${today}. The current year is ${year}.

Rules:
- Always call tools to get real numbers. Never guess, estimate, or invent data.
- For anything time-related ("today", "this week", "this month", "last 7 days"), call get_today FIRST to resolve the date and get ready-made ranges, then pass those dates to get_day_totals / get_range_totals.
- When the user names a date without a year (e.g. "Jan 5th"), assume the current year unless they clearly mean otherwise.
- Nutrition and prices are stored per 100 g/ml, but the tools already return ACTUAL logged amounts and totals — use those directly.
- Costs are in the user's currency; tool results include a "currency" symbol — use it when showing money.
- Be concise, friendly and specific. Lead with the answer, round numbers sensibly, and add at most a short bit of context. If there is no data for the period, say so plainly.
- Format replies as short plain prose. You may use **bold** for key numbers and simple "- " bullet lists when listing several items — keep formatting minimal. Do not use tables, headings, code blocks, or links.
- You can log foods and add saved meals to a day using the write tools (log_food, update_log_entry, remove_log_entry, apply_meal_to_day). To log a specific food you must first find it with search_foods and use its id; to edit or remove an entry, first find it with list_day_logs and use its logId.
- The app shows the user a confirmation CARD automatically for every write — so NEVER ask the user to confirm in prose or say things like "please confirm" or "let me know if you'd like to proceed". Before a write, briefly state in ONE short sentence what you are about to log (e.g. "I'll add 45 g of dates to your breakfast."). Never claim something is done, logged, changed, or removed until the tool result confirms it. AFTER the tool result confirms the write, reply with a brief PAST-TENSE confirmation of what was logged (e.g. "Added 45 g of dates to your breakfast."). If a write comes back rejected, acknowledge that nothing was changed and offer to adjust it — do not silently retry.
- You cannot create or edit foods, create or rename meals or their items, or change targets/settings. If asked, briefly say so and point the user to the relevant screen (Foods, Meals, or Preferences).`;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantError {
  kind: AssistantErrorKind;
  message: string; // friendly prose (the error card body)
  detail?: string; // raw technical text for the expandable section
  iteration: number; // 0-based loop index the failure happened on
}

export type AssistantResult =
  | { ok: true; text: string; stoppedEarly?: StopReason } // stoppedEarly set on an early exit that still had partial text
  | { ok: false; error: AssistantError };

/** A proposed write handed to `onConfirm`; the returned promise resolves once the user decides. */
export interface ConfirmRequest extends PendingWrite {
  id: string; // the confirm trace step id — stable across the pause so the UI can pair the decision
  label: string; // friendly label from toolLabel()
}
export type ConfirmDecision = 'approve' | 'reject';

const hasFunctionCall = (
  p: GeminiPart
): p is { functionCall: { name: string; args: Record<string, unknown>; id?: string } } =>
  'functionCall' in p;

/** Gemini requires functionResponse.response to be a JSON object; wrap arrays/scalars. */
function wrapResponse(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : { result: v };
}

/** Build the structured error, logging it in dev so failures are visible in the Metro console. */
function fail(kind: AssistantErrorKind, raw: string, iteration: number): AssistantResult {
  const { message, detail } = describeError(kind, raw);
  const error: AssistantError = { kind, message, detail, iteration };
  if (__DEV__) console.warn('[assistant] error', error);
  return { ok: false, error };
}

export async function runAssistant(opts: {
  question: string;
  history: ChatTurn[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  /** Observes the run as it happens — one snapshot per step, re-emitted (same id) as it transitions. */
  onEvent?: (step: TraceStep) => void;
  /**
   * Gate for every write the model proposes. The loop pauses here until it resolves 'approve' or
   * 'reject'; a write NEVER runs without an 'approve'. Omit it and all writes are auto-rejected.
   */
  onConfirm?: (req: ConfirmRequest) => Promise<ConfirmDecision>;
  /**
   * Fires with any prose the model emits ALONGSIDE a write proposal, so the UI can show it as a
   * bubble BEFORE the confirm card. This text is shown once here and never reused as the final
   * answer, so the pre-write narration can't leak out after the user has already confirmed.
   */
  onMessage?: (text: string) => void;
}): Promise<AssistantResult> {
  // A throwing observer must never break the never-throw loop; dev-log every step here.
  const emit = (s: TraceStep) => {
    if (__DEV__) console.log('[assistant]', s.kind, s);
    try {
      opts.onEvent?.(s);
    } catch {
      /* ignore observer failures */
    }
  };

  // Seed the conversation with prior text turns, then the new question.
  const contents: GeminiContent[] = opts.history.map((t) => ({
    role: t.role === 'user' ? 'user' : 'model',
    parts: [{ text: t.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: opts.question }] });

  // Built once per run — the date is stable across the loop's iterations.
  const systemPrompt = buildSystemPrompt();

  // Adaptive-budget state, tracked across rounds.
  const seen = new Set<string>(); // signatures of tool calls already executed (repeat = no progress)
  let toolCallsUsed = 0; // cumulative tool executions this run
  let stalledRounds = 0; // consecutive rounds that requested only already-seen calls
  let lastText = ''; // best plain text the model has produced so far (shown if we exit early)
  let didWrite = false; // a write actually executed this run — steers the terminal fallback

  /**
   * Exit the loop early. If the model has already produced usable text, return it as a successful
   * answer tagged with a "stopped early" note; otherwise fall back to the error card (today's
   * behavior when there's nothing usable to show).
   */
  const finishEarly = (kind: StopReasonKind, detail: string, iteration: number): AssistantResult => {
    if (__DEV__) console.warn('[assistant] stopped early', { kind, detail, iteration });
    if (lastText) return { ok: true, text: lastText, stoppedEarly: describeStop(kind, detail) };
    return fail('iteration_limit', detail, iteration);
  };

  /** Run a read tool immediately, emitting its running→ok/error trace row. */
  const handleRead = async (name: string, label: string, stepId: string, args: Record<string, unknown>) => {
    emit({ kind: 'tool', id: stepId, name, label, args, status: 'running' });
    const result = await runTool(name, args);
    const ok = toolResultOk(result);
    emit({
      kind: 'tool',
      id: stepId,
      name,
      label,
      args,
      status: ok ? 'ok' : 'error',
      result,
      ok,
      error: ok ? undefined : toolErrorMessage(result),
    });
    return result;
  };

  /**
   * A write: validate+resolve, then PAUSE on the confirmation gate. The mutation runs only after an
   * 'approve'. A validation failure returns an { error } (no prompt); a missing confirmer, an abort,
   * or a decline all resolve to a rejected write that touches nothing.
   */
  const handleWrite = async (name: string, label: string, stepId: string, args: Record<string, unknown>) => {
    const described = await describeWrite(name, args);
    if (!toolResultOk(described)) {
      // Bad/hallucinated args — surface as a tool error so the model can correct, no card shown.
      emit({ kind: 'tool', id: stepId, name, label, args, status: 'error', result: described, ok: false, error: toolErrorMessage(described) });
      return described;
    }
    const pending = described as PendingWrite;
    const row = { tool: name, label, summary: pending.summary, destructive: pending.destructive };

    if (!opts.onConfirm || opts.signal?.aborted) {
      emit({ kind: 'confirm', id: stepId, ...row, status: 'rejected' });
      return { rejected: true, reason: 'The user did not approve this action.' };
    }

    emit({ kind: 'confirm', id: stepId, ...row, status: 'awaiting' });
    let decision: ConfirmDecision = 'reject';
    try {
      decision = await opts.onConfirm({ id: stepId, label, ...pending });
    } catch {
      decision = 'reject';
    }
    if (decision !== 'approve' || opts.signal?.aborted) {
      emit({ kind: 'confirm', id: stepId, ...row, status: 'rejected' });
      return { rejected: true, reason: 'The user declined this action.' };
    }

    const result = await executeWrite(name, pending.payload);
    emit({ kind: 'confirm', id: stepId, ...row, status: 'approved', result });
    return result;
  };

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const modelStepId = newId();
    emit({ kind: 'model', id: modelStepId, iteration: i, status: 'running' });

    // Track the retries emitted during this call so we can settle them (stop their spinner) the
    // instant the call resolves — whether it ultimately succeeded or failed.
    const retries: RetryStep[] = [];
    const res = await callGemini({
      contents,
      systemInstruction: systemPrompt,
      apiKey: opts.apiKey,
      model: opts.model,
      signal: opts.signal,
      onRetry: (info) => {
        const step: RetryStep = { kind: 'retry', id: newId(), ...info };
        retries.push(step);
        emit(step);
      },
    });
    for (const r of retries) emit({ ...r, settled: true });
    if (!res.ok) return fail(res.error.kind, res.error.message, i);
    emit({
      kind: 'model',
      id: modelStepId,
      iteration: i,
      status: 'done',
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
    });

    const calls = res.parts.filter(hasFunctionCall);
    // Record the model's turn (text and/or the function calls it wants) in the running history.
    contents.push({ role: 'model', parts: res.parts });

    // Keep the best plain text seen so far — an early exit can still show a partial answer.
    const roundText = res.parts
      .map((p) => ('text' in p ? p.text : ''))
      .join('')
      .trim();
    const hasWrite = calls.some((c) => isWriteTool(c.functionCall.name));
    if (roundText) {
      if (hasWrite) {
        // Prose that precedes a write proposal — surface it as a bubble NOW, above the confirm
        // card. It's already been shown, so it must never become the final answer / a partial.
        opts.onMessage?.(roundText);
      } else {
        lastText = roundText;
      }
    }

    if (calls.length === 0) {
      return { ok: true, text: roundText || lastText || (didWrite ? 'Done.' : "I couldn't find an answer to that.") };
    }

    // Stall detection: if EVERY call this round repeats one we already ran, the model is looping and
    // making no new progress. Tolerate MAX_STALLED_ROUNDS such rounds, then bail.
    const signatures = calls.map((c) => callSignature(c.functionCall.name, c.functionCall.args));
    const hasNewWork = signatures.some((s) => !seen.has(s));
    if (hasNewWork) {
      stalledRounds = 0;
    } else if (++stalledRounds > MAX_STALLED_ROUNDS) {
      return finishEarly('stalled', `Model repeated the same tool calls without new progress (round ${i + 1}).`, i);
    }

    // Cumulative work budget: stop before spending more tool calls than the run is allowed.
    if (toolCallsUsed >= MAX_TOOL_CALLS) {
      return finishEarly('tool_budget', `Reached the ${MAX_TOOL_CALLS}-tool-call budget for one question.`, i);
    }

    // Execute each requested tool locally and return every result in one turn. Read tools run
    // immediately; write tools pause on the confirmation gate and run only if the user approves.
    const responseParts: GeminiPart[] = [];
    for (const c of calls) {
      // Echo the model's call id when present so parallel calls stay paired in both the trace + Gemini.
      const stepId = c.functionCall.id ?? newId();
      const name = c.functionCall.name;
      const label = toolLabel(name);
      const args = c.functionCall.args;

      const result = isWriteTool(name)
        ? await handleWrite(name, label, stepId, args)
        : await handleRead(name, label, stepId, args);

      // A write that actually ran (approved, no validation/mutation error) — used only to keep the
      // terminal fallback sensible if the model goes silent after logging.
      if (
        isWriteTool(name) &&
        result != null &&
        typeof result === 'object' &&
        !('rejected' in result) &&
        !('error' in result)
      ) {
        didWrite = true;
      }

      responseParts.push({
        functionResponse: {
          name,
          response: wrapResponse(result),
          ...(c.functionCall.id ? { id: c.functionCall.id } : {}),
        },
      });
    }
    // Record what we just executed so repeats register as no-progress, and spend the work budget.
    for (const s of signatures) seen.add(s);
    toolCallsUsed += calls.length;
    contents.push({ role: 'user', parts: responseParts });
  }

  return finishEarly('round_limit', `Stopped after the ${MAX_ROUNDS}-round ceiling.`, MAX_ROUNDS);
}
