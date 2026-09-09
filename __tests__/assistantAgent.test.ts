/**
 * The assistant loop's write handling: every write the model proposes is STAGED and confirmed with
 * ONE card at the end of the run — regardless of how the model split the calls up (all in one turn
 * or dripped one per round). Guards the "single confirmation" contract and the intro→card→done
 * ordering (the model's pre-write summary is surfaced via `onMessage`, above the card, and never
 * leaks out as the final answer).
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
  // A per-call summary built from the args, so a batch of writes has distinct rows.
  describeWrite: jest.fn(async (name: string, args: any) => ({
    tool: name,
    summary: `Log ${args.grams} g of ${args.foodId}`,
    payload: { date: '2026-09-09', mealType: args.mealType ?? 'breakfast', foodItemId: args.foodId, grams: args.grams },
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
import { executeWrite } from '@/lib/assistant/tools';

const mockCall = callGemini as unknown as jest.Mock;
const mockExecute = executeWrite as unknown as jest.Mock;

const DONE = 'Added dates and rice to your breakfast.';
const SUMMARY = "I'll add dates and rice to your breakfast.";

const logCall = (foodId: string, grams: number) => ({
  functionCall: { name: 'log_food', args: { foodId, grams, mealType: 'breakfast' } },
});
const textRound = (text: string) => ({ ok: true, parts: [{ text }], usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } });

beforeEach(() => {
  jest.clearAllMocks();
  mockCall.mockReset();
});

describe('runAssistant: single confirmation for staged writes', () => {
  it('confirms ONCE when the model batches all writes into one turn', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [{ text: SUMMARY }, logCall('dates', 45), logCall('rice', 100)] }) // stage both
      .mockResolvedValueOnce(textRound(SUMMARY)) // terminal: closing summary, no calls → card
      .mockResolvedValueOnce(textRound(DONE)); // closing round after approval

    const onConfirm = jest.fn(async (_req: any) => 'approve' as const);
    const onMessage = jest.fn();
    const res = await runAssistant({
      question: 'I ate 45 g dates and 100 g rice for breakfast',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onMessage,
      onConfirm,
    });

    expect(res.ok).toBe(true);
    // ONE card, listing BOTH items.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as any).items).toHaveLength(2);
    // Both writes executed only after the single approval.
    expect(mockExecute).toHaveBeenCalledTimes(2);
    // Intro shown once, above the card; the done text is the closing message, not the intro.
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(SUMMARY);
    if (res.ok) {
      expect(res.text).toBe(DONE);
      expect(res.text).not.toContain("I'll add");
    }
  });

  it('confirms ONCE even when the model drips writes one per round', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [logCall('dates', 45)] }) // round 0: stage A
      .mockResolvedValueOnce({ ok: true, parts: [logCall('rice', 100)] }) // round 1: stage B
      .mockResolvedValueOnce(textRound(SUMMARY)) // round 2: terminal summary, no calls → card
      .mockResolvedValueOnce(textRound(DONE)); // closing round after approval

    const onConfirm = jest.fn(async (_req: any) => 'approve' as const);
    const res = await runAssistant({
      question: 'log dates then rice',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm,
    });

    expect(res.ok).toBe(true);
    // The model-independence guarantee: still exactly one card, with both items.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as any).items).toHaveLength(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    if (res.ok) expect(res.text).toBe(DONE);
  });

  it('writes nothing when the user declines the batch', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [logCall('dates', 45)] }) // stage
      .mockResolvedValueOnce(textRound(SUMMARY)) // terminal → card
      .mockResolvedValueOnce(textRound('Okay, I haven’t changed anything.')); // closing (declined)

    const onConfirm = jest.fn(async () => 'reject' as const);
    const res = await runAssistant({
      question: 'log dates',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm,
    });

    expect(res.ok).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('leaves a plain read-only answer as a single bubble (no card, no onMessage)', async () => {
    mockCall.mockResolvedValueOnce(textRound('You ate 1,500 kcal today.'));

    const onConfirm = jest.fn(async (_req: any) => 'approve' as const);
    const onMessage = jest.fn();
    const res = await runAssistant({
      question: 'calories today',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onMessage,
      onConfirm,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('You ate 1,500 kcal today.');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
