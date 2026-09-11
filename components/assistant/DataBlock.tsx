import { Text, View } from 'react-native';

/**
 * A labelled block of JSON/text used to show a tool's arguments/result or an LLM call's
 * request/response. Shared by the chat overlay's inline trace and the full trace viewer.
 */
export function DataBlock({ label, text, error = false }: { label: string; text: string; error?: boolean }) {
  return (
    <View>
      <Text className="font-body-sb text-[10px] tracking-wide text-ink3 mb-0.5">{label.toUpperCase()}</Text>
      <View className={`rounded-lg px-2.5 py-2 ${error ? 'bg-[#FDECEC]' : 'bg-[#EEF3EA]'}`}>
        <Text className={`font-body-md text-[11.5px] leading-4 ${error ? 'text-over' : 'text-ink2'}`}>{text}</Text>
      </View>
    </View>
  );
}
