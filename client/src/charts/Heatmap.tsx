// Activity heatmap (ui-parity §12.6 — exact): 7 rows (weeks start Sunday) ×
// 13 week columns, cell 14px gap 2, oldest left, future days skipped.
// hours <= 0 → #33666666; else green ramp
// rgb(0x10, 0x40 + ratio*(0xC8-0x40), 0x60) with ratio = min(1, hours/max).

import { useMemo } from 'react';
import { fmtNum } from './common';

export interface HeatmapProps {
  /** Hours logged per local day, keyed `yyyy-MM-dd`. */
  hoursByDay: Record<string, number>;
  /** Rightmost column contains this day (default today, local). */
  endDate?: Date;
  weeks?: number;
  cellSize?: number;
  gap?: number;
}

/** Local-date key `yyyy-MM-dd` (heatmap uses local days). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const EMPTY_FILL = 'rgba(102, 102, 102, 0.2)'; // #33666666 (ARGB)

export function Heatmap({ hoursByDay, endDate, weeks = 13, cellSize = 14, gap = 2 }: HeatmapProps) {
  const cells = useMemo(() => {
    const today = endDate ? new Date(endDate) : new Date();
    today.setHours(0, 0, 0, 0);
    // Sunday of the current week, then back (weeks-1) weeks → oldest left.
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);

    const list: Array<{ week: number; dow: number; key: string; hours: number }> = [];
    let max = 0;
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        if (date.getTime() > today.getTime()) continue; // future days skipped
        const key = dayKey(date);
        const hours = hoursByDay[key] ?? 0;
        if (hours > max) max = hours;
        list.push({ week: w, dow: d, key, hours });
      }
    }
    return { list, max };
  }, [hoursByDay, endDate, weeks]);

  const step = cellSize + gap;
  const width = weeks * step - gap;
  const height = 7 * step - gap;

  const fill = (hours: number): string => {
    if (hours <= 0) return EMPTY_FILL;
    const ratio = Math.min(1, cells.max > 0 ? hours / cells.max : 0);
    const g = Math.round(0x40 + ratio * (0xc8 - 0x40));
    return `rgb(16, ${g}, 96)`;
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Activity heatmap (last 13 weeks)"
      style={{ display: 'block' }}
    >
      {cells.list.map((c) => (
        <rect
          key={c.key}
          x={c.week * step}
          y={c.dow * step}
          width={cellSize}
          height={cellSize}
          rx={2}
          fill={fill(c.hours)}
        >
          <title>{`${c.key} — ${fmtNum(c.hours)}h`}</title>
        </rect>
      ))}
    </svg>
  );
}
