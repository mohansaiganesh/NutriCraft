import {
  EPOCH,
  advanceCursorAll,
  advanceCursorPartial,
  fromRemote,
  isRowLevelError,
  maxIso,
  shouldApplyRemote,
  toRemote,
  type FieldMap,
} from '@/lib/syncCore';

// The food_items field map is the interesting one: it contains the camelCase→snake_case
// pairs a naive converter breaks on (pricePer100 → price_per_100, servingSizeG →
// serving_size_g). Mirrors TABLES['food_items'].fields in lib/sync.ts.
const FOOD_FIELDS: FieldMap = {
  id: 'id',
  userId: 'user_id',
  name: 'name',
  servingSizeG: 'serving_size_g',
  pricePer100: 'price_per_100',
  isCustom: 'is_custom',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deleted: 'deleted',
};

// settings has NO user_id column — its PK `id` IS the userId.
const SETTINGS_FIELDS: FieldMap = {
  id: 'id',
  targetCalories: 'target_calories',
  currency: 'currency',
  updatedAt: 'updated_at',
};

describe('maxIso', () => {
  it('returns the lexicographically-later ISO string', () => {
    expect(maxIso('2024-01-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z')).toBe(
      '2024-06-01T00:00:00.000Z'
    );
    expect(maxIso('2024-06-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')).toBe(
      '2024-06-01T00:00:00.000Z'
    );
  });

  it('is stable when the two are equal', () => {
    expect(maxIso(EPOCH, EPOCH)).toBe(EPOCH);
  });
});

describe('isRowLevelError', () => {
  it('treats Postgres class-23 (integrity) codes as row-level', () => {
    expect(isRowLevelError({ code: '23503' })).toBe(true); // FK violation
    expect(isRowLevelError({ code: '23505' })).toBe(true); // unique violation
  });

  it('treats network / auth / missing codes as NOT row-level (whole batch retries)', () => {
    expect(isRowLevelError({ code: '08006' })).toBe(false); // connection failure
    expect(isRowLevelError({ code: '42501' })).toBe(false); // RLS / insufficient privilege
    expect(isRowLevelError({ message: 'Network request failed' })).toBe(false);
    expect(isRowLevelError(null)).toBe(false);
    expect(isRowLevelError(undefined)).toBe(false);
  });
});

describe('toRemote / fromRemote field mapping', () => {
  it('maps local camelCase onto remote snake_case, including pricePer100 → price_per_100', () => {
    const local = {
      id: 'f1',
      userId: 'u1',
      name: 'Oats',
      servingSizeG: 40,
      pricePer100: 3.5,
      isCustom: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      deleted: false,
    };
    expect(toRemote(FOOD_FIELDS, local)).toEqual({
      id: 'f1',
      user_id: 'u1',
      name: 'Oats',
      serving_size_g: 40,
      price_per_100: 3.5,
      is_custom: true,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      deleted: false,
    });
  });

  it('round-trips a row through toRemote → fromRemote unchanged', () => {
    const local = {
      id: 'f1',
      userId: 'u1',
      name: 'Oats',
      servingSizeG: 40,
      pricePer100: 3.5,
      isCustom: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      deleted: false,
    };
    expect(fromRemote(FOOD_FIELDS, toRemote(FOOD_FIELDS, local))).toEqual(local);
  });

  it('only emits keys present in the field map (ignores stray columns)', () => {
    const remote = {
      id: 's1',
      target_calories: 2000,
      currency: 'USD',
      updated_at: '2024-01-02T00:00:00.000Z',
      // a column the client does not track — must be dropped, not leaked into the local row
      some_future_column: 'ignore me',
    };
    const local = fromRemote(SETTINGS_FIELDS, remote);
    expect(local).toEqual({
      id: 's1',
      targetCalories: 2000,
      currency: 'USD',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    expect(local).not.toHaveProperty('some_future_column');
    expect(local).not.toHaveProperty('user_id'); // settings has no user_id
  });
});

describe('advanceCursorAll (batch-upsert fast path)', () => {
  it('advances to the max updatedAt across pushed rows', () => {
    const cursor = '2024-01-01T00:00:00.000Z';
    const ats = [
      '2024-03-01T00:00:00.000Z',
      '2024-02-01T00:00:00.000Z',
      '2024-05-01T00:00:00.000Z',
    ];
    expect(advanceCursorAll(cursor, ats)).toBe('2024-05-01T00:00:00.000Z');
  });

  it('never moves the cursor backwards', () => {
    const cursor = '2024-09-01T00:00:00.000Z';
    expect(advanceCursorAll(cursor, ['2024-01-01T00:00:00.000Z'])).toBe(cursor);
  });

  it('is a no-op for an empty batch', () => {
    const cursor = '2024-01-01T00:00:00.000Z';
    expect(advanceCursorAll(cursor, [])).toBe(cursor);
  });
});

describe('advanceCursorPartial (row-by-row slow path)', () => {
  const cursor = '2024-01-01T00:00:00.000Z';

  it('advances to max when every row succeeded (no failures)', () => {
    const succeeded = ['2024-02-01T00:00:00.000Z', '2024-04-01T00:00:00.000Z'];
    expect(advanceCursorPartial(cursor, succeeded, null)).toBe('2024-04-01T00:00:00.000Z');
  });

  it('never advances past (or up to) the earliest failure, so failed rows re-select', () => {
    // Row at 03-01 failed; a later row at 05-01 succeeded but must NOT advance the cursor
    // past the failure, or 03-01 would never be retried.
    const succeeded = ['2024-02-01T00:00:00.000Z', '2024-05-01T00:00:00.000Z'];
    const minFailed = '2024-03-01T00:00:00.000Z';
    const result = advanceCursorPartial(cursor, succeeded, minFailed);
    expect(result).toBe('2024-02-01T00:00:00.000Z');
    // The failed row stays strictly greater than the new cursor → re-selected next cycle.
    expect(result < minFailed).toBe(true);
  });

  it('excludes a success whose timestamp equals the earliest failure (>= boundary)', () => {
    const tie = '2024-03-01T00:00:00.000Z';
    const succeeded = [tie];
    expect(advanceCursorPartial(cursor, succeeded, tie)).toBe(cursor);
  });

  it('stays at the cursor when nothing succeeded', () => {
    expect(advanceCursorPartial(cursor, [], '2024-02-01T00:00:00.000Z')).toBe(cursor);
  });
});

describe('shouldApplyRemote (last-write-wins pull)', () => {
  const remote = '2024-05-01T00:00:00.000Z';

  it('applies when there is no local copy', () => {
    expect(shouldApplyRemote(undefined, remote)).toBe(true);
  });

  it('applies when the local copy is strictly older', () => {
    expect(shouldApplyRemote('2024-01-01T00:00:00.000Z', remote)).toBe(true);
  });

  it('skips when the local copy is newer (local wins)', () => {
    expect(shouldApplyRemote('2024-09-01T00:00:00.000Z', remote)).toBe(false);
  });

  it('skips on an exact tie (local wins), so a re-pull is idempotent', () => {
    expect(shouldApplyRemote(remote, remote)).toBe(false);
  });
});
