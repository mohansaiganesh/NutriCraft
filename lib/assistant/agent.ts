/**
 * The assistant's agentic loop: send the conversation to Gemini, let it decide which
 * read-only tools to call, execute them locally against SQLite, feed the results back, and
 * repeat until the model returns a plain text answer (or we hit the iteration cap).
 */
import { callGemini } from './gemini';
import type { GeminiContent, GeminiPart, GeminiResult } from './gemini';
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
- Write tools do NOT take effect immediately. Each one returns { staged: true }, meaning the change is QUEUED — the app shows the user ONE confirmation covering ALL queued changes at the very end. So NEVER ask the user to confirm in prose (no "please confirm", no "let me know if you'd like to proceed"), and NEVER claim a change is done, logged, changed, or removed while you are still staging.
- Propose every change the user asked for (call the matching write tool once per change; you may include several in a single turn). When every requested change is staged, STOP calling tools and reply with ONE short present-tense sentence naming everything you are about to log (e.g. "I'll add 45 g of dates, 100 g of rice and 150 g of chicken to your breakfast."). When you are then told the changes were applied, reply with a brief PAST-TENSE confirmation of what was logged (e.g. "Added dates, rice and chicken to your breakfast."). If you are told the user declined, say nothing was changed and offer to adjust — do not silently retry.
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

/** One validated write inside a confirmation batch. */
export interface ConfirmItem extends PendingWrite {
  id: string; // the confirm trace step id — stable so the UI/trace can pair the decision
  label: string; // friendly label from toolLabel()
}
/**
 * A batch of proposed writes handed to `onConfirm` as a SINGLE confirmation; the returned promise
 * resolves once the user decides for the whole batch. Every write the model staged this run is
 * collected here, so the user confirms once no matter how the model split the calls up.
 */
export interface ConfirmRequest {
  id: string; // batch id
  items: ConfirmItem[]; // one per staged, validated write
  destructive: boolean; // any item is a removal → drives the card's red treatment
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

  // Writes proposed this run. They are NOT executed inline: each is validated + staged here, and the
  // whole batch is confirmed ONCE at the end (see confirmStaged) — so the user sees a single card no
  // matter how the model split the write calls across turns.
  const staged: { stepId: string; name: string; label: string; pending: PendingWrite }[] = [];

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

