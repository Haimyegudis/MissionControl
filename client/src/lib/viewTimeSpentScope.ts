// Time Spent scope-first redesign: pure window/scope math, editable-row
// merging, and cell-input parsing. No React, no fetches.

import type { DailyLogEntry, JiraIssue } from '../types';
import { addDays, formatDayLong, parseYmd, startOfWeekSunday, ymd } from './viewFormat';
import { parseJiraTime } from './timeFormat';

export type ScopeId = 'day' | 'week' | 'month' | 'sprint' | 'custom';
export type ViewId = 'timesheet' | 'summary' | 'epics' | 'calendar' | 'board';

export interface ScopeWindow {
  /** yyyy-MM-dd inclusive start */ from: string;
  /** yyyy-MM-dd EXCLUSIVE end */ to: string;
  /** e.g. "Wed 26 Aug 2026", "Aug 23 – Aug 29, 2026", "August 2026" */ label: string;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "23 Aug – 29 Aug 2026" — day/month of start and end, year of the end date. */
function formatRangeLabel(start: Date, endInclusive: Date): string {
  const startPart = `${pad2(start.getDate())} ${MONTH_ABBR[start.getMonth()]}`;
  const endPart = `${pad2(endInclusive.getDate())} ${MONTH_ABBR[endInclusive.getMonth()]}`;
  return `${startPart} – ${endPart} ${endInclusive.getFullYear()}`;
}

/** "<name> · 23 Aug – 10 Sep" — sprint scope label from name + inclusive date range (no year, per spec). */
export function formatSprintLabel(name: string, start: Date, endInclusive: Date): string {
  const startPart = `${pad2(start.getDate())} ${MONTH_ABBR[start.getMonth()]}`;
  const endPart = `${pad2(endInclusive.getDate())} ${MONTH_ABBR[endInclusive.getMonth()]}`;
  return `${name} · ${startPart} – ${endPart}`;
}

/** Window for a scope anchored at `anchor` (any date inside the window). Custom uses the inclusive customTo. */
export function scopeWindow(
  scope: Exclude<ScopeId, 'sprint'>,
  anchor: Date,
  customFrom: string,
  customTo: string,
): ScopeWindow {
  switch (scope) {
    case 'day': {
      const from = ymd(anchor);
      const to = ymd(addDays(anchor, 1));
      return { from, to, label: formatDayLong(anchor) };
    }
    case 'week': {
      const start = startOfWeekSunday(anchor);
      const end = addDays(start, 7);
      const lastDay = addDays(end, -1);
      return { from: ymd(start), to: ymd(end), label: formatRangeLabel(start, lastDay) };
    }
    case 'month': {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      return { from: ymd(first), to: ymd(next), label: `${MONTH_FULL[anchor.getMonth()]} ${anchor.getFullYear()}` };
    }
    case 'custom': {
      const start = parseYmd(customFrom);
      const endInclusive = parseYmd(customTo);
      const to = ymd(addDays(endInclusive, 1));
      return { from: customFrom, to, label: formatRangeLabel(start, endInclusive) };
    }
  }
}

/** New anchor after stepping ±1 unit (day/week/month). Custom/sprint anchors don't step here. */
export function stepAnchor(scope: 'day' | 'week' | 'month', anchor: Date, dir: 1 | -1): Date {
  switch (scope) {
    case 'day':
      return addDays(anchor, dir);
    case 'week':
      return addDays(anchor, dir * 7);
    case 'month':
      return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  }
}

/**
 * Sprint ◀ ▶ stepping: moves `current` by `dir` within `available`, clamped
 * at both ends (no wraparound). An unknown/blank `current` (e.g. '' = active
 * sprint) starts from index 0. Empty `available` is a no-op.
 */
export function stepSprintName(available: readonly string[], current: string, dir: 1 | -1): string {
  if (available.length === 0) return current;
  const idx = available.indexOf(current);
  const nextIdx = Math.min(available.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + dir));
  return available[nextIdx];
}

const BASE_VIEWS: ViewId[] = ['timesheet', 'summary', 'epics'];

/** Views legal for a scope: month adds 'calendar', sprint adds 'board'; timesheet hidden for month. */
export function viewsForScope(scope: ScopeId): ViewId[] {
  switch (scope) {
    case 'month':
      return ['summary', 'epics', 'calendar'];
    case 'sprint':
      return [...BASE_VIEWS, 'board'];
    default:
      return [...BASE_VIEWS];
  }
}

/** Day columns of a window, capped at 62. */
export function windowDays(window: { from: string; to: string }): string[] {
  const days: string[] = [];
  const end = parseYmd(window.to);
  let cursor = parseYmd(window.from);
  while (cursor < end && days.length < 62) {
    days.push(ymd(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

export interface EditableRow {
  key: string;
  summary: string;
  /** hours per day, aligned with windowDays */ hours: number[];
  totalHours: number;
  /** true when the row came from the sprint fallback or manual add (no logs yet) */ empty: boolean;
}

function emptyRow(days: readonly string[], key: string, summary: string): EditableRow {
  return { key, summary, hours: days.map(() => 0), totalHours: 0, empty: true };
}

/** Merge logged issues (report) + sprint issues + manual keys into ordered rows. */
export function buildEditableRows(
  days: string[],
  report: { issues: JiraIssue[]; dailyByIssue: DailyLogEntry[] } | null,
  sprintIssues: readonly JiraIssue[],
  manual: readonly { key: string; summary: string }[],
): EditableRow[] {
  const rows: EditableRow[] = [];
  const seen = new Set<string>();

  if (report) {
    const loggedIssues = [...report.issues].sort((a, b) => a.key.localeCompare(b.key));
    for (const issue of loggedIssues) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      const hours = days.map((day) => {
        const seconds = report.dailyByIssue
          .filter((e) => e.day === day && e.issueKey === issue.key)
          .reduce((sum, e) => sum + e.timeSpent, 0);
        return seconds / 3600;
      });
      rows.push({
        key: issue.key,
        summary: issue.summary,
        hours,
        totalHours: hours.reduce((sum, h) => sum + h, 0),
        empty: false,
      });
    }
  }

  const sprintSorted = [...sprintIssues]
    .filter((i) => !seen.has(i.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  for (const issue of sprintSorted) {
    if (seen.has(issue.key)) continue;
    seen.add(issue.key);
    rows.push(emptyRow(days, issue.key, issue.summary));
  }

  for (const m of manual) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    rows.push(emptyRow(days, m.key, m.summary));
  }

  return rows;
}

const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** '2' | '1.5' → hours; '2h 30m' → parseJiraTime. Returns seconds or null. */
export function parseCellInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (PLAIN_NUMBER.test(trimmed)) {
    const n = Number(trimmed);
    if (n > 0 && n <= 24) return Math.round(n * 3600);
  }

  const parsed = parseJiraTime(trimmed);
  return parsed !== null && parsed > 0 ? parsed : null;
}
