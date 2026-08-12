// Shared chart primitives (ui-parity §12.3 + dataviz skill):
// value axis min 0 with dotted gridlines, recessive axis text in theme tokens,
// fixed palette order (never cycled per-rank).

import type { CSSProperties } from 'react';

export { CHART_PALETTE } from '../lib/colors';

/** Dotted gridline stroke (#3394A3B8 → rgba). */
export const GRID_STROKE = 'rgba(148, 163, 184, 0.2)';
export const GRID_DASH = '2 3';

/** Axis/category text wears text tokens, never series color. */
export const AXIS_TEXT: CSSProperties = { fill: 'var(--muted)', fontSize: 10 };
export const TITLE_TEXT: CSSProperties = { color: 'var(--text-primary)', fontWeight: 700, fontSize: 13 };

/** Trim to at most 2 decimals. */
export function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Value-axis ticks from 0 up past `max`, on a 1/2/5 step. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export interface LegendItem {
  name: string;
  color: string;
}

/** Legend column placed outside right-top (ui-parity §12.3). */
export function legendStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 11.5,
    color: 'var(--text-primary)',
    paddingTop: 4,
    flex: '0 0 auto',
  };
}
