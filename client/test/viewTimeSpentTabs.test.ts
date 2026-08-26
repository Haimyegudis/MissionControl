import { describe, expect, it } from 'vitest';
import {
  activeSprintRange,
  buildCalendarMonth,
  formatEpicTotal,
  groupByEpic,
  pickStartTransition,
  sprintBars,
} from '../src/lib/viewTimeSpentTabs';
import type { DailyLogEntry, JiraIssue, JiraTransition } from '../src/types';

const issue = (p: Partial<JiraIssue>): JiraIssue => ({ ...(p as JiraIssue) });

describe('buildCalendarMonth', () => {
  const daily: DailyLogEntry[] = [
    { issueKey: 'A-1', day: '2026-08-03', timeSpent: 7200 } as DailyLogEntry,
    { issueKey: 'A-2', day: '2026-08-03', timeSpent: 3600 } as DailyLogEntry,
    { issueKey: 'A-1', day: '2026-08-26', timeSpent: 28800 } as DailyLogEntry,
  ];
  const month = buildCalendarMonth(2026, 7, daily, { start: '2026-08-23', end: '2026-09-10' }, new Date(2026, 7, 26));

  it('lays out full Sunday-first weeks covering the month', () => {
    expect(month.monthLabel).toBe('August 2026');
    expect(month.weeks.length).toBeGreaterThanOrEqual(5);
    for (const w of month.weeks) expect(w).toHaveLength(7);
    // Aug 1 2026 is a Saturday — first row starts Sun Jul 26.
    expect(month.weeks[0][0].day).toBe('2026-07-26');
    expect(month.weeks[0][6].day).toBe('2026-08-01');
    expect(month.weeks[0][6].inMonth).toBe(true);
    expect(month.weeks[0][0].inMonth).toBe(false);
  });

  it('aggregates entries per day sorted by hours desc, with totals', () => {
    const aug3 = month.weeks.flat().find((c) => c.day === '2026-08-03')!;
    expect(aug3.entries).toEqual([
      { issueKey: 'A-1', hours: 2 },
      { issueKey: 'A-2', hours: 1 },
    ]);
    expect(aug3.totalHours).toBe(3);
  });

  it('marks today and sprint-range cells', () => {
    const aug26 = month.weeks.flat().find((c) => c.day === '2026-08-26')!;
    expect(aug26.isToday).toBe(true);
    expect(aug26.inSprint).toBe(true);
    const aug22 = month.weeks.flat().find((c) => c.day === '2026-08-22')!;
    expect(aug22.inSprint).toBe(false);
  });
});

describe('activeSprintRange', () => {
  it('returns the first active sprint with dates', () => {
    const issues = [
      issue({ allSprints: [{ name: 'S1', state: 'closed', startDate: '2026-08-01', endDate: '2026-08-14' }] }),
      issue({
        allSprints: [{ name: 'S2', state: 'active', startDate: '2026-08-23T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z' }],
      }),
    ];
    expect(activeSprintRange(issues)).toEqual({ name: 'S2', start: '2026-08-23', end: '2026-09-10' });
  });
  it('returns null when no active sprint has dates', () => {
    expect(activeSprintRange([issue({ allSprints: [{ name: 'S', state: 'active', startDate: null, endDate: null }] })])).toBeNull();
    expect(activeSprintRange([])).toBeNull();
  });
});

describe('groupByEpic', () => {
  it('groups logged issues by epic, sorted by total desc, no-epic last', () => {
    const groups = groupByEpic([
      issue({ key: 'A-1', summary: 's1', epicKey: 'E-1', epicName: 'Epic One', workLoggedForPeriod: 3600 }),
      issue({ key: 'A-2', summary: 's2', epicKey: 'E-2', epicName: 'Epic Two', workLoggedForPeriod: 7200 }),
      issue({ key: 'A-3', summary: 's3', epicKey: 'E-1', epicName: 'Epic One', workLoggedForPeriod: 1800 }),
      issue({ key: 'A-4', summary: 's4', epicKey: null, epicName: null, workLoggedForPeriod: 60 }),
      issue({ key: 'A-5', summary: 's5', epicKey: 'E-3', epicName: 'Empty', workLoggedForPeriod: 0 }),
    ]);
    expect(groups.map((g) => g.epicKey)).toEqual(['E-2', 'E-1', null]);
    expect(groups[1].totalSeconds).toBe(5400);
    expect(groups[1].issues.map((i) => i.key)).toEqual(['A-1', 'A-3']);
    expect(groups[2].epicName).toBe('No epic');
  });
});

describe('formatEpicTotal', () => {
  it('formats hours and 8h-days', () => {
    expect(formatEpicTotal(52 * 3600)).toBe('52.00 hours (6.50 days @ 8h/day)');
    expect(formatEpicTotal(0)).toBe('0.00 hours (0.00 days @ 8h/day)');
  });
});

describe('sprintBars', () => {
  it('scales bars to the row max', () => {
    const bars = sprintBars(issue({ originalEstimate: 28800, timeSpent: 14400, remainingEstimate: 14400 }));
    expect(bars.estimatedPct).toBe(100);
    expect(bars.loggedPct).toBe(50);
    expect(bars.remainingPct).toBe(50);
  });
  it('all zero → zero widths', () => {
    const bars = sprintBars(issue({ originalEstimate: null, timeSpent: null, remainingEstimate: null }));
    expect(bars).toMatchObject({ estimatedPct: 0, loggedPct: 0, remainingPct: 0 });
  });
});

describe('pickStartTransition', () => {
  const t = (id: string, name: string, toStatus: string | null): JiraTransition => ({ id, name, toStatus });
  it('prefers exact toStatus "In Progress" (case-insensitive)', () => {
    expect(pickStartTransition([t('1', 'Reject', 'Rejected'), t('2', 'Start', 'in progress')])?.id).toBe('2');
  });
  it('falls back to toStatus or name containing "progress"', () => {
    expect(pickStartTransition([t('1', 'Go', 'Dev In Progress')])?.id).toBe('1');
    expect(pickStartTransition([t('1', 'Move to progress', null)])?.id).toBe('1');
  });
  it('null when nothing matches', () => {
    expect(pickStartTransition([t('1', 'Close', 'Done')])).toBeNull();
  });
});
