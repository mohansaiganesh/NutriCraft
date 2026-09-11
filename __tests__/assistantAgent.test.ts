/**
 * The assistant loop's write handling: every write the model proposes is STAGED and confirmed with
 * ONE card at the end of the run — regardless of how the model split the calls up (all in one turn
 * or dripped one per round). Guards the "single confirmation" contract and that the model's
 * pre-write summary never leaks out as the final answer (the closing text is deterministic).
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
  // A per-call summary built from the args, so a batch of writes has distinct rows. editableGrams
  // marks the item as grams-editable (as the real log_food describe does).
  describeWrite: jest.fn(async (name: string, args: any) => {
    const mealType = args.mealType ?? null; // null ⇒ not supplied; the card asks (never guessed)
    return {
      tool: name,
      summary: `Log ${args.grams} g of ${args.foodId}`,
      donePhrase: `Logged ${args.grams} g of ${args.foodId}`,
      editableGrams: args.grams,
      editNoun: args.foodId,
      editableMeal: mealType,
      payload: { date: '2026-09-09', mealType, foodItemId: args.foodId, grams: args.grams },
    };
  }),
  // Rebuild a staged write with the card edits — grams and/or a picked meal (mirrors reviseWrite).
  reviseWrite: jest.fn(async (name: string, payload: any, edits: { grams?: number; mealType?: string }) => {
    const grams = edits.grams ?? payload.grams;
    const mealType = edits.mealType ?? payload.mealType;
    return {
      tool: name,
      summary: `Log ${grams} g of ${payload.foodItemId}`,
      donePhrase: `Logged ${grams} g of ${payload.foodItemId}`,
      editableGrams: grams,
      editNoun: payload.foodItemId,
      editableMeal: mealType,
      payload: { ...payload, grams, mealType },
    };
  }),
  executeWrite: jest.fn(async () => ({ logId: 'new-log' })),
  runTool: jest.fn(async () => ({})),
  NAV_TOOLS: { open_food_catalog: { pathname: '/(tabs)/foods', label: 'Open Foods catalog' } },
}));

// Deterministic step ids keep the loop off any crypto/RN dependency.
jest.mock('@/lib/id', () => {
  let n = 0;
  return { newId: () => `id-${++n}` };
});

import { runAssistant } from '@/lib/assistant/agent';
import { callGemini } from '@/lib/assistant/gemini';
import { executeWrite, reviseWrite } from '@/lib/assistant/tools';

const mockCall = callGemini as unknown as jest.Mock;
const mockExecute = executeWrite as unknown as jest.Mock;
const mockRevise = reviseWrite as unknown as jest.Mock;

// The post-confirm message is now built DETERMINISTICALLY from each write's donePhrase (no closing
// model round), so the mocked describeWrite/reviseWrite donePhrases drive res.text below.
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
      .mockResolvedValueOnce(textRound(SUMMARY)); // terminal: closing summary, no calls → card

    const onConfirm = jest.fn(async (_req: any) => ({ kind: 'approve' as const }));
    const res = await runAssistant({
      question: 'I ate 45 g dates and 100 g rice for breakfast',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm,
    });

    expect(res.ok).toBe(true);
    // ONE card, listing BOTH items.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as any).items).toHaveLength(2);
    // Both writes executed only after the single approval.
    expect(mockExecute).toHaveBeenCalledTimes(2);
    // No closing model round: only the stage + terminal rounds were sent.
    expect(mockCall).toHaveBeenCalledTimes(2);
    if (res.ok) {
      // Done text is deterministic (both past-tense phrases), never the model's stale intro.
      expect(res.text).toContain('Logged 45 g of dates');
      expect(res.text).toContain('Logged 100 g of rice');
      expect(res.text).not.toContain("I'll add");
    }
  });

  it('confirms ONCE even when the model drips writes one per round', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [logCall('dates', 45)] }) // round 0: stage A
      .mockResolvedValueOnce({ ok: true, parts: [logCall('rice', 100)] }) // round 1: stage B
      .mockResolvedValueOnce(textRound(SUMMARY)); // round 2: terminal summary, no calls → card

    const onConfirm = jest.fn(async (_req: any) => ({ kind: 'approve' as const }));
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
    if (res.ok) {
      expect(res.text).toContain('Logged 45 g of dates');
      expect(res.text).toContain('Logged 100 g of rice');
    }
  });

  it('writes nothing when the user declines the batch', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [logCall('dates', 45)] }) // stage
      .mockResolvedValueOnce(textRound(SUMMARY)); // terminal → card

    const onConfirm = jest.fn(async () => ({ kind: 'reject' as const }));
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
    // Decline text is deterministic; no closing model round is sent (only stage + terminal).
    expect(mockCall).toHaveBeenCalledTimes(2);
    if (res.ok) expect(res.text).toBe("Okay — I haven't changed anything. Let me know if you'd like to adjust it.");
  });

  it('applies a grams edit from the card before executing', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [logCall('dates', 45)] }) // stage 45 g
      .mockResolvedValueOnce(textRound(SUMMARY)); // terminal → card

    // The user bumps the single item to 60 g in the card, keyed by its confirm-step id.
    const onConfirm = jest.fn(async (req: any) => ({ kind: 'approve' as const, edits: { [req.items[0].id]: { grams: 60 } } }));
    const res = await runAssistant({
      question: 'log 45 g dates',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm,
    });

    expect(res.ok).toBe(true);
    // The edit is re-validated + rebuilt via reviseWrite, then executed with the revised payload.
    expect(mockRevise).toHaveBeenCalledTimes(1);
    expect(mockRevise.mock.calls[0][2]).toEqual({ grams: 60 });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect((mockExecute.mock.calls[0][1] as any).grams).toBe(60);
    // The deterministic done message names the EDITED amount, never the stale 45 g.
    if (res.ok) {
      expect(res.text).toContain('Logged 60 g of dates');
      expect(res.text).not.toContain('45');
    }
  });

  it('stages a meal-less log and applies the meal the user picks in the card', async () => {
    // Model logs 20 g of oats WITHOUT a meal (the new schema lets it omit mealType).
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [{ functionCall: { name: 'log_food', args: { foodId: 'oats', grams: 20 } } }] })
      .mockResolvedValueOnce(textRound(SUMMARY)); // terminal → card

    // The card reaches the user with the meal unset, then they pick "dinner".
    const onConfirm = jest.fn(async (req: any) => {
      expect(req.items[0].editableMeal).toBeNull(); // ⇒ the card requires a pick
      return { kind: 'approve' as const, edits: { [req.items[0].id]: { mealType: 'dinner' as const } } };
    });
    const res = await runAssistant({
      question: 'I ate 20g of oats today',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm,
    });

    expect(res.ok).toBe(true);
    // The picked meal is re-validated via reviseWrite and executed — never a guessed 'breakfast'.
    expect(mockRevise.mock.calls[0][2]).toEqual({ mealType: 'dinner' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect((mockExecute.mock.calls[0][1] as any).mealType).toBe('dinner');
  });

  it('leaves a plain read-only answer as a single bubble (no card)', async () => {
    mockCall.mockResolvedValueOnce(textRound('You ate 1,500 kcal today.'));

    const onConfirm = jest.fn(async (_req: any) => ({ kind: 'approve' as const }));
    const res = await runAssistant({
      question: 'calories today',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('You ate 1,500 kcal today.');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('surfaces a navigation target when a NAV_TOOLS read runs (the Foods handoff)', async () => {
    mockCall
      .mockResolvedValueOnce({ ok: true, parts: [{ functionCall: { name: 'open_food_catalog', args: {} } }] }) // request the handoff
      .mockResolvedValueOnce(textRound('You have 140 foods.')); // terminal answer, no calls

    const res = await runAssistant({
      question: 'show me all my foods',
      history: [],
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      onConfirm: jest.fn(async () => ({ kind: 'approve' as const })),
    });

    expect(res.ok).toBe(true);
    // The answer carries the button target from NAV_TOOLS — the UI renders it; nothing was written.
    if (res.ok) {
      expect(res.text).toBe('You have 140 foods.');
      expect(res.navigation).toEqual({ pathname: '/(tabs)/foods', label: 'Open Foods catalog' });
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
