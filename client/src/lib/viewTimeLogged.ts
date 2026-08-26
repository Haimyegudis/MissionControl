// Time Spent view pure logic (ui-parity §7): weekly timesheet assembly,
// chart data builders (logged-vs-estimated, per-day sprint stack) and CSV
// rows. Ported from WPF TimeLoggedViewModel.

import type { DailyLogEntry, JiraIssue } from '../types';
import { fmtHours, formatDayLong, formatDayShort, parseYmd } from './viewFormat';

// ---------------------------------------------------------------------------
// Logged vs Estimated chart
// ---------------------------------------------------------------------------

export interface LoggedVsEstimatedGroup {
  key: string;
  estimatedHours: number;
  loggedHours: number;
  /** Logged bar turns rose when over a non-zero estimate. */
  over: boolean;
  tooltip: string;
}

/** Skip issues with neither logged nor estimated time (§7). */
export function buildLoggedVsEstimated(issues: readonly JiraIssue[]): LoggedVsEstimatedGroup[] {
  const groups: LoggedVsEstimatedGroup[] = [];
  for (const i of issues) {
    const logged = (i.timeSpent ?? 0) / 3600;
    const remaining = (i.remainingEstimate ?? 0) / 3600;
    const estimated = (i.originalEstimate ?? 0) / 3600;
    if (logged === 0 && estimated === 0) continue;
    groups.push({
      key: i.key,
      estimatedHours: estimated,
      loggedHours: logged,
      over: estimated > 0 && logged > estimated,
      tooltip:
        `${i.key}  ${i.summary}\n` +
        `Epic: ${i.epicKey && i.epicKey.trim() ? i.epicKey : '—'}\n` +
        `Estimated: ${fmtHours(estimated)} h\n` +
        `Remaining: ${fmtHours(remaining)} h\n` +
        `Logged: ${fmtHours(logged)} h`,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Logging per day (sprint) chart
// ---------------------------------------------------------------------------

/** §7 palette cycle for the per-day sprint stack. */
export const SPRINT_DAILY_PALETTE = [
  '#4F46E5',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#06B6D4',
  '#A855F7',
  '#EC4899',
  '#84CC16',
] as const;

export interface SprintDailyChart {
  /** Series per issue key, ordered by descending total hours. */
  series: Array<{ name: string; color: string }>;
  /** One row per day (ascending). */
  rows: Array<{ label: string; values: number[]; tooltips: string[] }>;
}

export function buildSprintDailyChart(daily: readonly DailyLogEntry[]): SprintDailyChart {
  const days = [...new Set(daily.map((d) => d.day))].sort();
  const byKey = new Map<string, DailyLogEntry[]>();
  for (const e of daily) {
    const list = byKey.get(e.issueKey);
    if (list) list.push(e);
    else byKey.set(e.issueKey, [e]);
  }
  const ordered = [...byKey.entries()].sort(
    (a, b) => b[1].reduce((s, e) => s + e.timeSpent, 0) - a[1].reduce((s, e) => s + e.timeSpent, 0),
  );
  const series = ordered.map(([key], i) => ({
    name: key,
    color: SPRINT_DAILY_PALETTE[i % SPRINT_DAILY_PALETTE.length],
  }));
  const rows = days.map((day) => {
    const date = parseYmd(day);
    const values: number[] = [];
    const tooltips: string[] = [];
    for (const [key, entries] of ordered) {
      const hours = entries.filter((e) => e.day === day).reduce((s, e) => s + e.timeSpent, 0) / 3600;
      values.push(hours);
      tooltips.push(`${formatDayLong(date)}\n${key}  ${entries[0].issueSummary}\nLogged: ${fmtHours(hours)} h`);
    }
    return { label: formatDayShort(date), values, tooltips };
  });
  return { series, rows };
}

// ---------------------------------------------------------------------------
// Daily CSV aggregation
// ---------------------------------------------------------------------------

/** Aggregate per-issue daily entries into hours per `yyyy-MM-dd` day. */
export function aggregateDailyHours(daily: readonly DailyLogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of daily) {
    out[e.day] = (out[e.day] ?? 0) + e.timeSpent / 3600;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exports (§7): {stem}-issues.csv + {stem}-daily.csv
// ---------------------------------------------------------------------------

/** Issues that actually carry logged time in the reported period. */
export function loggedOnlyIssues(issues: readonly JiraIssue[]): JiraIssue[] {
  return issues.filter((i) => (i.workLoggedForPeriod ?? 0) > 0);
}

export const ISSUES_CSV_HEADERS = [
  'Key',
  'Summary',
  'Status',
  'Sprint',
  'WorkLoggedHours',
  'TotalSpentHours',
  'EstimatedHours',
  'RemainingHours',
] as const;

export function issuesCsvRow(i: JiraIssue): string[] {
  return [
    i.key,
    i.summary,
    i.status,
    i.sprint ?? '',
    fmtHours((i.workLoggedForPeriod ?? 0) / 3600),
    fmtHours((i.timeSpent ?? 0) / 3600),
    fmtHours((i.originalEstimate ?? 0) / 3600),
    fmtHours((i.remainingEstimate ?? 0) / 3600),
  ];
}

/** `Date,Hours` rows sorted by day ascending. */
export function dailyCsvRows(hoursByDay: Record<string, number>): Array<[string, string]> {
  return Object.keys(hoursByDay)
    .sort()
    .map((day) => [day, fmtHours(hoursByDay[day])]);
}
