/**
 * The assistant's WRITE tools: `describe()` must validate/resolve args (and refuse bad or
 * not-owned targets) before anything is proposed, and `execute()` must call the matching
 * `db/queries.ts` mutation with normalized values. The DB layer is mocked so these run without
 * the expo-sqlite / React-Native import chain.
 */

// The factory is hoisted above imports and must own its jest.fn()s (referencing an outer const
// would hit the temporal dead zone). We reach the same fns back through the imported module below.
jest.mock('@/db/queries', () => ({
  getFood: jest.fn(),
  getLogEntry: jest.fn(),
  mealsQuery: jest.fn(),
  mealItemsQuery: jest.fn(),
  addLog: jest.fn(),
  updateLog: jest.fn(),
  removeLog: jest.fn(),
  applyMealToDay: jest.fn(),
}));
jest.mock('@/lib/currentUser', () => ({
  getCurrentUserId: () => 'user-1',
  requireUserId: () => 'user-1',
}));

import { describeWrite, executeWrite, isWriteTool } from '@/lib/assistant/tools';
import * as queries from '@/db/queries';

const mockQueries = queries as unknown as Record<string, jest.Mock>;

const logEntry = (over: Record<string, unknown> = {}) => ({
  log: { grams: 100, mealType: 'lunch', loggedDate: '2026-09-09', ...over },
  food: { name: 'Rice' },
});

beforeEach(() => jest.clearAllMocks());

describe('isWriteTool', () => {
  it('separates write tools from read tools', () => {
    expect(isWriteTool('log_food')).toBe(true);
    expect(isWriteTool('apply_meal_to_day')).toBe(true);
    expect(isWriteTool('get_day_totals')).toBe(false);
    expect(isWriteTool('nope')).toBe(false);
  });
});

describe('describeWrite: log_food', () => {
  it('validates a good call and normalizes the payload', async () => {
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'Chicken breast', userId: 'user-1', deleted: false });
    const r: any = await describeWrite('log_food', { foodId: 'f1', grams: 150, mealType: 'lunch', date: '2026-09-09' });
    expect(r).not.toHaveProperty('error');
    expect(r.payload).toEqual({ date: '2026-09-09', mealType: 'lunch', foodItemId: 'f1', grams: 150 });
    expect(r.summary).toMatch(/150 g of Chicken breast/);
  });

  it('rejects non-positive grams', async () => {
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'X', userId: 'user-1', deleted: false });
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 0, mealType: 'lunch' })).toHaveProperty('error');
    expect(await describeWrite('log_food', { foodId: 'f1', grams: -5, mealType: 'lunch' })).toHaveProperty('error');
  });

  it('rejects an unknown meal type', async () => {
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'X', userId: 'user-1', deleted: false });
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'brunch' })).toHaveProperty('error');
  });

  it("refuses a food owned by a different account", async () => {
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'X', userId: 'someone-else', deleted: false });
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch' })).toHaveProperty('error');
  });

  it('refuses a deleted or missing food', async () => {
    mockQueries.getFood.mockResolvedValue(null);
    expect(await describeWrite('log_food', { foodId: 'gone', grams: 100, mealType: 'lunch' })).toHaveProperty('error');
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'X', userId: 'user-1', deleted: true });
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch' })).toHaveProperty('error');
  });

  it('allows a shared-catalog food (userId null) and defaults the date to today', async () => {
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'Shared', userId: null, deleted: false });
    const r: any = await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch' });
    expect(r).not.toHaveProperty('error');
    expect(r.payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses a malformed or impossible calendar date', async () => {
    mockQueries.getFood.mockResolvedValue({ id: 'f1', name: 'X', userId: 'user-1', deleted: false });
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch', date: '09/09/2026' })).toHaveProperty('error');
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch', date: '2026-13-45' })).toHaveProperty('error');
    expect(await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch', date: '2026-02-30' })).toHaveProperty('error');
    // A real leap day still passes.
    const r: any = await describeWrite('log_food', { foodId: 'f1', grams: 100, mealType: 'lunch', date: '2024-02-29' });
    expect(r).not.toHaveProperty('error');
  });
});

