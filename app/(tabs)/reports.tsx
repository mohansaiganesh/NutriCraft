// Scenario: A budget-minded lifter reviewing the past month on the couch after dinner, phone in
// hand under warm lamplight — wants the story of their eating and spending at a glance, and a
// clean summary they can screenshot or send. Light Garden theme, data-dense but calm.

import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import {
  allMealItemsQuery,
  foodsQuery,
  logsInRangeQuery,
  mealsQuery,
  settingsQuery,
} from '@/db/queries';
import {
  adherence,
  aggregateFoods,
  costPer1000Kcal,
  costPerGramProtein,
  dailySeries,
  macroSplit,
  mealComparison,
  mealTypeBreakdown,
  naturalHeadline,
  periodAverages,
  periodTotals,
  proteinPerDollar,
  rankBy,
  spendByBrand,
  type AdherenceMetric,
  type FoodLike,
  type LogEntry,
} from '@/lib/reports';
import { buildReportHtml, type ReportData, type ReportRow } from '@/lib/reportHtml';
import { addDaysISO, fmt, money, todayISO } from '@/lib/format';
import { MEAL_TYPES } from '@/constants/meals';
import { AccountButton, AppHeader, Card, Muted } from '@/components/ui';
import { CalendarField } from '@/components/CalendarField';
import { IconShare } from '@/components/icons';
import { BarChart, DonutChart, HBarLeaderboard, LineChart, type LeaderRow } from '@/components/charts';

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

// Token colors (mirrors tailwind.config.js — SVG needs literals).
const C = {
  brand: '#2F9E44',
  protein: '#E8590C',
  carbs: '#F08C00',
  fat: '#7048E8',
  fiber: '#0CA678',
  cost: '#64748B',
  over: '#E03131',
};

