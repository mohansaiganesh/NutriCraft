/**
 * Groq adapter for the neutral `LlmClient` contract.
 *
 * Groq exposes an OpenAI-compatible chat-completions API, so this converts the neutral conversation/
 * tool shapes (`provider.ts`) to OpenAI `messages`/`tools` and back. The user's own Groq key is sent
 * as a Bearer token per request — never bundled or synced.
 *
 * Groq caches prompts automatically (no opt-in resource like Gemini's), so there is NO `ensureCache`
 * capability; instead the cached-token count is read from `usage.prompt_tokens_details.cached_tokens`
 * and surfaced in `LlmUsage.cachedTokens` so the trace still shows a cache tag. The cache matches the
 * longest prefix of what previous requests produced, so assistant turns must be sent back exactly as
 * Groq returned them — including gpt-oss `reasoning` (kept in `providerMeta`) — or hits stop after round 1.
 *
 * Like the Google adapter, `call` never throws — every failure resolves to a discriminated error.
 */
import type {
  LlmCallOpts,
  LlmClient,
  LlmMessage,
  LlmResponsePart,
  LlmResult,
  LlmToolDecl,
  LlmUsage,
} from '../provider';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2; // extra attempts on transient 5xx
// Groq's free tier has a low tokens-per-minute cap, and a tool loop fires its rounds milliseconds apart,
// so a round often 429s with "try again in 1.2s". Prompt caching can't prevent that (the limiter
// admits on the requested size), so wait the server-given delay and retry — within these bounds.
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 10_000;

// ------------------------------------------------------------------ wire types (OpenAI-style)

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[]; reasoning?: string }
  | { role: 'tool'; tool_call_id: string; content: string };

// ------------------------------------------------------------------ neutral ⇄ OpenAI converters

/** Neutral tool declarations → OpenAI `tools`. A param-less tool still needs an object schema. */
function toOpenAiTools(tools: LlmToolDecl[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: 'object', properties: {} },
    },
  }));
}

/** Neutral messages → OpenAI `messages` (system instruction prepended by the caller). */
function toOpenAiMessages(messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      // A user turn is either plain text or a batch of tool results (one OpenAI 'tool' message each).
      const text = m.parts
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const toolResults = m.parts.filter((p): p is Extract<typeof p, { type: 'toolResult' }> => p.type === 'toolResult');
      if (toolResults.length > 0) {
        for (const r of toolResults) {
          out.push({ role: 'tool', tool_call_id: r.id ?? r.name, content: JSON.stringify(r.response) });
        }
      }
      if (text) out.push({ role: 'user', content: text });
    } else {
      // An assistant turn carries text and/or tool calls.
      const text = m.parts
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const toolCalls = m.parts
        .filter((p): p is Extract<typeof p, { type: 'toolCall' }> => p.type === 'toolCall')
        .map((p) => ({
          id: p.id ?? p.name,
          type: 'function' as const,
          function: { name: p.name, arguments: JSON.stringify(p.args ?? {}) },
        }));
      // gpt-oss returns its reasoning beside the answer; send it back verbatim so the history matches
      // the sequence Groq cached (and the model keeps its pre-tool-call reasoning within the turn).
      const reasoning = m.parts
        .map((p) => (p.type === 'toolResult' ? undefined : p.providerMeta?.reasoning))
        .find((r): r is string => typeof r === 'string');
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(reasoning ? { reasoning } : {}),
      });
    }
  }
  return out;
}

/** OpenAI `choices[0].message` → neutral response parts. Tool calls always carry their id so a later
 * round can pair the tool result back to them. */
function fromOpenAiMessage(msg: {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  reasoning?: string | null;
}): LlmResponsePart[] {
  const out: LlmResponsePart[] = [];
  if (typeof msg.content === 'string' && msg.content) out.push({ type: 'text', text: msg.content });
  for (const tc of msg.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
    } catch {
      args = {}; // malformed args JSON — surface an empty object so the tool layer reports a clean error
    }
    out.push({ type: 'toolCall', id: tc.id, name: tc.function.name, args });
  }
  // Keep the reasoning once, on the first part, so `toOpenAiMessages` can re-emit it unchanged.
  if (typeof msg.reasoning === 'string' && msg.reasoning && out.length > 0) {
    out[0] = { ...out[0], providerMeta: { reasoning: msg.reasoning } };
  }
  return out;
}

// ------------------------------------------------------------------ helpers

/**
 * How long Groq asks us to wait after a 429, in ms — from the `retry-after` header (seconds), else the
 * "try again in 1.25s" / "in 850ms" hint in the message. `null` when neither is present. Exported for tests.
 */
