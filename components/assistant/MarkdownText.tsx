import { Text, View } from 'react-native';
import type { MdBlock, MdSpan } from '@/lib/assistant/markdown';

/**
 * Shared renderer for the assistant's light markdown replies (parsed by `lib/assistant/markdown.ts`).
 * Used by the chat overlay's answer bubble and the request-trace viewer, so `**bold**` / bullets /
 * numbered lists render the same everywhere instead of showing raw markers.
 *
 * `compact` shrinks type to sit inside a small `DataBlock` (the trace's System-instruction block);
 * the default is the roomy chat-bubble scale.
 */

/** Renders an inline run (bold / italic / code) as a nested <Text>. */
function InlineSpans({ spans, compact = false }: { spans: MdSpan[]; compact?: boolean }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          // On a DataBlock's #EEF3EA ground the chat code shade would vanish, so compact code uses a
          // slightly darker chip.
          return (
            <Text
              key={i}
              className={
                compact
                  ? 'font-body-md text-[11.5px] text-ink bg-[#DCE7D6] rounded px-1'
                  : 'font-body-md text-[13px] text-ink bg-[#EEF3EA] rounded px-1'
              }
            >
              {s.text}
            </Text>
          );
        }
        const base = compact
          ? s.bold
            ? 'font-body-b text-ink2'
            : 'font-body-md text-ink2'
          : s.bold
            ? 'font-body-b text-ink'
            : 'font-body text-ink';
        return (
          <Text key={i} className={base} style={s.italic ? { fontStyle: 'italic' } : undefined}>
            {s.text}
          </Text>
        );
      })}
    </>
  );
}

/** Renders parsed markdown blocks with the Garden type tokens — paragraphs and bullet/ordered lists. */
export function MarkdownText({ blocks, compact = false }: { blocks: MdBlock[]; compact?: boolean }) {
  const para = compact ? 'font-body-md text-[11.5px] leading-4 text-ink2' : 'font-body text-[14.5px] leading-6 text-ink';
  const line = compact ? 'text-[11.5px] leading-4' : 'text-[14.5px] leading-6';
  return (
    <View className={compact ? 'gap-1' : 'gap-1.5'}>
      {blocks.map((b, i) => {
        if (b.type === 'paragraph') {
          return (
            <Text key={i} className={para}>
              <InlineSpans spans={b.spans} compact={compact} />
            </Text>
          );
        }
        const ordered = b.type === 'ordered';
        return (
          <View key={i} className={compact ? 'gap-0.5' : 'gap-1'}>
            {b.items.map((item, j) => (
              <View key={j} className="flex-row">
                <Text
                  className={`${line} mr-2 ${
                    ordered ? 'font-body-sb text-ink2' : 'font-body-b text-brand'
                  }`}
                >
                  {ordered ? `${j + 1}.` : '•'}
                </Text>
                <Text className={`flex-1 ${para}`}>
                  <InlineSpans spans={item} compact={compact} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
