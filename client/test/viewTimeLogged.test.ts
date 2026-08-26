// Time Spent pure logic (§7): timesheet, chart builders, CSV rows — plus the
// Boards helpers (§4) and shared view formatters.

import { describe, expect, it } from 'vitest';
import { filterIndigoBoards, formatBoardDiagnostics, searchBoards } from '../src/lib/viewBoards';
import {
  addDays,
  fmtHours,
  fmtHours1,
  formatDMmmYy,
  formatDayLong,
  formatDayShort,
  hoursDisplay,
  parseYmd,
  startOfWeekSunday,
  ymd,
} from '../src/lib/viewFormat';
import {
  ISSUES_CSV_HEADERS,
  aggregateDailyHours,
  buildLoggedVsEstimated,
  buildSprintDailyChart,
  buildTimesheet,
  dailyCsvRows,
  issuesCsvRow,
  loggedOnlyIssues,
  periodRange,
  timesheetHeaders,
} from '../src/lib/viewTimeLogged';
import type { DailyLogEntry, JiraBoard, JiraIssue, TimeLoggedReport } from '../src/types';

function issue(partial: Partial<JiraIssue>): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key: 'ISW-1',
    summary: 'Fix printer',
    issueType: 'Bug',
    status: 'Open',
    statusCategory: 'new',
    priority: 'High',
    assignee: null,
    reporter: null,
    projectKey: 'ISW',
    sprint: 'Sprint 42',
    created: '2026-08-01T00:00:00.000+03:00',
    updated: '2026-08-12T10:00:00.000+03:00',
    timeSpent: null,
    remainingEstimate: null,
    originalEstimate: null,
    epicKey: null,
    epicName: null,
    allSprints: [],
    workLoggedForPeriod: null,
    labels: [],
    components: [],
    fixVersions: [],
    boardNames: [],
    boardIds: [],
    isBlocked: false,
    isCritical: false,
    recentlyChanged: false,
    rejectReasons: null,
    changeSummary: null,
    severity: null,
    ...partial,
  };
}

function entry(day: string, issueKey: string, seconds: number, summary = 'Fix printer'): DailyLogEntry {
  return { day, issueKey, issueSummary: summary, timeSpent: seconds };
}

function report(partial: Partial<TimeLoggedReport>): TimeLoggedReport {
  return {
    issues: [],
    total: 0,
    fromUtc: '2026-08-09T00:00:00.000Z',
    toUtc: '2026-08-16T00:00:00.000Z',
    dailyByIssue: [],
    availableSprints: [],
    ...partial,
  };
}

describe('viewFormat', () => {
  it('fmtHours = 0.## / fmtHours1 = 0.#', () => {
    expect(fmtHours(1.5)).toBe('1.5');
    expect(fmtHours(2)).toBe('2');
    expect(fmtHours(0.333)).toBe('0.33');
    expect(fmtHours1(12.34)).toBe('12.3');
    expect(hoursDisplay(0)).toBe('0');
    expect(hoursDisplay(-1)).toBe('0');
    expect(hoursDisplay(2.25)).toBe('2.25');
  });

  it('ymd round-trip + week start (Sunday)', () => {
    const d = new Date(2026, 7, 12); // Wed 12 Aug 2026
    expect(ymd(d)).toBe('2026-08-12');
    expect(ymd(parseYmd('2026-08-12'))).toBe('2026-08-12');
    expect(ymd(startOfWeekSunday(d))).toBe('2026-08-09');
    expect(ymd(addDays(d, -91))).toBe('2026-05-13');
  });

  it('.NET-style day formats', () => {
    const d = new Date(2026, 7, 9); // Sun 9 Aug 2026
    expect(formatDayShort(d)).toBe('Sun 09 Aug');
    expect(formatDayLong(d)).toBe('Sun 09 Aug 2026');
    expect(formatDMmmYy(d)).toBe('9/Aug/26');
  });
});

