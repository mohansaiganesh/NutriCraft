/**
 * Shared vocabulary for the assistant's observability trace.
 *
 * The agent loop emits `TraceStep` snapshots as it works; the chat hook reduces them into a live
 * list; the overlay renders them. This module is the ONE piece of the assistant that stays pure and
 * React-Native-free (it imports only a type from `gemini.ts`), so the labels, error copy, and JSON
 * preview logic are all jest-testable without pulling in `db/queries` → RN.
 *
 * Transport is a single union upserted by `id`: a step is emitted first as `running`, then
 * re-emitted with the SAME id as `ok`/`error`/`done`. Consumers just replace-or-push by id.
 */
import type { GeminiErrorKind } from './gemini';

export type ToolStatus = 'running' | 'ok' | 'error';

/** A round-trip to Gemini, rendered as its own row. Token counts are set on the `done` re-emit. */
export interface ModelStep {
  kind: 'model';
  id: string;
  iteration: number;
  status: 'running' | 'done';
  inputTokens?: number; // promptTokenCount — set once the call returns (absent while running)
  outputTokens?: number; // candidatesTokenCount
}

/** A transient 5xx retry inside a single Gemini call (surfaced so the user sees the wait explained). */
export interface RetryStep {
  kind: 'retry';
  id: string;
  attempt: number;
  delayMs: number;
  status: number; // the HTTP status that triggered the retry
  settled?: boolean; // true once the callGemini call it belonged to finished (stop spinning)
}

/** One tool call: friendly label + the exact args, and (on finish) the result and pass/fail. */
export interface ToolStep {
  kind: 'tool';
  id: string;
  name: string; // raw tool name, e.g. 'get_day_totals'
  label: string; // friendly text from toolLabel()
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: unknown; // set once the tool returns
  ok?: boolean; // from toolResultOk()
  error?: string; // the { error } string when a tool fails
}

export type TraceStep = ModelStep | RetryStep | ToolStep;

export type AssistantErrorKind = GeminiErrorKind | 'iteration_limit';

// ------------------------------------------------------------------ usage totals

/** Rolled-up LLM usage across a trace: how many Gemini calls were sent and their token totals. */
export interface TraceUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Sum the model steps of a trace. A running call still counts (it has been sent); its tokens are 0. */
export function traceUsage(steps: TraceStep[]): TraceUsage {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const s of steps) {
    if (s.kind === 'model') {
      calls++;
      inputTokens += s.inputTokens ?? 0;
      outputTokens += s.outputTokens ?? 0;
    }
  }
  return { calls, inputTokens, outputTokens };
}

// ------------------------------------------------------------------ tool labels

/** Human-friendly present-tense label for each tool, so the trace reads like plain steps. */
const TOOL_LABELS: Record<string, string> = {
  get_today: 'Checking the date',
  get_targets: 'Reading your targets',
  get_day_totals: 'Adding up a day',
  list_day_logs: "Listing a day's entries",
  get_range_totals: 'Totalling a date range',
  list_meals: 'Listing your meals',
  get_meal_breakdown: 'Breaking down a meal',
  list_meals_with_totals: 'Totalling your meals',
  search_foods: 'Searching foods',
};

export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name;

// ------------------------------------------------------------------ result inspection

/** Mirrors runTool's failure contract: a plain `{ error: string }` object means the tool failed. */
export function toolResultOk(r: unknown): boolean {
  return !(r !== null && typeof r === 'object' && !Array.isArray(r) && 'error' in (r as Record<string, unknown>));
}

/** Pull the human message out of a `{ error }` tool result (undefined when it isn't one). */
export function toolErrorMessage(r: unknown): string | undefined {
  if (r !== null && typeof r === 'object' && !Array.isArray(r) && 'error' in (r as Record<string, unknown>)) {
    const e = (r as Record<string, unknown>).error;
    return typeof e === 'string' ? e : String(e);
  }
  return undefined;
}

/** Pretty JSON with a hard cap, so a big search_foods result can't blow up the UI (or memory). */
export function previewJson(v: unknown, max = 2000): string {
  let s: string;
  try {
    // `?? String(v)` covers `undefined` input, which JSON.stringify returns undefined for at runtime.
    s = JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more chars)` : s;
}

// ------------------------------------------------------------------ error copy

const ERROR_TITLES: Record<AssistantErrorKind, string> = {
  auth: 'API key rejected',
  rate_limit: 'Rate limited',
  network: 'Connection problem',
  api: 'Gemini server error',
  bad_response: 'Unreadable response',
  iteration_limit: 'Too many steps',
};

export const errorTitle = (k?: AssistantErrorKind): string => (k && ERROR_TITLES[k]) || 'Something went wrong';

/**
 * Friendly, actionable copy for each failure — plus the raw provider text as `detail` for the
 * expandable "Technical details". Every kind is handled (fixes the old `bad_response` leak).
 */
export function describeError(kind: AssistantErrorKind, raw: string): { message: string; detail?: string } {
  switch (kind) {
    case 'auth':
      return {
        message:
          'Your Gemini API key was rejected. Google no longer accepts the older keys that start with "AIza" — create a new key (an auth key, starting with "AQ.") at aistudio.google.com/apikey and paste it in Preferences → AI Assistant.',
        detail: raw || undefined,
      };
    case 'rate_limit':
      return {
        message: "Gemini's free-tier rate limit was hit. Wait a minute and try again.",
        detail: raw || undefined,
      };
    case 'network':
      // Already user-friendly (e.g. "Network request failed — check your connection.").
      return { message: raw || 'Network request failed — check your connection.' };
    case 'api':
      return {
        message:
          'Gemini had a temporary server error — please try again in a moment. If it keeps happening, pick a different model in Preferences → AI Assistant.',
        detail: raw || undefined,
      };
    case 'bad_response':
      return {
        message:
          "Gemini returned a reply the app couldn't read — it may be overloaded, or the response was blocked. Try again, or switch models in Preferences → AI Assistant.",
        detail: raw || undefined,
      };
    case 'iteration_limit':
      return {
        message: 'That needed too many steps to answer. Try asking something more specific.',
        detail: raw || undefined,
      };
  }
}
