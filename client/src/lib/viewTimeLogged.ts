// Time Spent view pure logic (ui-parity §7): weekly timesheet assembly,
// chart data builders (logged-vs-estimated, per-day sprint stack, heatmap
// aggregation) and CSV rows. Ported from WPF TimeLoggedViewModel.

import type { DailyLogEntry, JiraIssue, TimeLoggedReport } from '../types';
import { addDays, fmtHours, formatDayLong, formatDayShort, parseYmd, ymd } from './viewFormat';

// ---------------------------------------------------------------------------
// Weekly timesheet
// ---------------------------------------------------------------------------

export interface TimesheetRow {
  issueKey: string;
  summary: string;
  loggedHours: number;
  /** Hours per day cell, index 0 = week start. */
  days: number[];
}

export interface Timesheet {
  rows: TimesheetRow[];
  /** Per-day totals (7 cells). */
  totals: number[];
  weeklyTotalHours: number;
}

/** Build the 7-day timesheet grid from a range report (rows ordered by key). */
export function buildTimesheet(weekStart: Date, report: TimeLoggedReport): Timesheet {
  const from = ymd(weekStart);
  const byIssue = new Map<string, DailyLogEntry[]>();
  for (const e of report.dailyByIssue) {
    const list = byIssue.get(e.issueKey);
    if (list) list.push(e);
    else byIssue.set(e.issueKey, [e]);
  }
  const fromDate = parseYmd(from);
  const totals = [0, 0, 0, 0, 0, 0, 0];
  const rows: TimesheetRow[] = [];
  for (const issue of [...report.issues].sort((a, b) => a.key.localeCompare(b.key))) {
    const days = [0, 0, 0, 0, 0, 0, 0];
    for (const e of byIssue.get(issue.key) ?? []) {
      const idx = Math.round((parseYmd(e.day).getTime() - fromDate.getTime()) / 86_400_000);
      if (idx < 0 || idx > 6) continue;
      const hours = e.timeSpent / 3600;
      days[idx] += hours;
      totals[idx] += hours;
    }
    rows.push({
      issueKey: issue.key,
      summary: issue.summary,
      loggedHours: days.reduce((a, b) => a + b, 0),
      days,
    });
  }
  return { rows, totals, weeklyTotalHours: totals.reduce((a, b) => a + b, 0) };
}

/** Header cells: `dd` (bold) over `DDD` (uppercase day name) per §7. */
export function timesheetHeaders(weekStart: Date): Array<{ dayNumber: string; dayLabel: string }> {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    return {
      dayNumber: String(d.getDate()).padStart(2, '0'),
      dayLabel: formatDayShort(d).slice(0, 3).toUpperCase(),
    };
  });
}

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
// Heatmap + daily CSV aggregation
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
