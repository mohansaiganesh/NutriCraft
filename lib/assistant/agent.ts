/**
 * The assistant's agentic loop: send the conversation to Gemini, let it decide which
 * read-only tools to call, execute them locally against SQLite, feed the results back, and
 * repeat until the model returns a plain text answer (or we hit the iteration cap).
 */
import { getClient } from './clients';
import { providerForModel } from './models';
import type { LlmMessage, LlmProvider, LlmResponsePart, LlmResult } from './provider';
import { ALL_FUNCTION_DECLARATIONS, describeWrite, executeWrite, isWriteTool, NAV_TOOLS, reviseWrite, runTool } from './tools';
import type { PendingWrite, WriteEdit } from './tools';
import { hash } from './hash';
import { newId } from '@/lib/id';
import { todayISO } from '@/lib/format';
import { callSignature, describeError, describeStop, toolErrorMessage, toolLabel, toolResultOk, writeDoneMessage } from './events';
import type { AssistantErrorKind, LlmRequestSnapshot, RetryStep, StopReason, StopReasonKind, TraceStep } from './events';

// The loop adapts to observed progress rather than a single flat cap. These are safety BOUNDS, not
// the normal stop — most questions finish in 1–3 rounds when the model returns plain text.
const MAX_ROUNDS = 12; // absolute ceiling on Gemini round-trips (was a flat 6)
const MAX_TOOL_CALLS = 16; // cumulative tool executions across the whole run (rounds can batch calls)
const MAX_STALLED_ROUNDS = 1; // consecutive rounds with NO new tool call before we bail

/** The system prompt, stamped with the real current date so the model never guesses the year. The date
 * is the only text that changes (daily), so it goes LAST: providers prefix-cache from the start, and a
 * dynamic line near the top would invalidate everything after it. */
