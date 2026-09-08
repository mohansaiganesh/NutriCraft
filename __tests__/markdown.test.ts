import { parseInline, parseMarkdown } from '@/lib/assistant/markdown';

describe('parseInline', () => {
  it('parses bold, italic and inline code runs', () => {
    expect(parseInline('You logged **1,840 kcal** today')).toEqual([
      { text: 'You logged ' },
      { text: '1,840 kcal', bold: true },
      { text: ' today' },
    ]);
    expect(parseInline('that is *a lot*')).toEqual([
      { text: 'that is ' },
      { text: 'a lot', italic: true },
    ]);
    expect(parseInline('use `get_today`')).toEqual([
      { text: 'use ' },
      { text: 'get_today', code: true },
    ]);
  });

  it('supports __bold__ and treats unmatched markers as literal text', () => {
    expect(parseInline('__protein__')).toEqual([{ text: 'protein', bold: true }]);
    // A stray marker and an arithmetic asterisk must not create dangling emphasis.
    expect(parseInline('3 * 4 = 12')).toEqual([{ text: '3 * 4 = 12' }]);
    expect(parseInline('a lone ** here')).toEqual([{ text: 'a lone ** here' }]);
  });

  it('keeps an unmatched marker as literal text (never an empty array)', () => {
    expect(parseInline('**')).toEqual([{ text: '**' }]);
    expect(parseInline('')).toEqual([{ text: '' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('First line.\n\nSecond paragraph.');
    expect(blocks).toEqual([
      { type: 'paragraph', spans: [{ text: 'First line.' }] },
      { type: 'paragraph', spans: [{ text: 'Second paragraph.' }] },
    ]);
  });

  it('groups consecutive "- " lines into one bullet list', () => {
    const blocks = parseMarkdown('Today:\n- Chicken bowl — 620 kcal\n- Greek yogurt — 180 kcal');
    expect(blocks).toEqual([
      { type: 'paragraph', spans: [{ text: 'Today:' }] },
      {
        type: 'bullet',
        items: [
          [{ text: 'Chicken bowl — 620 kcal' }],
          [{ text: 'Greek yogurt — 180 kcal' }],
        ],
      },
    ]);
  });

  it('groups numbered lines into an ordered list and keeps inline emphasis', () => {
    const blocks = parseMarkdown('1. **Eggs** 2 large\n2. Toast');
    expect(blocks).toEqual([
      {
        type: 'ordered',
        items: [
          [{ text: 'Eggs', bold: true }, { text: ' 2 large' }],
          [{ text: 'Toast' }],
        ],
      },
    ]);
  });

  it('degrades a heading to a bold paragraph', () => {
    expect(parseMarkdown('## Summary')).toEqual([
      { type: 'paragraph', spans: [{ text: 'Summary', bold: true }] },
    ]);
  });
});