/** "Aug 9 – Sep 8, 2026" from two ISO days. */
function rangeLabel(startISO: string, endISO: string): string {
  const p = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const a = p(startISO);
  const b = p(endISO);
  const md = (dt: Date) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${md(a)} – ${md(b)}, ${b.getFullYear()}`;
}

function SectionCard({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-display-sb text-[16px] text-ink">{title}</Text>
        {right}
      </View>
      {children}
    </Card>
  );
}

/** A labeled stat with a big number, used across the value cards. */
function Stat({ value, label, color = '#16241A' }: { value: string; label: string; color?: string }) {
  return (
    <View className="flex-1">
      <Text className="font-display text-[22px]" style={{ color }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="font-body text-[11.5px] text-ink3 mt-[1px]">{label}</Text>
    </View>
  );
}

function AdherenceRow({ m }: { m: AdherenceMetric }) {
  const good = m.pct >= 70;
  return (
    <View>
      <View className="flex-row items-center justify-between mb-[3px]">
        <Text className="font-body-sb text-[13px] text-ink">
          {m.label}
          {m.streak > 0 ? <Text className="font-body-b" style={{ color: C.brand }}>{'  '}🔥 {m.streak}d</Text> : null}
        </Text>
        <Text className="font-body-b text-[12.5px] text-ink2">
          {m.metDays}/{m.activeDays} days · {fmt(m.pct)}%
        </Text>
      </View>
      <View className="h-[7px] rounded-full overflow-hidden bg-[#EAF0E6]">
        <View style={{ width: `${Math.min(100, m.pct)}%`, backgroundColor: good ? C.brand : '#B7C9AE' }} className="h-[7px] rounded-full" />
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const today = todayISO();
  const [customStart, setCustomStart] = useState(() => addDaysISO(today, -29));
  const [customEnd, setCustomEnd] = useState(() => today);

  // In custom mode, normalize so an inverted From/To pick still renders (min→start, max→end).
  const end = useMemo(
    () => (mode === 'custom' ? (customStart <= customEnd ? customEnd : customStart) : today),
    [mode, customStart, customEnd, today]
  );
  const start = useMemo(
    () =>
      mode === 'custom'
        ? customStart <= customEnd
          ? customStart
          : customEnd
        : addDaysISO(end, -(periodDays - 1)),
    [mode, customStart, customEnd, periodDays, end]
  );

  const { data: settingsRows } = useLiveQuery(settingsQuery());
  const { data: logRows } = useLiveQuery(logsInRangeQuery(start, end), [start, end]);
  const { data: mealRows } = useLiveQuery(mealsQuery());
  const { data: mealItemRows } = useLiveQuery(allMealItemsQuery());
  const { data: foodRows } = useLiveQuery(foodsQuery());

  const settings = settingsRows?.[0];
  const currency = settings?.currency ?? '$';

  const entries: LogEntry[] = useMemo(
    () =>
      (logRows ?? []).map((r) => ({
        loggedDate: r.log.loggedDate,
        mealType: r.log.mealType,
        grams: r.log.grams,
        food: r.food as FoodLike,
      })),
    [logRows]
  );

  const model = useMemo(() => {
    const series = dailySeries(entries, start, end);
    const totals = periodTotals(series);
    const avg = periodAverages(series);
    const foods = aggregateFoods(entries);
    const mealItems = (mealItemRows ?? []).map((r) => ({
      mealId: r.item.mealId,
      grams: r.item.grams,
      food: r.food as FoodLike,
    }));
    const meals = mealComparison(mealRows ?? [], mealItems).filter((m) => m.itemCount > 0);
    const catalog = (foodRows ?? []) as FoodLike[];
    return {
      series,
      totals,
      avg,
      adher: settings ? adherence(series, settings) : [],
      split: macroSplit(totals),
      mealBreak: mealTypeBreakdown(entries),
      foods,
      brands: spendByBrand(entries),
      meals,
      catalog,
      headline: naturalHeadline(entries, series, currency),
      activeDays: series.filter((d) => d.entryCount > 0).length,
    };
  }, [entries, start, end, mealItemRows, mealRows, foodRows, settings, currency]);

  const hasLogs = model.activeDays > 0;
  const periodLabel =
    mode === 'custom'
      ? rangeLabel(start, end)
      : PERIODS.find((p) => p.days === periodDays)!.label;

  // --- Leaderboard rows -----------------------------------------------------
  const topProtein: LeaderRow[] = rankBy(model.foods, (f) => f.totals.proteinG).map((f) => ({
    label: f.name,
    sublabel: f.brand,
    value: f.totals.proteinG,
    valueText: `${fmt(f.totals.proteinG, 1)}g`,
  }));
  const mostLogged: LeaderRow[] = rankBy(model.foods, (f) => f.count).map((f) => ({
    label: f.name,
    value: f.count,
    valueText: `${f.count}×`,
  }));
  const spendFoods: LeaderRow[] = rankBy(model.foods, (f) => f.totals.cost)
    .filter((f) => f.totals.cost > 0)
    .map((f) => ({ label: f.name, sublabel: f.brand, value: f.totals.cost, valueText: money(f.totals.cost, currency) }));
  const brandRows: LeaderRow[] = model.brands.slice(0, 5).map((b) => ({
    label: b.brand,
    value: b.cost,
    valueText: money(b.cost, currency),
  }));
  const cheapestProtein: LeaderRow[] = rankBy(
    model.catalog.filter((f) => proteinPerDollar(f) > 0),
    (f) => proteinPerDollar(f)
  ).map((f) => ({
    label: f.name,
    sublabel: f.brand,
    value: proteinPerDollar(f),
    valueText: `${fmt(proteinPerDollar(f), 1)} g/${currency}`,
  }));
  // Rank saved meals by protein per unit cost; fall back to raw protein when a meal is unpriced.
  const mealRanked = model.meals.map((m) => ({
    ...m,
    perDollar: m.totals.cost > 0 ? m.totals.proteinG / m.totals.cost : 0,
  }));
  const mealRankRows: LeaderRow[] = rankBy(mealRanked, (m) => (m.perDollar > 0 ? m.perDollar : m.totals.proteinG)).map((m) => ({
    label: m.name,
    sublabel: `${fmt(m.totals.calories)} kcal · ${money(m.totals.cost, currency)}`,
    value: m.perDollar > 0 ? m.perDollar : m.totals.proteinG,
    valueText: m.perDollar > 0 ? `${fmt(m.perDollar, 1)} g/${currency}` : `${fmt(m.totals.proteinG, 1)}g P`,
  }));

  // --- Share (PDF) ----------------------------------------------------------
  const onShare = async () => {
    try {
      const t = settings;
      const money2 = (n: number) => money(n, currency);
      const macroRow = (label: string, val: number, unit: string, target?: number): ReportRow => ({
        label,
        value: `${fmt(val, unit === 'g' ? 1 : 0)}${unit}`,
        note: target ? `target ${fmt(target)}${unit}` : undefined,
      });
      const sections: ReportData['sections'] = [
        {
          title: 'Daily average (per logged day)',
          empty: 'Nothing logged in this period.',
          rows: hasLogs
            ? [
                macroRow('Calories', model.avg.calories, ' kcal', t?.targetCalories),
                macroRow('Protein', model.avg.proteinG, 'g', t?.targetProteinG),
                macroRow('Carbs', model.avg.carbsG, 'g', t?.targetCarbsG),
                macroRow('Fat', model.avg.fatG, 'g', t?.targetFatG),
                macroRow('Fiber', model.avg.fiberG, 'g', t?.targetFiberG),
                { label: 'Spent', value: money2(model.avg.cost), note: 'per logged day' },
              ]
            : [],
        },
        {
          title: 'Goal adherence',
          empty: 'Nothing logged in this period.',
          rows: model.adher.map((m) => ({
            label: m.label,
            value: `${m.metDays}/${m.activeDays} days (${fmt(m.pct)}%)`,
            note: m.streak > 0 ? `streak ${m.streak}d` : undefined,
          })),
        },
        {
          title: 'Cost & value',
          rows: [
            { label: 'Total spent', value: money2(model.totals.cost) },
            { label: 'Cost per 1000 kcal', value: money2(costPer1000Kcal(model.totals)) },
            { label: 'Cost per g protein', value: money2(costPerGramProtein(model.totals)) },
          ],
        },
        {
          title: 'Top spend by food',
          empty: 'No priced foods logged.',
          rows: spendFoods.map((r) => ({ label: r.label, note: r.sublabel, value: r.valueText! })),
        },
        {
          title: 'Cheapest protein (your catalog)',
          empty: 'Add prices to your foods to see this.',
          rows: cheapestProtein.map((r) => ({ label: r.label, note: r.sublabel, value: r.valueText! })),
        },
      ];
      const data: ReportData = {
        periodLabel: mode === 'custom' ? 'Custom range' : `Last ${periodLabel}`,
        dateRange: rangeLabel(start, end),
        headline: model.headline,
        sections,
      };
      const { uri } = await Print.printToFileAsync({ html: buildReportHtml(data) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share NutriCraft report', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Report ready', `Saved to:\n${uri}`);
      }
    } catch (e: any) {
      Alert.alert('Share failed', String(e?.message ?? e));
    }
  };

  const caloriesSeries = model.series.map((d) => d.totals.calories);
  const costSeriesVals = model.series.map((d) => d.totals.cost);
  const proteinSeries = model.series.map((d) => d.totals.proteinG);

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="px-4 pb-20 gap-[14px]">
      <AppHeader
        kicker="Your insights"
        title="Reports"
        kickerBelow
        right={
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={onShare}
              className="w-[42px] h-[42px] rounded-full bg-card border border-hair items-center justify-center active:opacity-80"
            >
              <IconShare size={19} color="#3A4A3D" />
            </Pressable>
            <AccountButton />
          </View>
        }
      />

      {/* Period selector */}
      <View className="flex-row bg-[#EAF0E6] rounded-2xl p-[3px]">
        {PERIODS.map((p) => {
          const active = mode === 'preset' && p.days === periodDays;
          return (
            <Pressable
              key={p.days}
              onPress={() => {
                setMode('preset');
                setPeriodDays(p.days);
              }}
              className={`flex-1 py-[9px] rounded-xl items-center ${active ? 'bg-card' : ''}`}
              style={active ? { shadowColor: '#14281e', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 } : undefined}
            >
              <Text className={`text-[13px] ${active ? 'font-body-b text-ink' : 'font-body-sb text-ink3'}`}>{p.days}d</Text>
            </Pressable>
          );
        })}
        {(() => {
          const active = mode === 'custom';
          return (
            <Pressable
              onPress={() => setMode('custom')}
              className={`flex-1 py-[9px] rounded-xl items-center ${active ? 'bg-card' : ''}`}
              style={active ? { shadowColor: '#14281e', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 } : undefined}
            >
              <Text className={`text-[13px] ${active ? 'font-body-b text-ink' : 'font-body-sb text-ink3'}`}>Custom</Text>
            </Pressable>
          );
        })()}
      </View>

      {/* Custom range pickers */}
      {mode === 'custom' ? (
        <View className="flex-row items-end gap-2">
          <View className="flex-1">
            <Text className="font-body-sb text-[11px] text-ink3 mb-1 ml-1">From</Text>
            <CalendarField value={customStart} onChange={setCustomStart} />
          </View>
          <View className="flex-1">
            <Text className="font-body-sb text-[11px] text-ink3 mb-1 ml-1">To</Text>
            <CalendarField value={customEnd} onChange={setCustomEnd} />
          </View>
        </View>
      ) : null}

      {/* Headline */}
      <LinearGradient colors={['#EAF7EC', '#F6FBF3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, borderWidth: 1, borderColor: '#DCEAD4' }}>
        <View className="px-[18px] py-[16px]">
          <Text className="font-body-b text-[11px] tracking-wide uppercase" style={{ color: '#2F9E44' }}>Insight</Text>
          <Text className="font-display-sb text-[17px] text-ink mt-[3px] leading-[23px]">{model.headline}</Text>
        </View>
      </LinearGradient>

      {/* Calories trend */}
      <SectionCard title="Calories per day">
        <View className="flex-row">
          <Stat value={hasLogs ? `${fmt(model.avg.calories)}` : '—'} label={`avg / day · target ${fmt(settings?.targetCalories ?? 0)}`} color={C.brand} />
          <Stat value={money(model.totals.cost, currency)} label="spent this period" color="#16241A" />
        </View>
        {hasLogs ? (
          <BarChart values={caloriesSeries} color={C.brand} target={settings?.targetCalories} height={110} />
        ) : (
          <Muted className="text-[12.5px]">No entries {mode === 'custom' ? 'in this range' : `in the last ${periodLabel}`}. Log some food to see your trend.</Muted>
        )}
        <Text className="font-body text-[10.5px] text-ink3 text-center">{rangeLabel(start, end)}</Text>
      </SectionCard>

      {/* Goal adherence */}
      {hasLogs && model.adher.length > 0 ? (
        <SectionCard title="Goal adherence">
          <View className="gap-[10px]">
            {model.adher.map((m) => (
              <AdherenceRow key={m.key} m={m} />
            ))}
          </View>
          <Muted className="text-[10.5px]">Measured against your current targets across {model.activeDays} logged {model.activeDays === 1 ? 'day' : 'days'}.</Muted>
        </SectionCard>
      ) : null}

      {/* Macro split + protein trend */}
      {hasLogs ? (
        <SectionCard title="Macro split">
          <View className="flex-row items-center" style={{ gap: 14 }}>
            <DonutChart
              size={120}
              stroke={15}
              segments={[
                { label: 'Protein', value: model.split.protein, color: C.protein },
                { label: 'Carbs', value: model.split.carbs, color: C.carbs },
                { label: 'Fat', value: model.split.fat, color: C.fat },
              ]}
              centerTop={`${fmt(model.split.protein)}%`}
              centerBottom="protein"
            />
            <View className="flex-1 gap-[6px]">
              {[
                { label: 'Protein', pct: model.split.protein, color: C.protein, g: model.avg.proteinG },
                { label: 'Carbs', pct: model.split.carbs, color: C.carbs, g: model.avg.carbsG },
                { label: 'Fat', pct: model.split.fat, color: C.fat, g: model.avg.fatG },
              ].map((r) => (
                <View key={r.label} className="flex-row items-center justify-between">
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <View className="w-[9px] h-[9px] rounded-full" style={{ backgroundColor: r.color }} />
                    <Text className="font-body-sb text-[12.5px] text-ink">{r.label}</Text>
                  </View>
                  <Text className="font-body-b text-[12.5px] text-ink2">{fmt(r.pct)}% · {fmt(r.g, 1)}g/day</Text>
                </View>
              ))}
            </View>
          </View>
        </SectionCard>
      ) : null}

      {/* Meal timing */}
      {hasLogs ? (
        <SectionCard title="Calories by meal">
          <HBarLeaderboard
            color={C.brand}
            rows={model.mealBreak
              .map((b, i) => ({
                label: MEAL_TYPES[i]?.label ?? b.key,
                value: b.totals.calories,
                valueText: `${fmt(b.totals.calories)} kcal`,
              }))
              .filter((r) => r.value > 0)}
          />
        </SectionCard>
      ) : null}

      {/* Cost & value */}
      <SectionCard title="Cost & value">
        <View className="flex-row">
          <Stat value={money(costPer1000Kcal(model.totals), currency)} label="per 1000 kcal" color={C.cost} />
          <Stat value={model.totals.proteinG > 0 && model.totals.cost > 0 ? `${money(costPerGramProtein(model.totals), currency)}` : '—'} label="per g protein" color={C.protein} />
          <Stat value={money(model.avg.cost, currency)} label="avg / day" color="#16241A" />
        </View>
        {hasLogs ? <BarChart values={costSeriesVals} color={C.cost} height={80} /> : null}
        {brandRows.length > 0 ? (
          <>
            <Text className="font-body-sb text-[12px] text-ink2 mt-1">Spend by brand</Text>
            <HBarLeaderboard color={C.cost} rows={brandRows} />
          </>
        ) : null}
      </SectionCard>

      {/* Cheapest protein (catalog) */}
      <SectionCard title="Best protein value">
        <Muted className="text-[11px] -mt-1">Most grams of protein per {currency} in your catalog.</Muted>
        <HBarLeaderboard color={C.protein} rows={cheapestProtein} emptyText="Add prices to your foods to rank protein value." />
      </SectionCard>

      {/* Food insights */}
      {hasLogs ? (
        <SectionCard title="Top foods">
          <Text className="font-body-sb text-[12px] text-ink2">Most protein contributed</Text>
          <HBarLeaderboard color={C.protein} rows={topProtein} />
          <Text className="font-body-sb text-[12px] text-ink2 mt-2">Most logged</Text>
          <HBarLeaderboard color={C.brand} rows={mostLogged} />
          {spendFoods.length > 0 ? (
            <>
              <Text className="font-body-sb text-[12px] text-ink2 mt-2">Top spend</Text>
              <HBarLeaderboard color={C.cost} rows={spendFoods} />
            </>
          ) : null}
        </SectionCard>
      ) : null}

      {/* Meal comparison */}
      {mealRankRows.length > 0 ? (
        <SectionCard title="Meal comparison">
          <Muted className="text-[11px] -mt-1">Your saved meals ranked by protein value.</Muted>
          <HBarLeaderboard color={C.brand} rows={mealRankRows} />
        </SectionCard>
      ) : null}

      {/* Protein trend sparkline footer */}
      {hasLogs ? (
        <SectionCard title="Protein trend">
          <Stat value={`${fmt(model.avg.proteinG, 1)}g`} label={`avg / day · target ${fmt(settings?.targetProteinG ?? 0)}g`} color={C.protein} />
          <LineChart values={proteinSeries} color={C.protein} target={settings?.targetProteinG} height={90} />
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}