  /** One Gemini round-trip with its trace rows (model running→done + any retries). Shared by the
   * main loop and the single closing round after a confirmation. */
  const callModel = async (iteration: number): Promise<GeminiResult> => {
    const modelStepId = newId();
    emit({ kind: 'model', id: modelStepId, iteration, status: 'running' });
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
    if (res.ok) {
      emit({
        kind: 'model',
        id: modelStepId,
        iteration,
        status: 'done',
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
      });
    }
    return res;
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
   * A write: validate+resolve and STAGE it (nothing is persisted here). A validation failure returns
   * an { error } the model can correct from; a valid write is queued for the end-of-run confirmation
   * and the model gets back { staged: true } so it keeps going toward its closing summary.
   */
  const stageWrite = async (
    name: string,
    label: string,
    stepId: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const described = await describeWrite(name, args);
    if (!toolResultOk(described)) {
      // Bad/hallucinated args — surface as a tool error so the model can correct, no card shown.
      emit({ kind: 'tool', id: stepId, name, label, args, status: 'error', result: described, ok: false, error: toolErrorMessage(described) });
      return described as Record<string, unknown>;
    }
    const pending = described as PendingWrite;
    staged.push({ stepId, name, label, pending });
    emit({ kind: 'confirm', id: stepId, tool: name, label, summary: pending.summary, destructive: pending.destructive, status: 'awaiting' });
    return { staged: true };
  };

  /** One extra Gemini round to produce a natural closing message, with a deterministic fallback so
   * the answer is never empty even if that call fails or returns nothing. */
  const closingRound = async (instruction: string, iteration: number, fallback: string): Promise<AssistantResult> => {
    contents.push({ role: 'user', parts: [{ text: instruction }] });
    const res = await callModel(iteration + 1);
    if (!res.ok) return { ok: true, text: fallback };
    const text = res.parts.map((p) => ('text' in p ? p.text : '')).join('').trim();
    return { ok: true, text: text || fallback };
  };

  /**
   * End-of-run confirmation for every staged write: surface the model's summary above ONE card, take
   * a single decision, then execute the whole batch (or none) and close with a natural message. The
   * per-item confirm trace rows are re-emitted approved/rejected so the trace stays honest.
   */
  const confirmStaged = async (intro: string, iteration: number): Promise<AssistantResult> => {
    const rejectAll = () => {
      for (const s of staged) {
        emit({ kind: 'confirm', id: s.stepId, tool: s.name, label: s.label, summary: s.pending.summary, destructive: s.pending.destructive, status: 'rejected' });
      }
    };

    // No confirmer available, or already aborted — decline the whole batch, write nothing.
    if (!opts.onConfirm || opts.signal?.aborted) {
      rejectAll();
      return { ok: true, text: "I didn't change anything." };
    }

    // Show the model's one-sentence summary as a bubble above the single confirm card.
    if (intro) opts.onMessage?.(intro);

    const items: ConfirmItem[] = staged.map((s) => ({ id: s.stepId, label: s.label, ...s.pending }));
    const destructive = staged.some((s) => s.pending.destructive);
    let decision: ConfirmDecision = 'reject';
    try {
      decision = await opts.onConfirm({ id: newId(), items, destructive });
    } catch {
      decision = 'reject';
    }

    if (decision !== 'approve' || opts.signal?.aborted) {
      rejectAll();
      return closingRound(
        'The user declined, so nothing was changed. Briefly acknowledge that nothing was logged and offer to adjust.',
        iteration,
        "Okay — I haven't changed anything. Let me know if you'd like to adjust it."
      );
    }

    // Approved: execute each staged write in order and re-emit its trace row with the result.
    const outcomes: string[] = [];
    for (const s of staged) {
      const result = await executeWrite(s.name, s.pending.payload);
      const ok = result != null && typeof result === 'object' && !('error' in result);
      emit({ kind: 'confirm', id: s.stepId, tool: s.name, label: s.label, summary: s.pending.summary, destructive: s.pending.destructive, status: 'approved', result });
      outcomes.push(`${s.pending.summary}${ok ? '' : ' (failed)'}`);
    }

    return closingRound(
      `The changes were applied: ${outcomes.join('; ')}. Reply with a brief past-tense confirmation of what was logged.`,
      iteration,
      'Done — your changes have been logged.'
    );
  };

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const res = await callModel(i);
    if (!res.ok) return fail(res.error.kind, res.error.message, i);

    const calls = res.parts.filter(hasFunctionCall);
    // Record the model's turn (text and/or the function calls it wants) in the running history.
    contents.push({ role: 'model', parts: res.parts });

    // Keep the best plain text seen so far — used as the closing summary / an early-exit partial.
    const roundText = res.parts
      .map((p) => ('text' in p ? p.text : ''))
      .join('')
      .trim();
    if (roundText) lastText = roundText;

    if (calls.length === 0) {
      // The model is done. If it staged any writes, confirm them all at once now; otherwise this is
      // a plain answer.
      if (staged.length > 0) return confirmStaged(roundText || lastText, i);
      return { ok: true, text: roundText || lastText || "I couldn't find an answer to that." };
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
    // immediately; write tools are staged (validated but not persisted) for the single end-of-run card.
    const responseParts: GeminiPart[] = [];
    for (const c of calls) {
      // Echo the model's call id when present so parallel calls stay paired in both the trace + Gemini.
      const stepId = c.functionCall.id ?? newId();
      const name = c.functionCall.name;
      const label = toolLabel(name);
      const args = c.functionCall.args;

      const result = isWriteTool(name)
        ? await stageWrite(name, label, stepId, args)
        : await handleRead(name, label, stepId, args);

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

  // Ran out of rounds. If writes were staged but never confirmed, confirm them now rather than
  // dropping them silently; otherwise show whatever partial text we have.
  if (staged.length > 0) return confirmStaged(lastText, MAX_ROUNDS);
  return finishEarly('round_limit', `Stopped after the ${MAX_ROUNDS}-round ceiling.`, MAX_ROUNDS);
}
