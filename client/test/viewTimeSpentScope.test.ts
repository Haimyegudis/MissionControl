import { describe, expect, it } from 'vitest';
import {
  buildEditableRows,
  parseCellInput,
  scopeWindow,
  stepAnchor,
  viewsForScope,
  windowDays,
} from '../src/lib/viewTimeSpentScope';
import type { DailyLogEntry, JiraIssue } from '../src/types';

const issue = (p: Partial<JiraIssue>): JiraIssue => ({ ...(p as JiraIssue) });

describe('scopeWindow', () => {
  it('day: [anchor, anchor+1) with a "ddd dd MMM yyyy" label', () => {
    const w = scopeWindow('day', new Date(2026, 7, 26), '', '');
    expect(w).toEqual({ from: '2026-08-26', to: '2026-08-27', label: 'Wed 26 Aug 2026' });
  });

  it('week: Sunday-first 7 days, label "23 Aug – 29 Aug 2026"', () => {
    // Aug 26 2026 is a Wednesday; the containing week is Sun Aug 23 - Sat Aug 29.
    const w = scopeWindow('week', new Date(2026, 7, 26), '', '');
    expect(w).toEqual({ from: '2026-08-23', to: '2026-08-30', label: '23 Aug – 29 Aug 2026' });
  });

  it('week: spans a month boundary correctly', () => {
    // Sep 1 2026 is a Tuesday; the containing week is Sun Aug 30 - Sat Sep 5.
    const w = scopeWindow('week', new Date(2026, 8, 1), '', '');
    expect(w).toEqual({ from: '2026-08-30', to: '2026-09-06', label: '30 Aug – 05 Sep 2026' });
  });

  it('month: calendar month, label "August 2026"', () => {
    const w = scopeWindow('month', new Date(2026, 7, 26), '', '');
    expect(w).toEqual({ from: '2026-08-01', to: '2026-09-01', label: 'August 2026' });
  });

  it('custom: [customFrom, customTo+1) inclusive, label "01 Aug – 10 Aug 2026"', () => {
    const w = scopeWindow('custom', new Date(2026, 7, 26), '2026-08-01', '2026-08-10');
    expect(w).toEqual({ from: '2026-08-01', to: '2026-08-11', label: '01 Aug – 10 Aug 2026' });
  });

  it('custom: single-day range', () => {
    const w = scopeWindow('custom', new Date(2026, 7, 26), '2026-08-05', '2026-08-05');
    expect(w).toEqual({ from: '2026-08-05', to: '2026-08-06', label: '05 Aug – 05 Aug 2026' });
  });
});

describe('stepAnchor', () => {
  it('day: +1 / -1', () => {
    expect(stepAnchor('day', new Date(2026, 7, 26), 1)).toEqual(new Date(2026, 7, 27));
    expect(stepAnchor('day', new Date(2026, 7, 26), -1)).toEqual(new Date(2026, 7, 25));
  });

  it('week: +7 / -7', () => {
    expect(stepAnchor('week', new Date(2026, 7, 26), 1)).toEqual(new Date(2026, 8, 2));
    expect(stepAnchor('week', new Date(2026, 7, 26), -1)).toEqual(new Date(2026, 7, 19));
  });

  it('month: next/prev month, normalized to the 1st (no overflow on long months)', () => {
    expect(stepAnchor('month', new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 1));
    expect(stepAnchor('month', new Date(2026, 7, 26), -1)).toEqual(new Date(2026, 6, 1));
  });
});

describe('viewsForScope', () => {
  it('day/week/custom: timesheet, summary, epics', () => {
    expect(viewsForScope('day')).toEqual(['timesheet', 'summary', 'epics']);
    expect(viewsForScope('week')).toEqual(['timesheet', 'summary', 'epics']);
    expect(viewsForScope('custom')).toEqual(['timesheet', 'summary', 'epics']);
  });

  it('month: hides timesheet, adds calendar', () => {
    expect(viewsForScope('month')).toEqual(['summary', 'epics', 'calendar']);
  });

  it('sprint: adds board', () => {
    expect(viewsForScope('sprint')).toEqual(['timesheet', 'summary', 'epics', 'board']);
  });
});

describe('windowDays', () => {
  it('lists yyyy-MM-dd days from from (inclusive) to to (exclusive)', () => {
    expect(windowDays({ from: '2026-08-23', to: '2026-08-30' })).toEqual([
      '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29',
    ]);
  });

  it('empty when from === to', () => {
    expect(windowDays({ from: '2026-08-23', to: '2026-08-23' })).toEqual([]);
  });

  it('caps at 62 entries for absurd ranges', () => {
    const days = windowDays({ from: '2020-01-01', to: '2030-01-01' });
    expect(days).toHaveLength(62);
    expect(days[0]).toBe('2020-01-01');
  });
});