export function rateLimitDelayMs(retryAfter: string | null, message: string): number | null {
  const header = retryAfter != null ? Number(retryAfter) : NaN;
  if (Number.isFinite(header) && header >= 0) return header * 1000;
  const m = /try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)(ms|s)\b/i.exec(message);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const value = Number(m[2]);
  return minutes * 60_000 + (m[3].toLowerCase() === 'ms' ? value : value * 1000);
}

function backoff(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

// ------------------------------------------------------------------ the client

async function call(opts: LlmCallOpts): Promise<LlmResult> {
  const messages: OpenAiMessage[] = [
    { role: 'system', content: opts.systemInstruction },
    ...toOpenAiMessages(opts.messages),
  ];

  // Kept byte-identical and first across rounds (system message, then `tools`, constant `tool_choice`)
  // so Groq's automatic prefix cache can hit — don't reorder or inject per-round data ahead of it.
  const tools = toOpenAiTools(opts.tools);
  let rateLimitRetries = 0;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages,
          tools,
          tool_choice: 'auto',
        }),
        signal: controller.signal,
      });
    } catch {
      const aborted = opts.signal?.aborted;
      return {
        ok: false,
        error: {
          kind: 'network',
          message: aborted ? 'Request cancelled.' : 'Network request failed — check your connection.',
        },
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      try {
        const errBody = await res.json();
        message = errBody?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 401 || res.status === 403) return { ok: false, error: { kind: 'auth', message } };
      if (res.status === 400 || res.status === 404 || res.status === 422)
        return { ok: false, error: { kind: 'api', message } };
      if (res.status === 429) {
        const waitMs = rateLimitDelayMs(res.headers?.get?.('retry-after') ?? null, message);
        if (
          waitMs != null &&
          waitMs <= MAX_RATE_LIMIT_WAIT_MS &&
          rateLimitRetries < MAX_RATE_LIMIT_RETRIES &&
          !opts.signal?.aborted
        ) {
          rateLimitRetries++;
          attempt--; // a rate-limit wait doesn't spend the 5xx retry budget
          const delayMs = waitMs + 250; // small margin so the window has actually rolled over
          try {
            opts.onRetry?.({ attempt: rateLimitRetries, delayMs, status: 429 });
          } catch {
            /* a throwing observer must never break the retry path */
          }
          try {
            await backoff(delayMs, opts.signal);
            continue;
          } catch {
            return { ok: false, error: { kind: 'network', message: 'Request cancelled.' } };
          }
        }
        return { ok: false, error: { kind: 'rate_limit', message } };
      }
      if (res.status >= 500 && attempt < MAX_RETRIES && !opts.signal?.aborted) {
        const delayMs = 500 * 2 ** attempt + Math.random() * 250;
        try {
          opts.onRetry?.({ attempt: attempt + 1, delayMs, status: res.status });
        } catch {
          /* a throwing observer must never break the retry path */
        }
        try {
          await backoff(delayMs, opts.signal);
          continue;
        } catch {
          return { ok: false, error: { kind: 'network', message: 'Request cancelled.' } };
        }
      }
      return { ok: false, error: { kind: 'api', message } };
    }

    try {
      const data = await res.json();
      const choice = data?.choices?.[0];
      const msg = choice?.message;
      if (!msg) {
        return { ok: false, error: { kind: 'bad_response', message: 'Empty response from Groq.' } };
      }
      const parts = fromOpenAiMessage(msg);
      if (parts.length === 0) {
        return { ok: false, error: { kind: 'bad_response', message: 'No answer returned by Groq.' } };
      }
      const u = data?.usage;
      if (__DEV__) console.log('[assistant] groq usage', { usage: u, x_groq: data?.x_groq?.usage });
      const usage: LlmUsage | undefined = u
        ? {
            inputTokens: u.prompt_tokens ?? 0,
            outputTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
            // Groq reports the cached portion of the prompt here on a cache hit; absent on a miss. Some
            // responses carry it only under `x_groq.usage`, so fall back to that.
            cachedTokens:
              u.prompt_tokens_details?.cached_tokens ?? data?.x_groq?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          }
        : undefined;
      return { ok: true, parts, usage, finishReason: choice?.finish_reason };
    } catch {
      return { ok: false, error: { kind: 'bad_response', message: 'Could not read the Groq response.' } };
    }
  }
}

export const groqClient: LlmClient = {
  provider: 'groq',
  call,
  // No ensureCache/invalidateCache — Groq caches automatically (cachingMode 'auto').
};
