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
import type { LlmErrorKind, LlmMessage, LlmProvider, LlmResponsePart } from './provider';
import { PROVIDER_LABEL } from './models';

export type ToolStatus = 'running' | 'ok' | 'error';

/**
 * The exact request sent to the model for one round, snapshotted at call time so the persisted trace
 * can show "what was passed to the model" end-to-end, in the neutral (provider-agnostic) shape.
 * `contents` is a DEEP COPY (the agent mutates the running conversation across rounds).
 * `generationConfig` is whatever sampling config was sent — currently `null` (the client sends none),
 * which keeps the trace honest that defaults were used.
 */
export interface LlmRequestSnapshot {
  systemInstruction: string;
  contents: LlmMessage[];
  toolNames: string[];
  generationConfig: Record<string, unknown> | null;
  /** The explicit-cache resource this round referenced (systemInstruction + tools live there), or
   * null when the full prompt was sent inline. Lets the trace show whether explicit caching applied. */
  cachedContent: string | null;
  /** Fingerprint of the cacheable prefix (system instruction + full tool declarations). Identical across
   * rounds and questions ⇒ the prefix is byte-stable, so a missing cache hit is on the provider's side. */
  prefixHash?: string;
}

/**
 * A round-trip to the model, rendered as its own row. Token counts + response are set on the terminal
 * re-emit; `request`, `model`, `startedAt` are carried on every emit so the upsert-by-id reducer
 * never loses them. A failed call terminates as `status: 'error'` (not left spinning as `running`).
 */
export interface ModelStep {
  kind: 'model';
  id: string;
  iteration: number;
  status: 'running' | 'done' | 'error';
  model?: string; // the model id this call used
  request?: LlmRequestSnapshot; // the exact payload sent (set from the first emit onward)
  response?: LlmResponsePart[]; // neutral response parts — set on a successful `done`
  finishReason?: string; // candidates[0].finishReason when reported
  inputTokens?: number; // promptTokenCount — set once the call returns (absent while running)
  outputTokens?: number; // candidatesTokenCount
  cachedTokens?: number; // cachedContentTokenCount — the reused portion of inputTokens (implicit or explicit)
  errorKind?: AssistantErrorKind; // set when status === 'error'
  errorMessage?: string; // raw provider message when status === 'error'
  startedAt?: string; // ISO timestamp when the call was sent
  durationMs?: number; // wall-clock time of the round-trip, set on the terminal emit
}

/** A retry inside a single model call — a transient 5xx, or a short rate-limit (429) wait — surfaced so
 * the user sees the wait explained. */
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
  startedAt?: string; // ISO timestamp when the tool began
  durationMs?: number; // wall-clock time of the tool execution, set on the terminal emit
}

/**
 * A write the model wants to perform, paused until the user taps Confirm/Cancel in the chat.
 * Emitted `awaiting` when proposed, re-emitted (same id) as `approved`/`rejected` once the user
 * decides — so the activity trace stays honest about what was actually written.
 */
export interface ConfirmStep {
  kind: 'confirm';
  id: string;
  tool: string; // raw write-tool name, e.g. 'log_food'
  label: string; // friendly text from toolLabel()
  summary: string; // human-readable operation shown on the card and the trace row
  destructive?: boolean; // a delete — rendered with the red treatment
  status: 'awaiting' | 'approved' | 'rejected';
  result?: unknown; // set once the mutation runs after approval
  startedAt?: string; // ISO timestamp when the write was proposed
  durationMs?: number; // wall-clock time from proposal to settled, set on the terminal emit
}

export type TraceStep = ModelStep | RetryStep | ToolStep | ConfirmStep;

export type AssistantErrorKind = LlmErrorKind | 'iteration_limit';

// ------------------------------------------------------------------ adaptive loop helpers

/**
 * Deterministic key for a tool call so the agent loop can spot when the model repeats itself
 * (same tool, same args) regardless of the order the arg keys arrive in. Used to detect a stalled
 * run and to bound cumulative work — see `runAssistant` in `agent.ts`.
 */
export function callSignature(name: string, args: Record<string, unknown> | undefined): string {
  const a = args ?? {};
  const body = Object.keys(a)
    .sort()
    .map((k) => `${k}=${JSON.stringify(a[k])}`)
    .join('&');
  return `${name}(${body})`;
}

/** Why the agent loop stopped before the model returned a plain-text answer on its own. */
export type StopReasonKind = 'stalled' | 'tool_budget' | 'round_limit';

/**
 * Carried on a SUCCESSFUL result when the loop exited early but the model had already produced usable
 * text — the answer is shown with this note so the user knows it may be incomplete.
 */
export interface StopReason {
  kind: StopReasonKind;
  message: string; // friendly, user-facing note shown under the partial answer
  detail: string; // technical text (which limit was hit) for the expandable section
}