describe('buildEditableRows', () => {
  const days = ['2026-08-23', '2026-08-24'];

  it('logged rows first (sorted by key), hours summed per day from dailyByIssue', () => {
    const report = {
      issues: [
        issue({ key: 'B-2', summary: 'second' }),
        issue({ key: 'A-1', summary: 'first' }),
      ],
      dailyByIssue: [
        { issueKey: 'A-1', day: '2026-08-23', timeSpent: 3600, issueSummary: 'first' } as DailyLogEntry,
        { issueKey: 'A-1', day: '2026-08-23', timeSpent: 1800, issueSummary: 'first' } as DailyLogEntry,
        { issueKey: 'A-1', day: '2026-08-24', timeSpent: 7200, issueSummary: 'first' } as DailyLogEntry,
        { issueKey: 'B-2', day: '2026-08-24', timeSpent: 3600, issueSummary: 'second' } as DailyLogEntry,
      ],
    };
    const rows = buildEditableRows(days, report, [], []);
    expect(rows.map((r) => r.key)).toEqual(['A-1', 'B-2']);
    expect(rows[0]).toEqual({ key: 'A-1', summary: 'first', hours: [1.5, 2], totalHours: 3.5, empty: false });
    expect(rows[1]).toEqual({ key: 'B-2', summary: 'second', hours: [0, 1], totalHours: 1, empty: false });
  });

  it('sprint-only rows come after logged rows, sorted by key, marked empty', () => {
    const report = { issues: [issue({ key: 'A-1', summary: 'first' })], dailyByIssue: [] as DailyLogEntry[] };
    const sprintIssues = [issue({ key: 'C-3', summary: 'third' }), issue({ key: 'B-2', summary: 'second' })];
    const rows = buildEditableRows(days, report, sprintIssues, []);
    expect(rows.map((r) => r.key)).toEqual(['A-1', 'B-2', 'C-3']);
    expect(rows[1]).toEqual({ key: 'B-2', summary: 'second', hours: [0, 0], totalHours: 0, empty: true });
    expect(rows[2].empty).toBe(true);
  });

  it('manual rows come last', () => {
    const rows = buildEditableRows(days, null, [], [{ key: 'M-1', summary: 'manual one' }]);
    expect(rows).toEqual([{ key: 'M-1', summary: 'manual one', hours: [0, 0], totalHours: 0, empty: true }]);
  });

  it('dedupes by key across logged/sprint/manual — logged wins', () => {
    const report = {
      issues: [issue({ key: 'A-1', summary: 'logged summary' })],
      dailyByIssue: [{ issueKey: 'A-1', day: '2026-08-23', timeSpent: 3600, issueSummary: 'logged summary' } as DailyLogEntry],
    };
    const sprintIssues = [issue({ key: 'A-1', summary: 'sprint summary' })];
    const manual = [{ key: 'A-1', summary: 'manual summary' }];
    const rows = buildEditableRows(days, report, sprintIssues, manual);
    expect(rows).toEqual([{ key: 'A-1', summary: 'logged summary', hours: [1, 0], totalHours: 1, empty: false }]);
  });

  it('null report → no logged rows, still handles sprint + manual', () => {
    const rows = buildEditableRows(days, null, [issue({ key: 'S-1', summary: 'sprint' })], [{ key: 'M-1', summary: 'manual' }]);
    expect(rows.map((r) => r.key)).toEqual(['S-1', 'M-1']);
  });
});

describe('parseCellInput', () => {
  it('empty/garbage → null', () => {
    expect(parseCellInput('')).toBeNull();
    expect(parseCellInput('   ')).toBeNull();
    expect(parseCellInput('abc')).toBeNull();
  });

  it('plain int/decimal hours in (0, 24] → seconds', () => {
    expect(parseCellInput('2')).toBe(7200);
    expect(parseCellInput('1.5')).toBe(5400);
    expect(parseCellInput('24')).toBe(86400);
  });

  it('"2h 30m" and similar → parseJiraTime seconds', () => {
    expect(parseCellInput('2h 30m')).toBe(9000);
    expect(parseCellInput('45m')).toBe(2700);
  });

  it('zero or negative → null', () => {
    expect(parseCellInput('0')).toBeNull();
    expect(parseCellInput('-3')).toBeNull();
  });

  it('out-of-range plain number falls through to parseJiraTime (bare number = hours, uncapped)', () => {
    expect(parseCellInput('25')).toBe(90000);
  });
});
