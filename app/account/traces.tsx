// Scenario: a developer (or a curious power user) reviewing what Nico actually did on past
// questions — a calm, scannable log on the garden-paper ground, newest request at the top.
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { clearTraces, deleteTrace, tracesQuery } from '@/db/queries';
import { Card, DetailHeader, EmptyState } from '@/components/ui';
import { IconTrash } from '@/components/icons';

type TraceRow = {
  id: string;
  question: string;
  status: string;
  model: string;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: string;
  createdAt: string;
};

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  ok: { label: 'OK', bg: '#EAF7EC', fg: '#1B5E2A' },
  error: { label: 'Error', bg: '#FDECEC', fg: '#E03131' },
  stopped_early: { label: 'Stopped early', bg: '#FEF3E2', fg: '#C2820A' },
};

/** Compact relative time ("just now", "3m ago", "2h ago", "Apr 5"). */
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.ok;
  return (
    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: s.bg }}>
      <Text className="font-body-sb text-[10px]" style={{ color: s.fg }}>
        {s.label}
      </Text>
    </View>
  );
}

function TraceCard({ row, onDelete }: { row: TraceRow; onDelete: (row: TraceRow) => void }) {
  const tokens = row.inputTokens + row.outputTokens;
  const meta = [
    `${row.llmCalls} LLM`,
    row.toolCalls > 0 ? `${row.toolCalls} ${row.toolCalls === 1 ? 'tool' : 'tools'}` : null,
    `${tokens.toLocaleString()} tok`,
    `${(row.durationMs / 1000).toFixed(1)}s`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/account/trace/[id]', params: { id: row.id } })}
      className="active:opacity-70"
    >
      <Card className="gap-1.5">
        <View className="flex-row items-start gap-2">
          <Text className="flex-1 font-body-sb text-[14px] text-ink" numberOfLines={2}>
            {row.question}
          </Text>
          <Badge status={row.status} />
          <Pressable
            onPress={() => onDelete(row)}
            hitSlop={10}
            accessibilityLabel="Delete this trace"
            className="-mt-0.5 -mr-0.5 w-7 h-7 rounded-full items-center justify-center active:opacity-60"
          >
            <IconTrash size={15} color="#8B9A8D" />
          </Pressable>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="font-body-md text-[11.5px] text-ink3" numberOfLines={1}>
            {meta}
          </Text>
          <Text className="font-body text-[11.5px] text-ink3 ml-2">{relativeTime(row.startedAt)}</Text>
        </View>
        <Text className="font-body text-[11px] text-ink3" numberOfLines={1}>
          {row.model}
        </Text>
      </Card>
    </Pressable>
  );
}

export default function TraceHistoryScreen() {
  const { data } = useLiveQuery(tracesQuery());
  const rows = (data ?? []) as TraceRow[];

  const onClear = () => {
    Alert.alert('Clear request history?', 'This removes all saved assistant traces on this device (and from the cloud on next sync).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clearTraces() },
    ]);
  };

  const onDelete = (row: TraceRow) => {
    Alert.alert('Delete this trace?', 'This removes the saved trace on this device (and from the cloud on next sync).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteTrace(row.id) },
    ]);
  };

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader
        title="Request history"
        right={
          rows.length > 0 ? (
            <Pressable
              onPress={onClear}
              hitSlop={8}
              accessibilityLabel="Clear history"
              className="w-10 h-10 rounded-full items-center justify-center active:opacity-60"
            >
              <IconTrash size={19} color="#5B6B5E" />
            </Pressable>
          ) : undefined
        }
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerClassName="px-4 pb-24 gap-3"
        renderItem={({ item }) => <TraceCard row={item} onDelete={onDelete} />}
        ListEmptyComponent={
          <EmptyState
            title="No requests yet"
            subtitle="Ask Nico something and each request is traced here — every LLM and tool call, end to end."
          />
        }
      />
    </View>
  );
}
