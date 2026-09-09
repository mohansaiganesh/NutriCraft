/**
 * The assistant loop's write-turn ordering. Regression guard for the bug where the model's
 * PRE-write narration ("I'll add …") leaked out as the FINAL answer — landing after the user
 * had already confirmed the card. The intro must be surfaced via `onMessage` (so the UI shows it
 * above the confirm card) and NEVER reused as `res.text`.
 *
 * Gemini + the tool layer are mocked so this runs without the network or the expo-sqlite / RN
 * import chain (tools.ts pulls in db/queries).
 */

// Quieten agent.ts's __DEV__ console logging during the run.
(globalThis as any).__DEV__ = false;

jest.mock('@/lib/assistant/gemini', () => ({
  callGemini: jest.fn(),
}));

jest.mock('@/lib/assistant/tools', () => ({
  isWriteTool: (n: string) => n === 'log_food',
  describeWrite: jest.fn(async () => ({
    tool: 'log_food',
    summary: 'Log 45 g of Dates · Breakfast',
    payload: { date: '2026-09-09', mealType: 'breakfast', foodItemId: 'f1', grams: 45 },
  })),
  executeWrite: jest.fn(async () => ({ logId: 'new-log' })),
  runTool: jest.fn(async () => ({})),
}));

// Deterministic step ids keep the loop off any crypto/RN dependency.
jest.mock('@/lib/id', () => {
  let n = 0;
  return { newId: () => `id-${++n}` };
});

import { runAssistant } from '@/lib/assistant/agent';
import { callGemini } from '@/lib/assistant/gemini';

const mockCall = callGemini as unknown as jest.Mock;

const INTRO = "I'll add 45 g of dates to your breakfast.";
const DONE = 'Added 45 g of dates to your breakfast.';

/** A round where the model narrates + proposes the write in one turn. */
const writeRound = {
  ok: true,
  parts: [
    { text: INTRO },
    { functionCall: { name: 'log_food', args: { foodId: 'f1', grams: 45, mealType: 'breakfast' } } },
  ],
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

const approve = jest.fn(async () => 'approve' as const);

beforeEach(() => {
  jest.clearAllMocks();
  mockCall.mockReset();
});

describe('runAssistant: confirmed-write ordering', () => {
  it('surfaces the pre-write narration via onMessage and returns only the post-write text', async () => {
    mockCall
      .mockResolvedValueOnce(writeRound)
      .mockResolvedValueOnce({ ok: true, parts: [{ text: DONE }] });

    const onMessage = jest.fn();
    const res = await runAssistant({
      question: 'I ate 45 g dates for breakfast',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onMessage,
      onConfirm: approve,
    });

    expect(res.ok).toBe(true);
    // The intro is shown once, up front (above the card) — never as the final answer.
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(INTRO);
    if (res.ok) {
      expect(res.text).toBe(DONE);
      expect(res.text).not.toContain("I'll add");
    }
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('falls back to a sane completion if the model goes silent after the write', async () => {
    mockCall
      .mockResolvedValueOnce(writeRound)
      .mockResolvedValueOnce({ ok: true, parts: [] }); // no fresh text, no calls

    const onMessage = jest.fn();
    const res = await runAssistant({
      question: 'I ate 45 g dates for breakfast',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onMessage,
      onConfirm: approve,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('Done.'); // not the leaked INTRO
    expect(onMessage).toHaveBeenCalledWith(INTRO);
  });

  it('leaves a plain read-only answer as a single bubble (no onMessage)', async () => {
    mockCall.mockResolvedValueOnce({ ok: true, parts: [{ text: 'You ate 1,500 kcal today.' }] });

    const onMessage = jest.fn();
    const res = await runAssistant({
      question: 'calories today',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onMessage,
      onConfirm: approve,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('You ate 1,500 kcal today.');
    expect(onMessage).not.toHaveBeenCalled();
  });
});
