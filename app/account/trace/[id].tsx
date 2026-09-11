// Scenario: debugging why Nico answered the way it did — the full end-to-end trace of one request,
// every LLM round and tool call expandable to its exact inputs, outputs, params and timing.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getTrace } from '@/db/queries';
import type { AssistantTrace } from '@/db/schema';
import { Card, DetailHeader } from '@/components/ui';
import { DataBlock } from '@/components/assistant/DataBlock';
import { MarkdownText } from '@/components/assistant/MarkdownText';
import { IconCheck, IconChevronDown, IconChevronRight, IconSparkles, IconX } from '@/components/icons';
import { parseMarkdown } from '@/lib/assistant/markdown';
import { previewJson } from '@/lib/assistant/events';
import type { TraceStep } from '@/lib/assistant/events';

const STATUS: Record<string, { label: string; fg: string }> = {
  ok: { label: 'OK', fg: '#1B5E2A' },
  error: { label: 'Error', fg: '#E03131' },
  stopped_early: { label: 'Stopped early', fg: '#C2820A' },
};

const ms = (n?: number) => (n == null ? '—' : n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

/** A labelled value in the meta grid. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View className="w-1/2 mb-2.5">
      <Text className="font-body-sb text-[10px] tracking-wide text-ink3 uppercase">{label}</Text>
      <Text className="font-body-md text-[13px] text-ink mt-0.5">{value}</Text>
    </View>
  );
}

function ModelStepCard({ step }: { step: Extract<TraceStep, { kind: 'model' }> }) {
  const [open, setOpen] = useState(false);
  const errored = step.status === 'error';
  const req = step.request;
  const cached = step.cachedTokens ?? 0;
  // Explicit if this round referenced a cachedContents resource; else implicit when a cached prefix
  // was reported. Shown so the source of any saving is unambiguous.
  const cacheTag = req?.cachedContent ? ' · explicit cache' : cached > 0 ? ' · implicit cache' : '';
  return (
    <Card className="gap-1.5 py-3">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center gap-2 active:opacity-70">
        <View className="w-[20px] items-center">
          {errored ? (
            <View className="w-[18px] h-[18px] rounded-full bg-[#FDECEC] items-center justify-center">
              <IconX size={12} color="#E03131" />
            </View>
          ) : (
            <IconSparkles size={15} color="#2F9E44" />
          )}
        </View>
        <Text className={`flex-1 font-body-sb text-[13px] ${errored ? 'text-over' : 'text-ink'}`}>
          LLM call {step.iteration + 1}
          {errored ? ' — failed' : ''}
        </Text>
        {open ? <IconChevronDown size={15} color="#8B9A8D" /> : <IconChevronRight size={15} color="#8B9A8D" />}
      </Pressable>
      <Text className="ml-[28px] font-body-md text-[11.5px] text-ink3">
        {step.model ?? '—'} · {ms(step.durationMs)} · {(step.inputTokens ?? 0).toLocaleString()} in /{' '}
        {(step.outputTokens ?? 0).toLocaleString()} out · {cached.toLocaleString()} cached{cacheTag}
        {step.finishReason ? ` · ${step.finishReason}` : ''}
      </Text>
      {open ? (
        <View className="ml-[28px] mt-1 gap-1.5">
          {req ? (
            <>
              <DataBlock label="System instruction" text={req.systemInstruction} markdown />
              <DataBlock label="Contents sent" text={previewJson(req.contents, 8000)} />
              <DataBlock label="Tools" text={req.toolNames.join(', ')} />
              <DataBlock label="Generation config" text={req.generationConfig ? previewJson(req.generationConfig) : 'defaults (none sent)'} />
              {req.cachedContent ? <DataBlock label="Cached content" text={req.cachedContent} /> : null}
            </>
          ) : null}
          {errored ? (
            <DataBlock label="Error" text={`${step.errorKind ?? 'error'}: ${step.errorMessage ?? ''}`} error />
          ) : (
            <DataBlock label="Response" text={previewJson(step.response, 8000)} />
          )}
        </View>
      ) : null}
    </Card>
  );
}

function ToolStepCard({ step }: { step: Extract<TraceStep, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const failed = step.status === 'error';
  return (
    <Card className="gap-1.5 py-3">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center gap-2 active:opacity-70">
        <View className="w-[20px] items-center">
          {failed ? (
            <View className="w-[18px] h-[18px] rounded-full bg-[#FDECEC] items-center justify-center">
              <IconX size={12} color="#E03131" />
            </View>
          ) : (
            <IconCheck size={16} color="#2F9E44" />
          )}
        </View>
        <View className="flex-1">
          <Text className={`font-body-sb text-[13px] ${failed ? 'text-over' : 'text-ink'}`}>{step.label}</Text>
          <Text className="font-body-md text-[11px] text-ink3 mt-0.5">
            {step.name} · {ms(step.durationMs)}
          </Text>
        </View>
        {open ? <IconChevronDown size={15} color="#8B9A8D" /> : <IconChevronRight size={15} color="#8B9A8D" />}
      </Pressable>
      {open ? (
        <View className="ml-[28px] mt-1 gap-1.5">
          <DataBlock label="Arguments" text={previewJson(step.args)} />
          <DataBlock
            label={failed ? 'Error' : 'Result'}
            text={failed ? step.error ?? 'Tool failed' : previewJson(step.result, 8000)}
            error={failed}
          />
        </View>
      ) : null}
    </Card>
  );
}

function ConfirmStepCard({ step }: { step: Extract<TraceStep, { kind: 'confirm' }> }) {
  const approved = step.status === 'approved';
  return (
    <Card className="gap-1 py-3">
      <View className="flex-row items-center gap-2">
        <View className="w-[20px] items-center">
          {approved ? (
            <IconCheck size={16} color="#2F9E44" />
          ) : (
            <View className="w-[18px] h-[18px] rounded-full bg-[#EEF1EE] items-center justify-center">
              <IconX size={11} color="#8B9A8D" />
            </View>
          )}
        </View>
        <Text className="flex-1 font-body-sb text-[13px] text-ink">
          {step.label} — {step.status}
        </Text>
        <Text className="font-body-md text-[11px] text-ink3">{ms(step.durationMs)}</Text>
      </View>
      <Text className="ml-[28px] font-body text-[12px] text-ink3">{step.summary}</Text>
    </Card>
  );
}

function RetryStepCard({ step }: { step: Extract<TraceStep, { kind: 'retry' }> }) {
  return (
    <Card className="py-2.5">
      <View className="flex-row items-center gap-2">
        <View className="w-2 h-2 rounded-full bg-[#C2820A] ml-1.5" />
        <Text className="flex-1 font-body-md text-[12.5px] text-ink3">
          Server hiccup — retried (attempt {step.attempt}, HTTP {step.status})
        </Text>
      </View>
    </Card>
  );
}

function StepCard({ step }: { step: TraceStep }) {
  if (step.kind === 'model') return <ModelStepCard step={step} />;
  if (step.kind === 'tool') return <ToolStepCard step={step} />;
  if (step.kind === 'confirm') return <ConfirmStepCard step={step} />;
  return <RetryStepCard step={step} />;
}

export default function TraceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trace, setTrace] = useState<AssistantTrace | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const row = await getTrace(id);
      if (!active) return;
      setTrace(row);
      try {
        setSteps(row ? (JSON.parse(row.steps) as TraceStep[]) : []);
      } catch {
        setSteps([]);
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const status = trace ? STATUS[trace.status] ?? STATUS.ok : null;

  return (
    <View className="flex-1 bg-paper">
      <DetailHeader title="Request trace" />
      {!loaded ? null : !trace ? (
        <View className="px-4">
          <Card>
            <Text className="font-body-md text-[14px] text-ink2">This trace is no longer available.</Text>
          </Card>
        </View>
      ) : (
        <ScrollView contentContainerClassName="px-4 pb-24 gap-3">
          {/* Question + answer */}
          <Card className="gap-2">
            <Text className="font-body-sb text-[10px] tracking-wide text-ink3 uppercase">Question</Text>
            <Text className="font-body-md text-[15px] text-ink">{trace.question}</Text>
            <View className="border-t border-hair mt-1 pt-2">
              <Text className="font-body-sb text-[10px] tracking-wide text-ink3 uppercase mb-1">
                {trace.status === 'error' ? 'Error' : 'Answer'}
              </Text>
              {trace.status === 'error' ? (
                <Text className="font-body text-[14px] leading-5 text-over">{trace.answer}</Text>
              ) : (
                <MarkdownText blocks={parseMarkdown(trace.answer)} />
              )}
            </View>
          </Card>

          {/* Meta grid */}
          <Card>
            <View className="flex-row flex-wrap">
              <Meta label="Status" value={status?.label ?? trace.status} />
              <Meta label="Model" value={trace.model || '—'} />
              <Meta label="LLM calls" value={String(trace.llmCalls)} />
              <Meta label="Tool calls" value={String(trace.toolCalls)} />
              <Meta
                label="Tokens"
                value={`${trace.inputTokens.toLocaleString()} in / ${trace.outputTokens.toLocaleString()} out (${trace.cachedTokens.toLocaleString()} cached)`}
              />
              <Meta label="Duration" value={ms(trace.durationMs)} />
              <Meta label="Started" value={new Date(trace.startedAt).toLocaleString()} />
              {trace.stopReason ? <Meta label="Stop reason" value={trace.stopReason} /> : null}
              {trace.errorKind ? <Meta label="Error kind" value={trace.errorKind} /> : null}
            </View>
          </Card>

          {/* Timeline */}
          <Text className="font-body-b text-[12px] tracking-wide text-ink3 uppercase ml-1 mt-1">Timeline</Text>
          {steps.length === 0 ? (
            <Card>
              <Text className="font-body text-[13px] text-ink3">No steps were recorded for this request.</Text>
            </Card>
          ) : (
            steps.map((s) => <StepCard key={s.id} step={s} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}