/** Friendly + technical copy for each early-stop reason (mirrors `describeError`). */
export function describeStop(kind: StopReasonKind, detail: string): StopReason {
  const message =
    'I stopped early — this needed too many steps, so the answer above may be incomplete. Try asking something more specific.';
  return { kind, message, detail };
}

// ------------------------------------------------------------------ write confirmation message

/** One executed write's outcome: its past-tense phrase (from PendingWrite.donePhrase) and whether it
 * actually persisted. */
export interface WriteOutcome {
  phrase: string;
  ok: boolean;
}

/**
 * Build Nico's post-confirm message DETERMINISTICALLY from the writes that ran, so the numbers always
 * match what was saved (the small model would otherwise recite its own stale proposal — see
 * `agent.ts`). Succeeded writes read as a sentence (one) or a bulleted list (many); any failures are
 * called out plainly.
 */
export function writeDoneMessage(outcomes: WriteOutcome[]): string {
  const done = outcomes.filter((o) => o.ok).map((o) => o.phrase);
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.phrase);

  const list = (phrases: string[]) =>
    phrases.length === 1 ? phrases[0] : phrases.map((p) => `- ${p}`).join('\n');

  if (done.length === 0) {
    // Nothing persisted — lead with the failure so the user isn't told anything was saved.
    return failed.length
      ? `I couldn't save your changes:\n${list(failed)}`
      : "I didn't change anything.";
  }

  const savedLine = done.length === 1 ? `${done[0]}.` : `Here's what I did as requested:\n${list(done)}`;
  return failed.length ? `${savedLine}\n\nI couldn't save:\n${list(failed)}` : savedLine;
}

// ------------------------------------------------------------------ usage totals

/** Rolled-up LLM usage across a trace: how many Gemini calls were sent and their token totals. */
export interface TraceUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/** Sum the model steps of a trace. A running call still counts (it has been sent); its tokens are 0. */
export function traceUsage(steps: TraceStep[]): TraceUsage {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  for (const s of steps) {
    if (s.kind === 'model') {
      calls++;
      inputTokens += s.inputTokens ?? 0;
      outputTokens += s.outputTokens ?? 0;
      cachedTokens += s.cachedTokens ?? 0;
    }
  }
  return { calls, inputTokens, outputTokens, cachedTokens };
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
  open_food_catalog: 'Opening your foods',
  // Write tools (each runs only after the user confirms the card).
  log_food: 'Logging a food',
  update_log_entry: 'Editing a log entry',
  remove_log_entry: 'Removing a log entry',
  apply_meal_to_day: 'Adding a meal to a day',
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
  api: 'Model server error',
  bad_response: 'Unreadable response',
  iteration_limit: 'Too many steps',
};

export const errorTitle = (k?: AssistantErrorKind): string => (k && ERROR_TITLES[k]) || 'Something went wrong';

/** Provider-specific guidance appended to the generic "key rejected" message, so the copy stays
 * accurate as providers are added. Keep each hint to one actionable sentence. */
const PROVIDER_KEY_HINT: Record<LlmProvider, string> = {
  google:
    'Google no longer accepts the older keys that start with "AIza" — create a new key (an auth key, starting with "AQ.") at aistudio.google.com/apikey.',
  groq: 'Create a key at console.groq.com/keys.',
};

/**
 * Friendly, actionable copy for each failure — plus the raw provider text as `detail` for the
 * expandable "Technical details". Every kind is handled (fixes the old `bad_response` leak). Copy is
 * provider-neutral; pass the active `provider` to tailor the key-creation hint on an auth failure.
 */
export function describeError(
  kind: AssistantErrorKind,
  raw: string,
  provider?: LlmProvider,
): { message: string; detail?: string } {
  const name = provider ? PROVIDER_LABEL[provider] : 'AI';
  switch (kind) {
    case 'auth': {
      const hint = provider ? ` ${PROVIDER_KEY_HINT[provider]}` : '';
      return {
        message: `Your ${name} API key was rejected.${hint} Paste a valid key in Preferences → AI Assistant.`,
        detail: raw || undefined,
      };
    }
    case 'rate_limit':
      return {
        message: `${name}'s rate limit was hit. Wait a minute and try again.`,
        detail: raw || undefined,
      };
    case 'network':
      // Already user-friendly (e.g. "Network request failed — check your connection.").
      return { message: raw || 'Network request failed — check your connection.' };
    case 'api':
      return {
        message: `${name} had a temporary server error — please try again in a moment. If it keeps happening, pick a different model in Preferences → AI Assistant.`,
        detail: raw || undefined,
      };
    case 'bad_response':
      return {
        message: `${name} returned a reply the app couldn't read — it may be overloaded, or the response was blocked. Try again, or switch models in Preferences → AI Assistant.`,
        detail: raw || undefined,
      };
    case 'iteration_limit':
      return {
        message: 'That needed too many steps to answer. Try asking something more specific.',
        detail: raw || undefined,
      };
  }
}