describe('buildTimesheet (§7 weekly card)', () => {
  const weekStart = new Date(2026, 7, 9); // Sunday
  const r = report({
    issues: [issue({ key: 'ISW-2', summary: 'B' }), issue({ key: 'ISW-1', summary: 'A' })],
    dailyByIssue: [
      entry('2026-08-10', 'ISW-1', 3600),
      entry('2026-08-10', 'ISW-2', 1800),
      entry('2026-08-12', 'ISW-1', 7200),
      entry('2026-08-20', 'ISW-1', 3600), // outside the week — skipped
    ],
  });

  it('rows ordered by key, day cells + totals + weekly total', () => {
    const ts = buildTimesheet(weekStart, r);
    expect(ts.rows.map((x) => x.issueKey)).toEqual(['ISW-1', 'ISW-2']);
    expect(ts.rows[0].days).toEqual([0, 1, 0, 2, 0, 0, 0]);
    expect(ts.rows[0].loggedHours).toBe(3);
    expect(ts.rows[1].days).toEqual([0, 0.5, 0, 0, 0, 0, 0]);
    expect(ts.totals).toEqual([0, 1.5, 0, 2, 0, 0, 0]);
    expect(ts.weeklyTotalHours).toBe(3.5);
  });

  it('headers = dd over DDD', () => {
    const headers = timesheetHeaders(weekStart);
    expect(headers[0]).toEqual({ dayNumber: '09', dayLabel: 'SUN' });
    expect(headers[6]).toEqual({ dayNumber: '15', dayLabel: 'SAT' });
  });
});

