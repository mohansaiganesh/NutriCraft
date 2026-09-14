/**
 * The provider adapters' neutral ⇄ wire conversion, exercised through the public `call()` by mocking
 * `fetch` and inspecting the request it builds and the neutral result it returns. This guards the two
 * seams that let the agent stay provider-agnostic:
 *   - Google: neutral messages/tools → Gemini `contents`/`functionDeclarations` (uppercase schema),
 *     and Gemini response parts → neutral parts.
 *   - Groq: neutral → OpenAI `messages`/`tools` (param-less tool gets an object schema), and back.
 * Plus the never-throw contract: a failed fetch resolves to a `network` error, never a throw.
 *
 * The adapters import only types from `provider.ts`, so this runs without the RN / expo-sqlite chain.
 */
import { googleClient } from '@/lib/assistant/providers/google';
import { groqClient, rateLimitDelayMs } from '@/lib/assistant/providers/groq';
import type { LlmCallOpts, LlmMessage, LlmToolDecl } from '@/lib/assistant/provider';

const tools: LlmToolDecl[] = [
  {
    name: 'search_foods',
    description: 'Search foods',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'q' } }, required: ['query'] },
  },
  { name: 'get_today', description: "Today's date" }, // param-less
];

// A conversation touching every neutral part type: text, a tool call, and its paired tool result.
const messages: LlmMessage[] = [
  { role: 'user', parts: [{ type: 'text', text: 'what did I eat?' }] },
  { role: 'assistant', parts: [{ type: 'toolCall', id: 'c1', name: 'search_foods', args: { query: 'rice' } }] },
  { role: 'user', parts: [{ type: 'toolResult', id: 'c1', name: 'search_foods', response: { total: 3 } }] },
];

const baseOpts = (): Omit<LlmCallOpts, 'model'> => ({
  messages,
  systemInstruction: 'You are Nico.',
  tools,
  apiKey: 'k',
});

const mockFetchOnce = (json: unknown) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => json });
};

/** Grab the parsed JSON body of the most recent fetch call. */
const lastBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)![1].body as string);

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('googleClient (Gemini adapter)', () => {
  it('converts neutral → Gemini wire and the response back to neutral parts', async () => {
    mockFetchOnce({
      candidates: [{ content: { parts: [{ text: 'ok' }, { functionCall: { name: 'log_food', args: { grams: 5 }, id: 'x' } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12, cachedContentTokenCount: 4 },
    });

    const res = await googleClient.call({ ...baseOpts(), model: 'gemini-3.6-flash' });

    // Request: tools use Gemini's UPPERCASE schema dialect; a param-less tool carries no parameters.
    const body = lastBody();
    const decls = body.tools[0].functionDeclarations;
    expect(decls[0].parameters.type).toBe('OBJECT');
    expect(decls[0].parameters.properties.query.type).toBe('STRING');
    expect(decls[1].parameters).toBeUndefined();
    // Request: roles mapped (assistant→model) and tool call/result carried as functionCall/Response.
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[1].role).toBe('model');
    expect(body.contents[1].parts[0].functionCall.name).toBe('search_foods');
    expect(body.contents[2].parts[0].functionResponse.response).toEqual({ total: 3 });

    // Response: neutral parts + usage (cachedTokens surfaced).
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.parts).toEqual([
        { type: 'text', text: 'ok' },
        { type: 'toolCall', id: 'x', name: 'log_food', args: { grams: 5 } },
      ]);
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedTokens: 4 });
    }
  });

  it('round-trips thoughtSignature on function calls (thinking models 400 without it)', async () => {
    // Two parallel calls — Gemini signs only the first one.
    mockFetchOnce({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: 'get_today', args: {} }, thoughtSignature: 'sig-1' },
              { functionCall: { name: 'get_targets', args: {} } },
            ],
          },
        },
      ],
    });
    const first = await googleClient.call({ ...baseOpts(), model: 'gemini-3.6-flash' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.parts).toEqual([
      { type: 'toolCall', id: undefined, name: 'get_today', args: {}, providerMeta: { thoughtSignature: 'sig-1' } },
      { type: 'toolCall', id: undefined, name: 'get_targets', args: {} },
    ]);

    // Feed the model turn back as history, as the agent loop does.
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
    await googleClient.call({
      ...baseOpts(),
      model: 'gemini-3.6-flash',
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', parts: first.parts },
        {
          role: 'user',
          parts: [
            { type: 'toolResult', name: 'get_today', response: {} },
            { type: 'toolResult', name: 'get_targets', response: {} },
          ],
        },
      ],
    });
    const modelTurn = lastBody().contents[1].parts;
    expect(modelTurn[0]).toEqual({ functionCall: { name: 'get_today', args: {} }, thoughtSignature: 'sig-1' });
    expect(modelTurn[1]).toEqual({ functionCall: { name: 'get_targets', args: {} } });
  });

  it('classifies a malformed-request 400 as api, and only a bad key as auth', async () => {
    const mockError = (status: number, message: string) =>
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: { message } }) });

    mockError(400, 'Function call is missing a thought_signature in functionCall parts.');
    const bad = await googleClient.call({ ...baseOpts(), model: 'gemini-3.6-flash' });
    expect(bad.ok === false && bad.error.kind).toBe('api');

    mockError(400, 'API key not valid. Please pass a valid API key.');
    const key = await googleClient.call({ ...baseOpts(), model: 'gemini-3.6-flash' });
    expect(key.ok === false && key.error.kind).toBe('auth');
  });

  it('never throws on a failed fetch — resolves to a network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const res = await googleClient.call({ ...baseOpts(), model: 'gemini-3.6-flash' });
    expect(res).toEqual({ ok: false, error: { kind: 'network', message: expect.stringMatching(/Network request failed/) } });
  });
});

