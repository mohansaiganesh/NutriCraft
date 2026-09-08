/**
 * The assistant's agentic loop: send the conversation to Gemini, let it decide which
 * read-only tools to call, execute them locally against SQLite, feed the results back, and
 * repeat until the model returns a plain text answer (or we hit the iteration cap).
 */
import { callGemini } from './gemini';
import type { GeminiContent, GeminiError, GeminiPart } from './gemini';
import { runTool } from './tools';

const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are NutriCraft's built-in nutrition assistant. You answer the user's questions about THEIR OWN data — logged foods, saved meals, daily logs, macros (calories, protein, carbs, fat, fiber, sodium) and costs — using the provided tools.

Rules:
- Always call tools to get real numbers. Never guess, estimate, or invent data.
- For anything time-related ("today", "this week", "this month", "last 7 days"), call get_today FIRST to resolve the date and get ready-made ranges, then pass those dates to get_day_totals / get_range_totals.
- Nutrition and prices are stored per 100 g/ml, but the tools already return ACTUAL logged amounts and totals — use those directly.
- Costs are in the user's currency; tool results include a "currency" symbol — use it when showing money.
- Be concise, friendly and specific. Lead with the answer, round numbers sensibly, and add at most a short bit of context. If there is no data for the period, say so plainly.
- You can only READ data. You cannot log foods, create meals, or change targets/settings. If asked to do any of those, briefly explain that and point the user to the relevant screen (Foods, Meals, or Preferences).`;

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type AssistantResult = { ok: true; text: string } | { ok: false; message: string };

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

function friendlyError(err: GeminiError): string {
  switch (err.kind) {
    case 'auth':
      return `Your Gemini API key was rejected. Google no longer accepts the older keys that start with "AIza" — create a new key (an auth key, starting with "AQ.") at aistudio.google.com/apikey and paste it in Preferences → AI Assistant.\n\n(${err.message})`;
    case 'rate_limit':
      return "Gemini's free-tier rate limit was hit. Wait a minute and try again.";
    case 'network':
      return err.message;
    case 'api':
      return `Gemini had a temporary server error — please try again in a moment. If it keeps happening, pick a different model in Preferences → AI Assistant.\n\n(${err.message})`;
    default:
      return err.message || 'Something went wrong talking to Gemini.';
  }
}

export async function runAssistant(opts: {
  question: string;
  history: ChatTurn[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}): Promise<AssistantResult> {
  // Seed the conversation with prior text turns, then the new question.
  const contents: GeminiContent[] = opts.history.map((t) => ({
    role: t.role === 'user' ? 'user' : 'model',
    parts: [{ text: t.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: opts.question }] });

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await callGemini({
      contents,
      systemInstruction: SYSTEM_PROMPT,
      apiKey: opts.apiKey,
      model: opts.model,
      signal: opts.signal,
    });
    if (!res.ok) return { ok: false, message: friendlyError(res.error) };

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
      const result = await runTool(c.functionCall.name, c.functionCall.args);
      responseParts.push({
        functionResponse: {
          name: c.functionCall.name,
          response: wrapResponse(result),
          // Echo the id back so parallel calls stay paired (Gemini matches on it).
          ...(c.functionCall.id ? { id: c.functionCall.id } : {}),
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    ok: false,
    message: 'That needed too many steps to answer. Try asking something more specific.',
  };
}
