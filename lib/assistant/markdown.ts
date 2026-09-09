/**
 * A tiny, pure markdown parser for the assistant's replies.
 *
 * Gemini answers come back as light markdown (**bold**, `- ` bullets, `1.` lists, blank-line
 * paragraphs). This turns that into a small block tree the chat renderer walks — covering ONLY the
 * subset a short nutrition answer emits (no tables, fenced code, links or images). It is RN-free and
 * has no imports so it stays jest-testable, mirroring the pure helpers in `lib/nutrition.ts` and the
 * mappers in `lib/foodSearch.ts`.
 */

/** An inline run of text with optional emphasis. */
export interface MdSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type MdBlock =
  | { type: 'paragraph'; spans: MdSpan[] }
  | { type: 'bullet'; items: MdSpan[][] }
  | { type: 'ordered'; items: MdSpan[][] };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;

/**
 * Split a single line into inline spans, honouring `**bold**`/`__bold__`, `*italic*`/`_italic_`
 * and `` `code` ``. Any unmatched marker is treated as literal text (so "3 * 4" or a lone "**"
 * never leaves a dangling emphasis or crashes).
 */
export function parseInline(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      spans.push({ text: buf });
      buf = '';
    }
  };

  // Find the next matching closer for `marker` starting at `from`; returns -1 if none.
  const findClose = (marker: string, from: number): number => text.indexOf(marker, from);

  // Underscores INSIDE a word are literal (CommonMark rule), so food ids like `rice_basmati_royal`
  // or `simply_granola_oats` render verbatim instead of turning half the name italic. An `_` marker
  // opens emphasis only when not glued to a preceding word char, and closes only when not glued to a
  // following word char. Asterisks keep their looser behaviour (arithmetic is already guarded below).
  const isWord = (c: string | undefined) => c != null && /[A-Za-z0-9]/.test(c);
  const underscoreEmphasis = (markerLen: 1 | 2, close: number) =>
    !isWord(text[i - 1]) && !isWord(text[close + markerLen]);

  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const one = text[i];

    if (two === '**' || two === '__') {
      const close = findClose(two, i + 2);
      if (close > i + 1 && (two === '**' || underscoreEmphasis(2, close))) {
        flush();
        spans.push({ text: text.slice(i + 2, close), bold: true });
        i = close + 2;
        continue;
      }
    } else if ((one === '*' || one === '_') && text[i + 1] !== one) {
      const close = findClose(one, i + 1);
      // Require non-empty content; for `_`, also require it not to sit mid-word (see isWord above).
      if (close > i && (one === '*' || underscoreEmphasis(1, close))) {
        flush();
        spans.push({ text: text.slice(i + 1, close), italic: true });
        i = close + 1;
        continue;
      }
    } else if (one === '`') {
      const close = findClose('`', i + 1);
      if (close > i) {
        flush();
        spans.push({ text: text.slice(i + 1, close), code: true });
        i = close + 1;
        continue;
      }
    }

    buf += one;
    i += 1;
  }

  flush();
  // A line that was entirely markers (e.g. "**") collapses to nothing — keep at least one span
  // so callers can render an empty line without special-casing.
  return spans.length ? spans : [{ text: '' }];
}

/** Parse a reply into blocks: paragraphs, bullet lists and ordered lists. */
export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];

  let paragraph: string[] = []; // buffered lines of the current paragraph

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const joined = paragraph.join('\n').trim();
    if (joined) blocks.push({ type: 'paragraph', spans: parseInline(joined) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank line ends the current paragraph.
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      const items: MdSpan[][] = [parseInline(bullet[1])];
      while (i + 1 < lines.length && BULLET_RE.test(lines[i + 1])) {
        items.push(parseInline(BULLET_RE.exec(lines[++i])![1]));
      }
      blocks.push({ type: 'bullet', items });
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushParagraph();
      const items: MdSpan[][] = [parseInline(ordered[1])];
      while (i + 1 < lines.length && ORDERED_RE.test(lines[i + 1])) {
        items.push(parseInline(ORDERED_RE.exec(lines[++i])![1]));
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      // Degrade a heading to a bold paragraph — the renderer has no heading style.
      blocks.push({ type: 'paragraph', spans: [{ text: heading[1].trim(), bold: true }] });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
