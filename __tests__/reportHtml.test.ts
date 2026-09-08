/**
 * Guards the pure PDF-HTML builder (`lib/reportHtml.ts`). It must stay RN-free (importable in jest)
 * and emit inline chart markup — bars as <rect>, donut/line as <svg>, leaderboards as sized fills.
 */

import { buildReportHtml, type ReportData } from '@/lib/reportHtml';

const base: ReportData = {
  periodLabel: 'Last 30 days',
  dateRange: 'Aug 9 – Sep 8, 2026',
  headline: 'You averaged 2,100 kcal per day.',
  stats: [{ value: '2,100', label: 'kcal · avg/day', color: '#2F9E44' }],
  sections: [],
};

describe('buildReportHtml', () => {
  it('renders header, stats and headline', () => {
    const html = buildReportHtml(base);
    expect(html).toContain('<h1>Last 30 days</h1>');
    expect(html).toContain('Aug 9 – Sep 8, 2026');
    expect(html).toContain('2,100');
  });

  it('emits SVG bars for a bar series, flipping over-target bars to the over color', () => {
    const html = buildReportHtml({
      ...base,
      sections: [{ title: 'Calories per day', rows: [], bar: { values: [100, 300], color: '#2F9E44', target: 200 } }],
    });
    expect(html).toContain('<svg');
    expect(html).toContain('<rect');
    expect(html).toContain('#E03131'); // 300 > target 200 → over color
    expect(html).toContain('stroke-dasharray="4 4"'); // dashed target line
  });

  it('emits a donut with segment arcs and a legend', () => {
    const html = buildReportHtml({
      ...base,
      sections: [
        {
          title: 'Macro split',
          rows: [],
          donut: {
            segments: [
              { label: 'Protein', value: 40, color: '#E8590C', valueText: '40%' },
              { label: 'Carbs', value: 60, color: '#F08C00', valueText: '60%' },
            ],
            centerTop: '40%',
            centerBottom: 'protein',
          },
        },
      ],
    });
    expect(html).toContain('stroke-dashoffset');
    expect(html).toContain('class="legend"');
    expect(html).toContain('Protein');
  });

  it('sizes leaderboard fills proportionally to the max value', () => {
    const html = buildReportHtml({
      ...base,
      sections: [
        {
          title: 'Top spend',
          rows: [],
          leaders: {
            color: '#64748B',
            rows: [
              { label: 'Chicken', value: 10, valueText: '$10' },
              { label: 'Rice', value: 5, valueText: '$5' },
            ],
          },
        },
      ],
    });
    expect(html).toContain('width:100%'); // top row = max
    expect(html).toContain('width:50%'); // half of max
  });

  it('shows the empty note when a section has neither rows nor a chart', () => {
    const html = buildReportHtml({
      ...base,
      sections: [{ title: 'Cheapest protein', rows: [], empty: 'Add prices to your foods to see this.' }],
    });
    expect(html).toContain('Add prices to your foods to see this.');
  });

  it('escapes user-supplied labels', () => {
    const html = buildReportHtml({
      ...base,
      sections: [{ title: 'Top spend', rows: [], leaders: { color: '#000', rows: [{ label: '<b>x</b>', value: 1, valueText: '1' }] } }],
    });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});
