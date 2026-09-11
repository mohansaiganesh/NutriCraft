import { Text, View } from 'react-native';
import { parseMarkdown } from '@/lib/assistant/markdown';
import { MarkdownText } from './MarkdownText';

/**
 * A labelled block of JSON/text used to show a tool's arguments/result or an LLM call's
 * request/response. Shared by the chat overlay's inline trace and the full trace viewer.
 *
 * `markdown` renders the text as formatted (compact) markdown instead of raw — used for prose blocks
 * like the system instruction, so `**bold**` / bullets don't show as literal characters. Raw JSON
 * payloads leave it off so the trace stays a faithful record of what was sent/received.
 */
export function DataBlock({
  label,
  text,
  error = false,
  markdown = false,
}: {
  label: string;
  text: string;
  error?: boolean;
  markdown?: boolean;
}) {
  return (
    <View>
      <Text className="font-body-sb text-[10px] tracking-wide text-ink3 mb-0.5">{label.toUpperCase()}</Text>
      <View className={`rounded-lg px-2.5 py-2 ${error ? 'bg-[#FDECEC]' : 'bg-[#EEF3EA]'}`}>
        {markdown && !error ? (
          <MarkdownText compact blocks={parseMarkdown(text)} />
        ) : (
          <Text className={`font-body-md text-[11.5px] leading-4 ${error ? 'text-over' : 'text-ink2'}`}>{text}</Text>
        )}
      </View>
    </View>
  );
}
