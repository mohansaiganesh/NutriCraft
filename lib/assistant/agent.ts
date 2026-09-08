/**
 * The assistant's agentic loop: send the conversation to Gemini, let it decide which
 * read-only tools to call, execute them locally against SQLite, feed the results back, and
 * repeat until the model returns a plain text answer (or we hit the iteration cap).
 */
import { callGemini } from './gemini';
import type { GeminiContent, GeminiPart } from './gemini';
import { runTool } from './tools';
import { newId } from '@/lib/id';
import { describeError, toolErrorMessage, toolLabel, toolResultOk } from './events';
import type { AssistantErrorKind, RetryStep, TraceStep } from './events';

const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are NutriCraft's built-in nutrition assistant. You answer the user's questions about THEIR OWN data — logged foods, saved meals, daily logs, macros (calories, protein, carbs, fat, fiber, sodium) and costs — using the provided tools.

Rules:
- Always call tools to get real numbers. Never guess, estimate, or invent data.
- For anything time-related ("today", "this week", "this month", "last 7 days"), call get_today FIRST to resolve the date and get ready-made ranges, then pass those dates to get_day_totals / get_range_totals.
- Nutrition and prices are stored per 100 g/ml, but the tools already return ACTUAL logged amounts and totals — use those directly.
- Costs are in the user's currency; tool results include a "currency" symbol — use it when showing money.
- Be concise, friendly and specific. Lead with the answer, round numbers sensibly, and add at most a short bit of context. If there is no data for the period, say so plainly.
- Format replies as short plain prose. You may use **bold** for key numbers and simple "- " bullet lists when listing several items — keep formatting minimal. Do not use tables, headings, code blocks, or links.
- You can only READ data. You cannot log foods, create meals, or change targets/settings. If asked to do any of those, briefly explain that and point the user to the relevant screen (Foods, Meals, or Preferences).`;

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

export type AssistantResult = { ok: true; text: string } | { ok: false; error: AssistantError };

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

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const modelStepId = newId();
    emit({ kind: 'model', id: modelStepId, iteration: i, status: 'running' });

    // Track the retries emitted during this call so we can settle them (stop their spinner) the
    // instant the call resolves — whether it ultimately succeeded or failed.
    const retries: RetryStep[] = [];
    const res = await callGemini({
      contents,
      systemInstruction: SYSTEM_PROMPT,
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

    if (calls.length === 0) {
      const text = res.parts
        .map((p) => ('text' in p ? p.text : ''))
        .join('')
        .trim();
      return { ok: true, text: text || "I couldn't find an answer to that." };
    }

    // Execute each requested tool locally and return every result in one turn.
    const responseParts: GeminiPart[] = [];
    for (const c of calls) {
      // Echo the model's call id when present so parallel calls stay paired in both the trace + Gemini.
      const stepId = c.functionCall.id ?? newId();
      const label = toolLabel(c.functionCall.name);
      emit({
        kind: 'tool',
        id: stepId,
        name: c.functionCall.name,
        label,
        args: c.functionCall.args,
        status: 'running',
      });

      const result = await runTool(c.functionCall.name, c.functionCall.args);
      const ok = toolResultOk(result);
      emit({
        kind: 'tool',
        id: stepId,
        name: c.functionCall.name,
        label,
        args: c.functionCall.args,
        status: ok ? 'ok' : 'error',
        result,
        ok,
        error: ok ? undefined : toolErrorMessage(result),
      });

      responseParts.push({
        functionResponse: {
          name: c.functionCall.name,
          response: wrapResponse(result),
          ...(c.functionCall.id ? { id: c.functionCall.id } : {}),
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return fail('iteration_limit', `Stopped after ${MAX_TOOL_ITERATIONS} tool rounds.`, MAX_TOOL_ITERATIONS);
}
