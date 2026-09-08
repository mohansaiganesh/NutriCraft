import {
  describeError,
  errorTitle,
  previewJson,
  toolErrorMessage,
  toolLabel,
  toolResultOk,
  traceUsage,
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
    expect(errorTitle('api')).toBe('Gemini server error');
    expect(errorTitle('bad_response')).toBe('Unreadable response');
    expect(errorTitle('iteration_limit')).toBe('Too many steps');
  });

  it('falls back for an unknown / missing kind', () => {
    expect(errorTitle(undefined)).toBe('Something went wrong');
  });
});

describe('traceUsage', () => {
  it('counts model calls and sums their input/output tokens, ignoring tool/retry steps', () => {
    const steps: TraceStep[] = [
      { kind: 'model', id: 'm1', iteration: 0, status: 'done', inputTokens: 1204, outputTokens: 342 },
      { kind: 'tool', id: 't1', name: 'get_day_totals', label: 'Adding up a day', args: {}, status: 'ok' },
      { kind: 'model', id: 'm2', iteration: 1, status: 'done', inputTokens: 1556, outputTokens: 61 },
    ];
    expect(traceUsage(steps)).toEqual({ calls: 2, inputTokens: 2760, outputTokens: 403 });
  });

  it('counts a still-running call (tokens not yet known) as a call with zero tokens', () => {
    const steps: TraceStep[] = [{ kind: 'model', id: 'm1', iteration: 0, status: 'running' }];
    expect(traceUsage(steps)).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0 });
  });

  it('is zero for an empty trace', () => {
    expect(traceUsage([])).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  });
});

describe('describeError', () => {
  it('gives auth a friendly message and keeps the raw text as detail', () => {
    const r = describeError('auth', 'Expected OAuth 2 access token');
    expect(r.message).toMatch(/AQ\./);
    expect(r.detail).toBe('Expected OAuth 2 access token');
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

  it('surfaces the network message directly (already friendly)', () => {
    const r = describeError('network', 'Network request failed — check your connection.');
    expect(r.message).toBe('Network request failed — check your connection.');
    expect(r.detail).toBeUndefined();
  });
});
