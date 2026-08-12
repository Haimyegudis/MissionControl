// Grouped/paired vertical bars (ui-parity §7 "Logged vs Estimated", §12.3
// chart style; dataviz skill: thin marks, 2px gaps, rounded data-ends, legend
// for >=2 series, per-mark hover tooltip).

import { useMemo } from 'react';
import { AXIS_TEXT, GRID_DASH, GRID_STROKE, TITLE_TEXT, fmtNum, legendStyle, niceTicks } from './common';
import type { LegendItem } from './common';

export interface BarSeries {
  name: string;
  color: string;
}

export interface BarGroup {
  label: string;
  /** One value per series. */
  values: number[];
  /** Per-bar color overrides (e.g. logged emerald vs rose when over estimate). */
  colors?: Array<string | undefined>;
  /** Whole-group tooltip; falls back to `{label}\n{series}: {value}`. */
  tooltip?: string;
}

export interface BarsProps {
  title?: string;
  groups: BarGroup[];
  series: BarSeries[];
  height?: number;
  width?: number;
  /** Extra legend entries (e.g. the conditional "Logged (over)" rose swatch). */
  extraLegend?: LegendItem[];
  valueSuffix?: string;
}

export function Bars({ title, groups, series, height = 220, width = 640, extraLegend = [], valueSuffix = '' }: BarsProps) {
  const margin = { top: 8, right: 8, bottom: 58, left: 40 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const max = useMemo(() => Math.max(0, ...groups.flatMap((g) => g.values)), [groups]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => margin.top + plotH - (top > 0 ? (v / top) * plotH : 0);

  const n = Math.max(1, groups.length);
  const slotW = plotW / n;
  const barCount = Math.max(1, series.length);
  const barW = Math.max(3, Math.min(24, (slotW - 8 - (barCount - 1) * 2) / barCount));
  const groupInnerW = barCount * barW + (barCount - 1) * 2;

  const legend: LegendItem[] = [...series, ...extraLegend];

  return (
    <div>
      {title ? <div style={{ ...TITLE_TEXT, marginBottom: 6 }}>{title}</div> : null}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', minWidth: 0 }}
          role="img"
          aria-label={title ?? 'Bar chart'}
        >
          {/* dotted value gridlines, min 0 */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={margin.left}
                x2={margin.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke={GRID_STROKE}
                strokeDasharray={GRID_DASH}
              />
              <text x={margin.left - 6} y={y(t) + 3} textAnchor="end" style={AXIS_TEXT}>
                {fmtNum(t)}
                {valueSuffix}
              </text>
            </g>
          ))}
          {/* baseline */}
          <line
            x1={margin.left}
            x2={margin.left + plotW}
            y1={y(0)}
            y2={y(0)}
            stroke={GRID_STROKE}
          />
          {groups.map((g, gi) => {
            const gx = margin.left + gi * slotW + (slotW - groupInnerW) / 2;
            return (
              <g key={gi}>
                {g.values.map((v, si) => {
                  const color = g.colors?.[si] ?? series[si]?.color ?? '#64748B';
                  const bx = gx + si * (barW + 2);
                  const by = y(Math.max(0, v));
                  const bh = Math.max(0, y(0) - by);
                  const tooltip = g.tooltip ?? `${g.label}\n${series[si]?.name ?? ''}: ${fmtNum(v)}${valueSuffix}`;
                  return (
                    <rect
                      key={si}
                      x={bx}
                      y={by}
                      width={barW}
                      height={bh}
                      rx={Math.min(2, barW / 2)}
                      fill={color}
                    >
                      <title>{tooltip}</title>
                    </rect>
                  );
                })}
                {/* category label, angled ~50° */}
                <text
                  x={gx + groupInnerW / 2}
                  y={margin.top + plotH + 12}
                  textAnchor="end"
                  transform={`rotate(-50 ${gx + groupInnerW / 2} ${margin.top + plotH + 12})`}
                  style={AXIS_TEXT}
                >
                  {g.label}
                </text>
              </g>
            );
          })}
        </svg>
        {legend.length >= 2 ? (
          <div style={legendStyle()}>
            {legend.map((s) => (
              <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: '0 0 auto' }} />
                {s.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
