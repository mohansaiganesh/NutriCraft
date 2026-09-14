import {
  callSignature,
  describeError,
  describeStop,
  errorTitle,
  previewJson,
  toolErrorMessage,
  toolLabel,
  toolResultOk,
  traceUsage,
  writeDoneMessage,
} from '@/lib/assistant/events';
import type { TraceStep } from '@/lib/assistant/events';

describe('toolLabel', () => {
  it('returns a friendly label for a known tool', () => {
    expect(toolLabel('get_day_totals')).toBe('Adding up a day');
    expect(toolLabel('search_foods')).toBe('Searching foods');
  });

  it('falls back to the raw name for an unknown tool', () => {
    expect(toolLabel('mystery_tool')).toBe('mystery_tool');
  });

  it('labels the write tools', () => {
    expect(toolLabel('log_food')).toBe('Logging a food');
    expect(toolLabel('remove_log_entry')).toBe('Removing a log entry');
    expect(toolLabel('apply_meal_to_day')).toBe('Adding a meal to a day');
  });
});

describe('toolResultOk / toolErrorMessage', () => {
  it('treats a normal object result as ok', () => {
    expect(toolResultOk({ date: '2026-09-08', totals: {} })).toBe(true);
    expect(toolErrorMessage({ date: '2026-09-08' })).toBeUndefined();
  });

  it('treats a { error } object as failed and extracts the message', () => {
    expect(toolResultOk({ error: 'Unknown tool: foo' })).toBe(false);
    expect(toolErrorMessage({ error: 'Unknown tool: foo' })).toBe('Unknown tool: foo');
  });

  it('does not mistake an array (a valid result) for an error', () => {
    expect(toolResultOk([{ error: 'x' }])).toBe(true);
  });

  it('handles null / scalar results as ok', () => {
    expect(toolResultOk(null)).toBe(true);
    expect(toolResultOk(42)).toBe(true);
  });
});

describe('writeDoneMessage', () => {
  it('renders a single successful write as one past-tense sentence', () => {
    expect(writeDoneMessage([{ phrase: 'Logged 1342 g of Granola to Today · Dinner', ok: true }])).toBe(
      'Logged 1342 g of Granola to Today · Dinner.'
    );
  });

  it('renders several successful writes as a bulleted list', () => {
    expect(
      writeDoneMessage([
        { phrase: 'Logged 45 g of dates to Today · Breakfast', ok: true },
        { phrase: 'Logged 100 g of rice to Today · Breakfast', ok: true },
      ])
    ).toBe("Here's what I did as requested:\n- Logged 45 g of dates to Today · Breakfast\n- Logged 100 g of rice to Today · Breakfast");
  });

  it('calls out a partial failure below what did save', () => {
    const msg = writeDoneMessage([
      { phrase: 'Logged 45 g of dates to Today · Breakfast', ok: true },
      { phrase: 'Removed rice from Today · Breakfast', ok: false },
    ]);
    expect(msg).toContain('Logged 45 g of dates');
    expect(msg).toContain("I couldn't save:\nRemoved rice");
  });

  it('leads with the failure when nothing persisted', () => {
    expect(writeDoneMessage([{ phrase: 'Logged 45 g of dates to Today · Breakfast', ok: false }])).toBe(
      "I couldn't save your changes:\nLogged 45 g of dates to Today · Breakfast"
    );
  });
});

