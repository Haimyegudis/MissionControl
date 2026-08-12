// Dashboard view pure logic (ui-parity-contract.md §1).

import { describe, expect, it } from 'vitest';
import {
  countOnHold,
  dashboardSprintJql,
  formatHoursMinutes,
  KPI_DEFS,
  needsCloseDialog,
  pickTransition,
  resolveDashboardWidgets,
  sortSprintIssues,
  stampOriginalOrder,
} from '../src/lib/viewDashboard';
import type { JiraTransition } from '../src/types';

describe('resolveDashboardWidgets', () => {
  it('keeps settings order and maps ids to defs', () => {
    const defs = resolveDashboardWidgets(['LoggedToday', 'OpenIssues']);
    expect(defs.map((d) => d.id)).toEqual(['LoggedToday', 'OpenIssues']);
    expect(defs[0].title).toBe('Logged Today');
    expect(defs[0].color).toBe('#22D38F');
  });

  it("migrates legacy 'Blocked' to 'OnHold' on read", () => {
    const defs = resolveDashboardWidgets(['Blocked', 'Critical']);
    expect(defs.map((d) => d.id)).toEqual(['OnHold', 'Critical']);
    expect(defs[0].title).toBe('On Hold');
    expect(defs[0].color).toBe('#FFA13A');
  });

  it('drops unknown ids and duplicates; empty/null → empty', () => {
    expect(resolveDashboardWidgets(['Nope', 'OpenIssues', 'OpenIssues']).map((d) => d.id)).toEqual(['OpenIssues']);
    expect(resolveDashboardWidgets(['Blocked', 'OnHold']).map((d) => d.id)).toEqual(['OnHold']);
    expect(resolveDashboardWidgets([])).toEqual([]);
    expect(resolveDashboardWidgets(null)).toEqual([]);
  });

  it('catalog carries the exact §1 colors', () => {
    expect(KPI_DEFS.map((d) => [d.id, d.color])).toEqual([
      ['OpenIssues', '#1FE0E0'],
      ['Critical', '#EF4444'],
      ['OnHold', '#FFA13A'],
      ['UpdatedToday', '#FFD23A'],
      ['LoggedToday', '#22D38F'],
      ['LoggedThisWeek', '#7A5CFF'],
    ]);
  });
});

describe('formatHoursMinutes', () => {
  it('formats {h}h {mm}m', () => {
    expect(formatHoursMinutes(3661)).toBe('1h 01m');
    expect(formatHoursMinutes(0)).toBe('0h 00m');
    expect(formatHoursMinutes(null)).toBe('0h 00m');
    expect(formatHoursMinutes(2 * 3600 + 30 * 60)).toBe('2h 30m');
  });
});

describe('countOnHold', () => {
  it("counts statuses containing 'hold' (ci)", () => {
    expect(
      countOnHold([{ status: 'On Hold' }, { status: 'ON HOLD' }, { status: 'In Progress' }, { status: 'Open' }]),
    ).toBe(2);
  });
});

describe('dashboardSprintJql', () => {
  it('defaults to currentUser()', () => {
    expect(dashboardSprintJql('ISW', '')).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = currentUser()' +
        ' AND statusCategory != Done ORDER BY priority DESC, updated DESC',
    );
  });

  it('swaps in the picked user', () => {
    expect(dashboardSprintJql('ISW', 'Jane Doe')).toContain('assignee = "Jane Doe"');
    expect(dashboardSprintJql('ISW', 'Jane Doe')).not.toContain('currentUser()');
  });
});

describe('sortSprintIssues / stampOriginalOrder', () => {
  it('sorts IsStarred DESC then originalOrder', () => {
    const rows = [
      { key: 'A', isStarred: false, originalOrder: 0 },
      { key: 'B', isStarred: true, originalOrder: 3 },
      { key: 'C', isStarred: false, originalOrder: 1 },
      { key: 'D', isStarred: true, originalOrder: 2 },
    ];
    expect(sortSprintIssues(rows).map((r) => r.key)).toEqual(['D', 'B', 'A', 'C']);
  });

  it('stamps load order in place', () => {
    const rows = [{ originalOrder: 0 }, { originalOrder: 0 }, { originalOrder: 0 }];
    stampOriginalOrder(rows);
    expect(rows.map((r) => r.originalOrder)).toEqual([0, 1, 2]);
  });
});

describe('pickTransition (§1 drop match order)', () => {
  const t = (id: string, name: string, toStatus: string | null): JiraTransition => ({ id, name, toStatus });

  it('prefers exact ToStatus, then ToStatus contains, then Name contains', () => {
    const transitions = [
      t('1', 'Start work', 'In Progress Now'),
      t('2', 'Resume', 'In Progress'),
      t('3', 'Move to In Progress', 'Working'),
    ];
    expect(pickTransition(transitions, 'In Progress')?.id).toBe('2');
    expect(pickTransition([transitions[0], transitions[2]], 'In Progress')?.id).toBe('1'); // contains
    expect(pickTransition([transitions[2]], 'In Progress')?.id).toBe('3'); // name contains
  });

  it('is case-insensitive and returns null when nothing matches', () => {
    expect(pickTransition([t('1', 'Close', 'DONE')], 'Done')?.id).toBe('1');
    expect(pickTransition([t('1', 'Start', 'Open')], 'Done')).toBeNull();
    expect(pickTransition([], 'Done')).toBeNull();
  });
});

describe('needsCloseDialog heuristics', () => {
  it('hits on column title done/closed/resolved/reopen', () => {
    expect(needsCloseDialog('Done', 'Move')).toBe(true);
    expect(needsCloseDialog('Closed', 'Move')).toBe(true);
    expect(needsCloseDialog('Resolved items', 'Move')).toBe(true);
    expect(needsCloseDialog('Reopen', 'Move')).toBe(true);
  });

  it('hits on transition name close/resolve/reopen/reassign/fix', () => {
    expect(needsCloseDialog('In Progress', 'Close issue')).toBe(true);
    expect(needsCloseDialog('In Progress', 'Resolve')).toBe(true);
    expect(needsCloseDialog('In Progress', 'Reassign to dev')).toBe(true);
    expect(needsCloseDialog('In Progress', 'Fix it')).toBe(true);
  });

  it('misses on plain moves', () => {
    expect(needsCloseDialog('In Progress', 'Start work')).toBe(false);
    expect(needsCloseDialog('To Do', 'Back to backlog')).toBe(false);
  });
});