describe('buildLoggedVsEstimated (§7 chart)', () => {
  it('skips zero/zero, flags over-estimate, verbatim tooltip', () => {
    const groups = buildLoggedVsEstimated([
      issue({ key: 'ISW-1', originalEstimate: 7200, remainingEstimate: 3600, timeSpent: 10800, epicKey: 'ISW-100' }),
      issue({ key: 'ISW-2' }), // both zero — skipped
      issue({ key: 'ISW-3', originalEstimate: 7200, timeSpent: 3600 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['ISW-1', 'ISW-3']);
    expect(groups[0].over).toBe(true);
    expect(groups[1].over).toBe(false);
    expect(groups[0].tooltip).toBe(
      'ISW-1  Fix printer\nEpic: ISW-100\nEstimated: 2 h\nRemaining: 1 h\nLogged: 3 h',
    );
    expect(groups[1].tooltip).toContain('Epic: —');
  });
});

describe('buildSprintDailyChart (§7 chart)', () => {
  it('series ordered by desc total, palette cycles, rows per ascending day', () => {
    const chart = buildSprintDailyChart([
      entry('2026-08-11', 'ISW-1', 3600, 'A'),
      entry('2026-08-10', 'ISW-2', 14400, 'B'),
      entry('2026-08-11', 'ISW-2', 3600, 'B'),
    ]);
    expect(chart.series.map((s) => s.name)).toEqual(['ISW-2', 'ISW-1']);
    expect(chart.series[0].color).toBe('#4F46E5');
    expect(chart.series[1].color).toBe('#10B981');
    expect(chart.rows.map((r) => r.label)).toEqual(['Mon 10 Aug', 'Tue 11 Aug']);
    expect(chart.rows[0].values).toEqual([4, 0]);
    expect(chart.rows[1].values).toEqual([1, 1]);
    expect(chart.rows[1].tooltips[1]).toBe('Tue 11 Aug 2026\nISW-1  A\nLogged: 1 h');
  });
});

describe('CSV aggregation (§7 exports)', () => {
  it('issues CSV row: verbatim headers, hours 0.##', () => {
    expect([...ISSUES_CSV_HEADERS]).toEqual([
      'Key',
      'Summary',
      'Status',
      'Sprint',
      'WorkLoggedHours',
      'TotalSpentHours',
      'EstimatedHours',
      'RemainingHours',
    ]);
    const row = issuesCsvRow(
      issue({ workLoggedForPeriod: 5400, timeSpent: 9000, originalEstimate: 7200, remainingEstimate: null }),
    );
    expect(row).toEqual(['ISW-1', 'Fix printer', 'Open', 'Sprint 42', '1.5', '2.5', '2', '0']);
  });

  it('aggregateDailyHours + dailyCsvRows sorted by day', () => {
    const hours = aggregateDailyHours([
      entry('2026-08-11', 'ISW-1', 3600),
      entry('2026-08-10', 'ISW-2', 1800),
      entry('2026-08-11', 'ISW-2', 1800),
    ]);
    expect(hours['2026-08-11']).toBe(1.5);
    expect(dailyCsvRows(hours)).toEqual([
      ['2026-08-10', '0.5'],
      ['2026-08-11', '1.5'],
    ]);
  });
});

describe('loggedOnlyIssues', () => {
  it('drops zero and null workLoggedForPeriod, keeps positive', () => {
    const zero = issue({ key: 'ISW-1', workLoggedForPeriod: 0 });
    const nullLogged = issue({ key: 'ISW-2', workLoggedForPeriod: null });
    const positive = issue({ key: 'ISW-3', workLoggedForPeriod: 3600 });
    expect(loggedOnlyIssues([zero, nullLogged, positive])).toEqual([positive]);
  });
});

describe('viewBoards (§4)', () => {
  const board = (partial: Partial<JiraBoard>): JiraBoard => ({
    id: 1,
    name: 'Indigo SW',
    type: 'scrum',
    projectKey: null,
    projectName: null,
    filterId: null,
    filterName: null,
    ...partial,
  });

  it('filters to names containing "indigo" (ci)', () => {
    const boards = [board({ id: 1, name: 'HP INDIGO Board' }), board({ id: 2, name: 'Other Board' })];
    expect(filterIndigoBoards(boards).map((b) => b.id)).toEqual([1]);
  });

  it('search matches Name OR FilterName (ci)', () => {
    const boards = [
      board({ id: 1, name: 'Indigo SW' }),
      board({ id: 2, name: 'Indigo HW', filterName: 'Press filter' }),
    ];
    expect(searchBoards(boards, 'sw').map((b) => b.id)).toEqual([1]);
    expect(searchBoards(boards, 'press').map((b) => b.id)).toEqual([2]);
    expect(searchBoards(boards, '').map((b) => b.id)).toEqual([1, 2]);
  });

  it('diagnostics line verbatim; source segments omitted when unknown', () => {
    expect(
      formatBoardDiagnostics({
        fromGreenhopper: 12,
        fromAgile: 30,
        greenhopperError: null,
        agileError: 'boom',
        total: 40,
        indigoCount: 7,
      }),
    ).toBe('Greenhopper: 12  |  Agile: 30 (boom)  |  All: 40  |  Indigo only: 7');
    expect(
      formatBoardDiagnostics({
        fromGreenhopper: null,
        fromAgile: null,
        greenhopperError: null,
        agileError: null,
        total: 40,
        indigoCount: 7,
      }),
    ).toBe('All: 40  |  Indigo only: 7');
  });
});

describe('periodRange', () => {
  // Wed Aug 26 2026.
  const now = new Date(2026, 7, 26, 14, 30);
  const pr = (p: Parameters<typeof periodRange>[0]) => periodRange(p, now, '2026-08-01', '2026-08-10');

  it('today / yesterday are single-day exclusive windows', () => {
    expect(pr('today')).toEqual({ from: '2026-08-26', to: '2026-08-27' });
    expect(pr('yesterday')).toEqual({ from: '2026-08-25', to: '2026-08-26' });
  });

  it('weeks start Sunday; previous week ends where this week starts', () => {
    expect(pr('thisWeek')).toEqual({ from: '2026-08-23', to: '2026-08-30' });
    expect(pr('previousWeek')).toEqual({ from: '2026-08-16', to: '2026-08-23' });
  });

  it('this month spans the calendar month', () => {
    expect(pr('thisMonth')).toEqual({ from: '2026-08-01', to: '2026-09-01' });
  });

  it('custom range treats the to-date as inclusive', () => {
    expect(pr('customRange')).toEqual({ from: '2026-08-01', to: '2026-08-11' });
  });
});