describe('describeWrite: update_log_entry', () => {
  it('refuses an id that is not the current user\'s', async () => {
    mockQueries.getLogEntry.mockResolvedValue(null);
    expect(await describeWrite('update_log_entry', { logId: 'x', grams: 100 })).toHaveProperty('error');
  });

  it('requires at least one field to change', async () => {
    mockQueries.getLogEntry.mockResolvedValue(logEntry());
    expect(await describeWrite('update_log_entry', { logId: 'l1' })).toHaveProperty('error');
  });

  it('builds a grams-change payload with a before→after summary', async () => {
    mockQueries.getLogEntry.mockResolvedValue(logEntry({ grams: 100 }));
    const r: any = await describeWrite('update_log_entry', { logId: 'l1', grams: 200 });
    expect(r.payload).toEqual({ id: 'l1', patch: { grams: 200 } });
    expect(r.summary).toMatch(/100 g → 200 g/);
  });
});

describe('describeWrite: remove_log_entry', () => {
  it('is flagged destructive and refuses an unknown entry', async () => {
    mockQueries.getLogEntry.mockResolvedValue(null);
    expect(await describeWrite('remove_log_entry', { logId: 'x' })).toHaveProperty('error');

    mockQueries.getLogEntry.mockResolvedValue(logEntry());
    const r: any = await describeWrite('remove_log_entry', { logId: 'l1' });
    expect(r.destructive).toBe(true);
    expect(r.payload).toEqual({ id: 'l1' });
  });
});

describe('describeWrite: apply_meal_to_day', () => {
  it('refuses a meal that is not the user\'s', async () => {
    mockQueries.mealsQuery.mockResolvedValue([]);
    expect(await describeWrite('apply_meal_to_day', { mealId: 'm1', mealType: 'dinner' })).toHaveProperty('error');
  });

  it('refuses a meal with no items', async () => {
    mockQueries.mealsQuery.mockResolvedValue([{ id: 'm1', name: 'Bowl' }]);
    mockQueries.mealItemsQuery.mockResolvedValue([]);
    expect(await describeWrite('apply_meal_to_day', { mealId: 'm1', mealType: 'dinner' })).toHaveProperty('error');
  });

  it('builds a payload and item-count summary for a good meal', async () => {
    mockQueries.mealsQuery.mockResolvedValue([{ id: 'm1', name: 'Bowl' }]);
    mockQueries.mealItemsQuery.mockResolvedValue([{}, {}]);
    const r: any = await describeWrite('apply_meal_to_day', { mealId: 'm1', mealType: 'dinner', date: '2026-09-09' });
    expect(r.payload).toEqual({ mealId: 'm1', date: '2026-09-09', mealType: 'dinner' });
    expect(r.summary).toMatch(/2 items/);
  });
});

describe('executeWrite', () => {
  it('log_food calls addLog with normalized args and returns the new id', async () => {
    mockQueries.addLog.mockResolvedValue('new-log-id');
    const r = await executeWrite('log_food', { date: '2026-09-09', mealType: 'lunch', foodItemId: 'f1', grams: 150 });
    expect(mockQueries.addLog).toHaveBeenCalledWith('2026-09-09', 'lunch', 'f1', 150);
    expect(r).toEqual({ logId: 'new-log-id' });
  });

  it('remove_log_entry calls removeLog', async () => {
    mockQueries.removeLog.mockResolvedValue(undefined);
    expect(await executeWrite('remove_log_entry', { id: 'l1' })).toEqual({ removed: true });
    expect(mockQueries.removeLog).toHaveBeenCalledWith('l1');
  });

  it('apply_meal_to_day returns how many entries were added', async () => {
    mockQueries.applyMealToDay.mockResolvedValue(3);
    expect(await executeWrite('apply_meal_to_day', { mealId: 'm1', date: '2026-09-09', mealType: 'dinner' })).toEqual({ added: 3 });
  });

  it('surfaces a mutation failure as an { error } result instead of throwing', async () => {
    mockQueries.updateLog.mockRejectedValue(new Error('db down'));
    expect(await executeWrite('update_log_entry', { id: 'l1', patch: { grams: 10 } })).toEqual({ error: 'db down' });
  });
});