describe('previewJson', () => {
  it('pretty-prints an object', () => {
    expect(previewJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('truncates long output and notes how much was dropped', () => {
    const big = { s: 'x'.repeat(5000) };
    const out = previewJson(big, 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toMatch(/more chars\)$/);
  });
});

describe('errorTitle', () => {
  it('titles every known kind', () => {
    expect(errorTitle('auth')).toBe('API key rejected');
    expect(errorTitle('rate_limit')).toBe('Rate limited');
    expect(errorTitle('api')).toBe('Model server error');
    expect(errorTitle('bad_response')).toBe('Unreadable response');
    expect(errorTitle('iteration_limit')).toBe('Too many steps');
  });

  it('falls back for an unknown / missing kind', () => {
    expect(errorTitle(undefined)).toBe('Something went wrong');
  });
});

describe('traceUsage', () => {
  it('counts model calls and sums their input/output/cached tokens, ignoring tool/retry steps', () => {
    const steps: TraceStep[] = [
      { kind: 'model', id: 'm1', iteration: 0, status: 'done', inputTokens: 1204, outputTokens: 342, cachedTokens: 1000 },
      { kind: 'tool', id: 't1', name: 'get_day_totals', label: 'Adding up a day', args: {}, status: 'ok' },
      { kind: 'model', id: 'm2', iteration: 1, status: 'done', inputTokens: 1556, outputTokens: 61, cachedTokens: 1200 },
    ];
    expect(traceUsage(steps)).toEqual({ calls: 2, inputTokens: 2760, outputTokens: 403, cachedTokens: 2200 });
  });

  it('counts a still-running call (tokens not yet known) as a call with zero tokens', () => {
    const steps: TraceStep[] = [{ kind: 'model', id: 'm1', iteration: 0, status: 'running' }];
    expect(traceUsage(steps)).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  });

  it('is zero for an empty trace', () => {
    expect(traceUsage([])).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  });

  it('ignores confirm steps (they are not model calls)', () => {
    const steps: TraceStep[] = [
      { kind: 'model', id: 'm1', iteration: 0, status: 'done', inputTokens: 100, outputTokens: 20 },
      { kind: 'confirm', id: 'c1', tool: 'log_food', label: 'Logging a food', summary: 'Log 150 g …', status: 'approved' },
    ];
    expect(traceUsage(steps)).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20, cachedTokens: 0 });
  });
});

describe('describeError', () => {
  it('gives auth a friendly message and keeps the raw text as detail', () => {
    // With the Google provider, the message carries Google's key-creation hint (the "AQ." note).
    const r = describeError('auth', 'Expected OAuth 2 access token', 'google');
    expect(r.message).toMatch(/AQ\./);
    expect(r.detail).toBe('Expected OAuth 2 access token');
  });

  it('tailors the auth hint per provider (Groq → its console)', () => {
    const r = describeError('auth', 'Invalid API Key', 'groq');
    expect(r.message).toMatch(/console\.groq\.com/);
    expect(r.message).toMatch(/Groq/);
  });

  it('stays provider-neutral when no provider is given', () => {
    const r = describeError('auth', 'nope');
    expect(r.message).toMatch(/API key was rejected/);
    expect(r.message).not.toMatch(/AQ\.|console\.groq/);
  });

  it('no longer leaks the raw message for bad_response (the old gap)', () => {
    const r = describeError('bad_response', 'No answer returned (SAFETY).');
    expect(r.message).not.toContain('SAFETY');
    expect(r.message).toMatch(/couldn't read/);
    expect(r.detail).toBe('No answer returned (SAFETY).');
  });

  it('handles the iteration_limit kind distinctly', () => {
    const r = describeError('iteration_limit', 'Stopped after 6 tool rounds.');
    expect(r.message).toMatch(/too many steps/i);
    expect(r.detail).toBe('Stopped after 6 tool rounds.');
  });
});

describe('callSignature', () => {
  it('is independent of arg key order', () => {
    const a = callSignature('get_range_totals', { startDate: '2026-09-03', endDate: '2026-09-09' });
    const b = callSignature('get_range_totals', { endDate: '2026-09-09', startDate: '2026-09-03' });
    expect(a).toBe(b);
  });

  it('distinguishes different args and different tools', () => {
    expect(callSignature('get_day_totals', { date: '2026-09-08' })).not.toBe(
      callSignature('get_day_totals', { date: '2026-09-09' })
    );
    expect(callSignature('list_meals', {})).not.toBe(callSignature('list_day_logs', {}));
  });

  it('treats missing args as an empty object', () => {
    expect(callSignature('get_today', undefined)).toBe('get_today()');
  });
});

describe('describeStop', () => {
  it('gives a friendly, incompleteness-aware message and keeps the raw detail per kind', () => {
    for (const kind of ['stalled', 'tool_budget', 'round_limit'] as const) {
      const r = describeStop(kind, `hit ${kind}`);
      expect(r.kind).toBe(kind);
      expect(r.message).toMatch(/incomplete|too many steps/i);
      expect(r.detail).toBe(`hit ${kind}`);
    }
  });

  it('surfaces the network message directly (already friendly)', () => {
    const r = describeError('network', 'Network request failed — check your connection.');
    expect(r.message).toBe('Network request failed — check your connection.');
    expect(r.detail).toBeUndefined();
  });
});
