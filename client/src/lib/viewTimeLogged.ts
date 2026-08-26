// Time Spent view pure logic (ui-parity §7): weekly timesheet assembly,
// chart data builders (logged-vs-estimated, per-day sprint stack) and CSV
// rows. Ported from WPF TimeLoggedViewModel.

import type { DailyLogEntry, JiraIssue, TimeLoggedReport } from '../types';
import { addDays, fmtHours, formatDayLong, formatDayShort, parseYmd, startOfWeekSunday, ymd } from './viewFormat';

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

// ---------------------------------------------------------------------------
// Report periods → worklog date windows
// ---------------------------------------------------------------------------

export type ReportPeriod = 'today' | 'yesterday' | 'thisWeek' | 'previousWeek' | 'thisMonth' | 'customRange';

/**
 * Local [from, toExclusive) window for a Report period, as yyyy-MM-dd strings
 * for the /api/timelogged/range endpoint (worklogAuthor query — any issue the
 * user logged in the window, regardless of sprint). customTo is INCLUSIVE in
 * the UI, so it maps to customTo + 1 day.
 */
export function periodRange(
  period: ReportPeriod,
  now: Date,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return { from: ymd(day0), to: ymd(addDays(day0, 1)) };
    case 'yesterday':
      return { from: ymd(addDays(day0, -1)), to: ymd(day0) };
    case 'thisWeek': {
      const ws = startOfWeekSunday(day0);
      return { from: ymd(ws), to: ymd(addDays(ws, 7)) };
    }
    case 'previousWeek': {
      const ws = startOfWeekSunday(day0);
      return { from: ymd(addDays(ws, -7)), to: ymd(ws) };
    }
    case 'thisMonth':
      return {
        from: ymd(new Date(day0.getFullYear(), day0.getMonth(), 1)),
        to: ymd(new Date(day0.getFullYear(), day0.getMonth() + 1, 1)),
      };
    case 'customRange':
      return { from: customFrom, to: ymd(addDays(parseYmd(customTo), 1)) };
  }
}
