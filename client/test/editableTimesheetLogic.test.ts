import { describe, expect, it } from 'vitest';
import { buildEditableRows, clampToDayCap, parseCellInput, shouldBlurCommit } from '../src/lib/editableTimesheet';
import type { DailyLogEntry, JiraIssue } from '../src/types';

const issue = (p: Partial<JiraIssue>): JiraIssue => ({ ...(p as JiraIssue) });

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

describe('shouldBlurCommit', () => {
  it('commits when the cell was not cancelled', () => {
    expect(shouldBlurCommit(false)).toBe(true);
  });

  it('does NOT commit when Escape marked the cell cancelled (regression: stale-closure blur bug)', () => {
    expect(shouldBlurCommit(true)).toBe(false);
  });
});

describe('clampToDayCap', () => {
  it('passes the requested seconds through when under the cap', () => {
    expect(clampToDayCap(3600, 3600)).toBe(3600);
  });

  it('clamps to the remaining headroom when the add would exceed 24h', () => {
    expect(clampToDayCap(23 * 3600, 3 * 3600)).toBe(3600);
  });

  it('returns 0 when the day is already at/over the cap', () => {
    expect(clampToDayCap(24 * 3600, 3600)).toBe(0);
    expect(clampToDayCap(25 * 3600, 3600)).toBe(0);
  });
});