describe('groqClient (OpenAI-compatible adapter)', () => {
  it('converts neutral → OpenAI wire and the response back to neutral parts', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'hello', tool_calls: [{ id: 't1', type: 'function', function: { name: 'log_food', arguments: '{"grams":5}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 7 } },
    });

    const res = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-120b' });

    // Request: a leading system message, then the mapped turns; the param-less tool gets an object schema.
    const body = lastBody();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Nico.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'what did I eat?' });
    expect(body.messages[2].tool_calls[0]).toMatchObject({ id: 'c1', function: { name: 'search_foods' } });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ total: 3 }) });
    expect(body.tools[1].function.parameters).toEqual({ type: 'object', properties: {} });

    // Response: neutral parts (tool call keeps its id) + usage with cached tokens from the details block.
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.parts).toEqual([
        { type: 'text', text: 'hello' },
        { type: 'toolCall', id: 't1', name: 'log_food', args: { grams: 5 } },
      ]);
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedTokens: 7 });
    }
  });

  it('defaults cachedTokens to 0 when Groq omits the details block (cache miss)', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
    });
    const res = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-20b' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.usage?.cachedTokens).toBe(0);
  });

  it('never throws on a failed fetch — resolves to a network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const res = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-120b' });
    expect(res).toEqual({ ok: false, error: { kind: 'network', message: expect.stringMatching(/Network request failed/) } });
  });

  it('reads cachedTokens from x_groq.usage when top-level usage lacks the details block', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
      x_groq: { usage: { prompt_tokens_details: { cached_tokens: 6 } } },
    });
    const res = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-120b' });
    expect(res.ok && res.usage?.cachedTokens).toBe(6);
  });

  it('waits out a short 429 (TPM burst) and retries instead of failing the turn', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({ error: { message: 'Rate limit reached ... Please try again in 0.01s. Need more tokens?' } }),
    });
    mockFetchOnce({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
    const onRetry = jest.fn();

    const res = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-120b', onRetry });

    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, status: 429 }));
  });

  it('returns rate_limit without retrying when the wait is too long', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: (h: string) => (h === 'retry-after' ? '60' : null) },
      json: async () => ({ error: { message: 'Rate limit reached' } }),
    });
    const res = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-120b' });
    expect(res.ok === false && res.error.kind).toBe('rate_limit');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('parses the retry delay from the header or the message', () => {
    expect(rateLimitDelayMs('2', '')).toBe(2000);
    expect(rateLimitDelayMs(null, 'Please try again in 1.2525s.')).toBeCloseTo(1252.5);
    expect(rateLimitDelayMs(null, 'try again in 850ms')).toBe(850);
    expect(rateLimitDelayMs(null, 'try again in 1m2.5s')).toBe(62_500);
    expect(rateLimitDelayMs(null, 'slow down')).toBeNull();
  });

  it('round-trips gpt-oss reasoning so the history matches what Groq cached', async () => {
    const toolCalls = [{ id: 't1', type: 'function', function: { name: 'get_today', arguments: '{}' } }];
    mockFetchOnce({
      choices: [{ message: { role: 'assistant', content: null, reasoning: 'Need the date first.', tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
    });
    const first = await groqClient.call({ ...baseOpts(), model: 'openai/gpt-oss-120b' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.parts).toEqual([
      { type: 'toolCall', id: 't1', name: 'get_today', args: {}, providerMeta: { reasoning: 'Need the date first.' } },
    ]);

    mockFetchOnce({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] });
    await groqClient.call({
      ...baseOpts(),
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'today?' }] },
        { role: 'assistant', parts: first.parts },
        { role: 'user', parts: [{ type: 'toolResult', id: 't1', name: 'get_today', response: {} }] },
      ],
    });
    expect(lastBody().messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls,
      reasoning: 'Need the date first.',
    });
  });

  it('has no explicit-cache capability (Groq caches automatically)', () => {
    expect(groqClient.ensureCache).toBeUndefined();
  });
});