function buildSystemPrompt(): string {
  const today = todayISO();
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  const year = today.slice(0, 4);
  return `You are NutriCraft's built-in nutrition assistant. You answer the user's questions about THEIR OWN data — logged foods, saved meals, daily logs, macros (calories, protein, carbs, fat, fiber, sodium) and costs — using the provided tools.

Rules:
- Always call tools to get real numbers. Never guess, estimate, or invent data.
- For anything time-related ("today", "this week", "this month", "last 7 days"), call get_today FIRST to resolve the date and get ready-made ranges, then pass those dates to get_day_totals / get_range_totals.
- When the user names a date without a year (e.g. "Jan 5th"), assume the current year unless they clearly mean otherwise.
- Nutrition and prices are stored per 100 g/ml, but the tools already return ACTUAL logged amounts and totals — use those directly.
- Costs are in the user's currency; tool results include a "currency" symbol — use it when showing money.
- Be concise, friendly and specific. Lead with the answer, round numbers sensibly, and add at most a short bit of context. If there is no data for the period, say so plainly.
- Format replies as short plain prose. You may use **bold** for key numbers and simple "- " bullet lists when listing several items — keep formatting minimal. Do not use tables, headings, code blocks, or links.
- You can log foods and add saved meals to a day using the write tools (log_food, update_log_entry, remove_log_entry, apply_meal_to_day). To log a specific food you must first find it with search_foods and use its id; to edit or remove an entry, first find it with list_day_logs and use its logId.
- search_foods returns "total" (the true number of matching foods) and "truncated"; when saying how many foods the user has, use "total", never the count you were shown, and if truncated is true, say there are more and suggest opening the catalog. When the user wants to SEE or BROWSE their whole food list (not a specific question), call open_food_catalog: it returns the total to state, and the app shows a tappable button that opens the Foods screen — so tell them the count and that they can open their catalog, but do NOT claim you opened it or navigated anywhere yourself.
- NEVER invent the details of a log. If the user didn't say HOW MUCH they ate (the grams/ml amount), ask them for it in one short plain-text question and do NOT call the write tool yet. You do NOT need to ask which meal — leave mealType off the tool call when they didn't say, and the app will ask them to pick. If the day isn't given, default to today. (Asking for a missing FACT like the amount is expected; it is NOT the same as asking permission to proceed, which you still must never do — see the next rule.)
- Write tools do NOT take effect immediately. Each one returns { staged: true }, meaning the change is QUEUED — the app shows the user ONE confirmation covering ALL queued changes at the very end. So NEVER ask the user to confirm or approve a staged change in prose (no "please confirm", no "let me know if you'd like to proceed"), and NEVER claim a change is done, logged, changed, or removed while you are still staging.
- Propose every change the user asked for (call the matching write tool once per change; you may include several in a single turn). When every requested change is staged, STOP calling tools and reply with ONE short present-tense sentence naming everything you are about to log (e.g. "I'll add 45 g of dates, 100 g of rice and 150 g of chicken."). Only name the meal in that sentence if the user actually told you which one. When you are then told the changes were applied, reply with a brief PAST-TENSE confirmation of what was logged (e.g. "Added dates, rice and chicken."). If you are told the user declined, say nothing was changed and offer to adjust — do not silently retry.
- You cannot create or edit foods, create or rename meals or their items, or change targets/settings. If asked, briefly say so and point the user to the relevant screen (Foods, Meals, or Preferences).

Context:
Today's date is ${weekday}, ${today}. The current year is ${year}.`;
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

/** A screen the app should offer to open once the answer is shown — surfaced as a tappable button
 * in the reply (see NAV_TOOLS in tools.ts). Navigation is a deterministic app action, not the
 * model's prose. */
export interface NavTarget {
  pathname: string;
  label: string;
}

export type AssistantResult =
  | { ok: true; text: string; stoppedEarly?: StopReason; navigation?: NavTarget } // stoppedEarly set on an early exit that still had partial text
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
/**
 * The user's whole-batch decision. On 'approve', `edits` optionally carries per-item changes the
 * user made in the card — a new grams amount and/or a picked meal, keyed by the confirm-step id —
 * re-validated by the agent before use.
 */
export type ConfirmDecision =
  | { kind: 'approve'; edits?: Record<string, WriteEdit> }
  | { kind: 'reject' };

const isToolCall = (p: LlmResponsePart): p is Extract<LlmResponsePart, { type: 'toolCall' }> =>
  p.type === 'toolCall';

/** Tool responses must be a JSON object; wrap arrays/scalars. */
function wrapResponse(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : { result: v };
}

/** Build the structured error, logging it in dev so failures are visible in the Metro console. The
 * provider tailors the copy (e.g. which key to create on an auth failure). */
function fail(kind: AssistantErrorKind, raw: string, iteration: number, provider?: LlmProvider): AssistantResult {
  const { message, detail } = describeError(kind, raw, provider);
  const error: AssistantError = { kind, message, detail, iteration };
  if (__DEV__) console.warn('[assistant] error', error);
  return { ok: false, error };
}

export async function runAssistant(opts: {
  question: string;
  history: ChatTurn[];
  apiKey: string;
  model: string;
  /** When true, try to reference an explicit `cachedContents` resource for the stable prompt prefix
   * (falls back to the full-prompt/implicit path if the key/model can't support it). */
  explicitCache?: boolean;
  signal?: AbortSignal;
  /** Observes the run as it happens — one snapshot per step, re-emitted (same id) as it transitions. */
  onEvent?: (step: TraceStep) => void;
  /**
   * Gate for every write the model proposes. The loop pauses here until it resolves 'approve' or
   * 'reject'; a write NEVER runs without an 'approve'. Omit it and all writes are auto-rejected.
   */
  onConfirm?: (req: ConfirmRequest) => Promise<ConfirmDecision>;
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
  const contents: LlmMessage[] = opts.history.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    parts: [{ type: 'text', text: t.text }],
  }));
  contents.push({ role: 'user', parts: [{ type: 'text', text: opts.question }] });

  // Built once per run — the date is stable across the loop's iterations.
  const systemPrompt = buildSystemPrompt();
  // Fingerprint of everything a provider can prefix-cache, recorded on every round so the trace proves
  // the prefix stays byte-identical.
  const prefixHash = hash(systemPrompt + JSON.stringify(ALL_FUNCTION_DECLARATIONS));

  // The provider + adapter for the chosen model, resolved once per run (provider is fixed for a run).
  const provider = providerForModel(opts.model);
  const client = getClient(provider);

  // Adaptive-budget state, tracked across rounds.
  const seen = new Set<string>(); // signatures of tool calls already executed (repeat = no progress)
  let toolCallsUsed = 0; // cumulative tool executions this run
  let stalledRounds = 0; // consecutive rounds that requested only already-seen calls
  let lastText = ''; // best plain text the model has produced so far (shown if we exit early)
  let navigationIntent: NavTarget | undefined; // set when a NAV_TOOLS read runs → button in the reply

  // Writes proposed this run. They are NOT executed inline: each is validated + staged here, and the
  // whole batch is confirmed ONCE at the end (see confirmStaged) — so the user sees a single card no
  // matter how the model split the write calls across turns.
  const staged: { stepId: string; name: string; label: string; pending: PendingWrite; startedAt: string }[] = [];

  /**
   * Exit the loop early. If the model has already produced usable text, return it as a successful
   * answer tagged with a "stopped early" note; otherwise fall back to the error card (today's
   * behavior when there's nothing usable to show).
   */
  const finishEarly = (kind: StopReasonKind, detail: string, iteration: number): AssistantResult => {
    if (__DEV__) console.warn('[assistant] stopped early', { kind, detail, iteration });
    if (lastText) return { ok: true, text: lastText, stoppedEarly: describeStop(kind, detail), navigation: navigationIntent };
    return fail('iteration_limit', detail, iteration);
  };

  /** One Gemini round-trip with its trace rows (model running→done/error + any retries). Shared by the
   * main loop and the single closing round after a confirmation. The request is snapshotted at call
   * time (deep copy — `contents` keeps growing) and carried on every emit so the persisted trace shows
   * exactly what was sent to the model. */
  const callModel = async (iteration: number): Promise<LlmResult> => {
    const modelStepId = newId();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    // Explicit caching is opt-in AND a provider capability: only attempt it when the user enabled it
    // and this provider exposes ensureCache (Gemini). It's best-effort — a free-tier / sub-floor key
    // returns null, so we send the full prompt. Auto-cache providers (Groq) need no resource; their
    // caching is server-side and shows up in usage.cachedTokens.
    const cacheName =
      opts.explicitCache && client.ensureCache
        ? await client.ensureCache({
            apiKey: opts.apiKey,
            model: opts.model,
            systemInstruction: systemPrompt,
            tools: ALL_FUNCTION_DECLARATIONS,
          })
        : null;
    const request: LlmRequestSnapshot = {
      systemInstruction: systemPrompt,
      contents: JSON.parse(JSON.stringify(contents)) as LlmMessage[],
      toolNames: ALL_FUNCTION_DECLARATIONS.map((d) => d.name),
      generationConfig: null, // the client currently sends no sampling config — recorded as-is.
      cachedContent: cacheName,
      prefixHash,
    };
    const base = { kind: 'model', id: modelStepId, iteration, model: opts.model, request, startedAt } as const;
    emit({ ...base, status: 'running' });
    const retries: RetryStep[] = [];
    const onRetry = (info: { attempt: number; delayMs: number; status: number }) => {
      const step: RetryStep = { kind: 'retry', id: newId(), ...info };
      retries.push(step);
      emit(step);
    };
    let res = await client.call({
      messages: contents,
      systemInstruction: systemPrompt,
      tools: ALL_FUNCTION_DECLARATIONS,
      apiKey: opts.apiKey,
      model: opts.model,
      cachedContent: cacheName ?? undefined,
      signal: opts.signal,
      onRetry,
    });
    // The cache resource expired between rounds — drop it and retry once with the full prompt so the
    // turn still succeeds (next round re-establishes a fresh cache).
    if (!res.ok && res.error.cacheInvalid && cacheName) {
      client.invalidateCache?.();
      res = await client.call({
        messages: contents,
        systemInstruction: systemPrompt,
        tools: ALL_FUNCTION_DECLARATIONS,
        apiKey: opts.apiKey,
        model: opts.model,
        signal: opts.signal,
        onRetry,
      });
    }
    for (const r of retries) emit({ ...r, settled: true });
    const durationMs = Date.now() - startMs;
    if (res.ok) {
      emit({
        ...base,
        status: 'done',
        response: res.parts,
        finishReason: res.finishReason,
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
        cachedTokens: res.usage?.cachedTokens,
        durationMs,
      });
    } else {
      // Terminal failure — record WHICH call died and why instead of leaving it spinning as running.
      emit({ ...base, status: 'error', errorKind: res.error.kind, errorMessage: res.error.message, durationMs });
    }
    return res;
  };

  /** Run a read tool immediately, emitting its running→ok/error trace row. */
  const handleRead = async (name: string, label: string, stepId: string, args: Record<string, unknown>) => {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    emit({ kind: 'tool', id: stepId, name, label, args, status: 'running', startedAt });
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
      startedAt,
      durationMs: Date.now() - startMs,
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
    const startedAt = new Date().toISOString();
    const described = await describeWrite(name, args);
    if (!toolResultOk(described)) {
      // Bad/hallucinated args — surface as a tool error so the model can correct, no card shown.
      emit({ kind: 'tool', id: stepId, name, label, args, status: 'error', result: described, ok: false, error: toolErrorMessage(described), startedAt });
      return described as Record<string, unknown>;
    }
    const pending = described as PendingWrite;
    staged.push({ stepId, name, label, pending, startedAt });
    emit({ kind: 'confirm', id: stepId, tool: name, label, summary: pending.summary, destructive: pending.destructive, status: 'awaiting', startedAt });
    return { staged: true };
  };

  /**
   * End-of-run confirmation for every staged write: show ONE card, take a single decision, then
   * execute the whole batch (or none) and close with a DETERMINISTIC message built from the writes
   * that actually ran. The per-item confirm trace rows are re-emitted approved/rejected so the trace
   * stays honest. No extra model round: the closing text is built from each write's donePhrase, so the
   * numbers can never drift from what was saved (the small model would otherwise recite its own stale
   * proposal).
   */
  const confirmStaged = async (): Promise<AssistantResult> => {
    const sinceStart = (startedAt: string) => Date.now() - Date.parse(startedAt);
    const rejectAll = () => {
      for (const s of staged) {
        emit({ kind: 'confirm', id: s.stepId, tool: s.name, label: s.label, summary: s.pending.summary, destructive: s.pending.destructive, status: 'rejected', startedAt: s.startedAt, durationMs: sinceStart(s.startedAt) });
      }
    };

    // No confirmer available, or already aborted — decline the whole batch, write nothing.
    if (!opts.onConfirm || opts.signal?.aborted) {
      rejectAll();
      return { ok: true, text: "I didn't change anything." };
    }

    const items: ConfirmItem[] = staged.map((s) => ({ id: s.stepId, label: s.label, ...s.pending }));
    const destructive = staged.some((s) => s.pending.destructive);
    let decision: ConfirmDecision = { kind: 'reject' };
    try {
      decision = await opts.onConfirm({ id: newId(), items, destructive });
    } catch {
      decision = { kind: 'reject' };
    }

    if (decision.kind !== 'approve' || opts.signal?.aborted) {
      rejectAll();
      return { ok: true, text: "Okay — I haven't changed anything. Let me know if you'd like to adjust it." };
    }

    // Apply any edits the user made in the card (grams and/or the picked meal) BEFORE executing, so
    // the trace row, the executed payload, and the outcome summary all reflect the final choices.
    // Re-validated via reviseWrite; a bad revise keeps the original staged write (the UI blocks
    // invalid input, so this is a guard).
    const edits = decision.edits ?? {};
    for (const s of staged) {
      const edit = edits[s.stepId];
      if (edit == null || (edit.grams == null && edit.mealType == null)) continue;
      const revised = await reviseWrite(s.name, s.pending.payload, edit);
      if (toolResultOk(revised)) s.pending = revised as PendingWrite;
    }

    // Approved: execute each staged write in order and re-emit its trace row with the result. The
    // closing message is built deterministically from each write's past-tense donePhrase (already
    // rebuilt above if the user edited it), so it always matches what was saved.
    const outcomes: { phrase: string; ok: boolean }[] = [];
    for (const s of staged) {
      const result = await executeWrite(s.name, s.pending.payload);
      const ok = result != null && typeof result === 'object' && !('error' in result);
      emit({ kind: 'confirm', id: s.stepId, tool: s.name, label: s.label, summary: s.pending.summary, destructive: s.pending.destructive, status: 'approved', result, startedAt: s.startedAt, durationMs: sinceStart(s.startedAt) });
      outcomes.push({ phrase: s.pending.donePhrase, ok });
    }

    return { ok: true, text: writeDoneMessage(outcomes) };
  };

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const res = await callModel(i);
    if (!res.ok) return fail(res.error.kind, res.error.message, i, provider);

    const calls = res.parts.filter(isToolCall);
    // Record the model's turn (text and/or the tool calls it wants) in the running history.
    contents.push({ role: 'assistant', parts: res.parts });

    // Keep the best plain text seen so far — used as the closing summary / an early-exit partial.
    const roundText = res.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
    if (roundText) lastText = roundText;

    if (calls.length === 0) {
      // The model is done. If it staged any writes, confirm them all at once now; otherwise this is
      // a plain answer.
      if (staged.length > 0) return confirmStaged();
      return { ok: true, text: roundText || lastText || "I couldn't find an answer to that.", navigation: navigationIntent };
    }

    // Stall detection: if EVERY call this round repeats one we already ran, the model is looping and
    // making no new progress. Tolerate MAX_STALLED_ROUNDS such rounds, then bail.
    const signatures = calls.map((c) => callSignature(c.name, c.args));
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
    const responseParts: LlmMessage['parts'] = [];
    for (const c of calls) {
      // Echo the model's call id when present so parallel calls stay paired in the trace + provider.
      const stepId = c.id ?? newId();
      const name = c.name;
      const label = toolLabel(name);
      const args = c.args;

      const result = isWriteTool(name)
        ? await stageWrite(name, label, stepId, args)
        : await handleRead(name, label, stepId, args);

      // A read tool may also request a navigation (e.g. open_food_catalog) — thread its target to
      // the UI, but only if it actually succeeded. NAV_TOOLS?.[] guards against a test mock that
      // omits the export.
      if (!isWriteTool(name) && toolResultOk(result) && NAV_TOOLS?.[name]) {
        navigationIntent = NAV_TOOLS[name];
      }

      responseParts.push({
        type: 'toolResult',
        name,
        response: wrapResponse(result),
        ...(c.id ? { id: c.id } : {}),
      });
    }
    // Record what we just executed so repeats register as no-progress, and spend the work budget.
    for (const s of signatures) seen.add(s);
    toolCallsUsed += calls.length;
    contents.push({ role: 'user', parts: responseParts });
  }

  // Ran out of rounds. If writes were staged but never confirmed, confirm them now rather than
  // dropping them silently; otherwise show whatever partial text we have.
  if (staged.length > 0) return confirmStaged();
  return finishEarly('round_limit', `Stopped after the ${MAX_ROUNDS}-round ceiling.`, MAX_ROUNDS);
}
