// Horizontal stacked bars (ui-parity §7 "Logging per day", §9 workload; §12.3
// chart style: legend outside right, value axis min 0 dotted gridlines;
// dataviz skill: 2px surface gaps between segments, per-segment tooltip,
// identity via legend — never color alone).

import { useMemo } from 'react';
import { AXIS_TEXT, GRID_DASH, GRID_STROKE, TITLE_TEXT, fmtNum, legendStyle, niceTicks } from './common';

export interface StackedSeries {
  name: string;
  color: string;
}

export interface StackedRow {
  label: string;
  /** One value per series (0 = no segment). */
  values: number[];
  /** Per-segment tooltip; falls back to `{label}\n{series}: {value}`. */
  tooltips?: Array<string | undefined>;
}

export interface StackedBarsHProps {
  title?: string;
  rows: StackedRow[];
  series: StackedSeries[];
  width?: number;
  rowHeight?: number;
  labelWidth?: number;
  valueSuffix?: string;
}

export function StackedBarsH({
  title,
  rows,
  series,
  width = 640,
  rowHeight = 24,
  labelWidth = 110,
  valueSuffix = '',
}: StackedBarsHProps) {
  const margin = { top: 6, right: 8, bottom: 22, left: labelWidth };
  const height = margin.top + Math.max(1, rows.length) * rowHeight + margin.bottom;
  const plotW = width - margin.left - margin.right;

  const max = useMemo(
    () => Math.max(0, ...rows.map((r) => r.values.reduce((a, b) => a + Math.max(0, b), 0))),
    [rows],
  );
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (v: number) => margin.left + (top > 0 ? (v / top) * plotW : 0);

  const barH = Math.max(8, Math.min(18, rowHeight - 8));

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
          aria-label={title ?? 'Stacked bar chart'}
        >
          {/* dotted value gridlines, min 0 */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={margin.top}
                y2={height - margin.bottom}
                stroke={GRID_STROKE}
                strokeDasharray={GRID_DASH}
              />
              <text x={x(t)} y={height - margin.bottom + 12} textAnchor="middle" style={AXIS_TEXT}>
                {fmtNum(t)}
                {valueSuffix}
              </text>
            </g>
          ))}
          {rows.map((row, ri) => {
            const cy = margin.top + ri * rowHeight + rowHeight / 2;
            let acc = 0;
            return (
              <g key={ri}>
                <text x={margin.left - 8} y={cy + 3} textAnchor="end" style={AXIS_TEXT}>
                  {row.label}
                </text>
                {row.values.map((v, si) => {
                  const value = Math.max(0, v);
                  if (value <= 0) return null;
                  const x0 = x(acc);
                  const x1 = x(acc + value);
                  acc += value;
                  // 2px surface gap between adjacent segments.
                  const w = Math.max(1, x1 - x0 - 2);
                  const tooltip = row.tooltips?.[si] ?? `${row.label}\n${series[si]?.name ?? ''}: ${fmtNum(value)}${valueSuffix}`;
                  return (
                    <rect key={si} x={x0} y={cy - barH / 2} width={w} height={barH} rx={2} fill={series[si]?.color ?? '#64748B'}>
                      <title>{tooltip}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
        {/* legend outside right (always present for multi-series identity) */}
        <div style={legendStyle()}>
          {series.map((s) => (
            <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: '0 0 auto' }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
