// My Work pure logic (ui-parity-contract.md §2) — cascading column filters,
// JQL rewrites, quick-filter clause swap, board params.

import { describe, expect, it } from 'vitest';
import {
  buildOptions,
  emptyMyWorkFilters,
  filterRows,
  matchesFilters,
  matchesFreeText,
} from '../src/lib/viewMyWorkFilters';
import {
  applyAssigneeFilter,
  applyQuickFilter,
  applySprintOnly,
  boardHash,
  boardModeJql,
  defaultMyWorkJql,
  parseBoardParams,
  splitOrderBy,
} from '../src/lib/viewMyWorkJql';

const row = (key: string, type: string, status: string, priority: string, assignee: string | null) => ({
  key,
  summary: `Summary of ${key}`,
  issueType: type,
  status,
  priority,
  assignee,
});

const rows = [
  row('ISW-1', 'Bug', 'Open', 'High', 'Alice'),
  row('ISW-2', 'Bug', 'In Progress', 'Low', 'Bob'),
  row('ISW-3', 'Task', 'Open', 'High', 'Alice'),
  row('ISW-4', 'Incident', 'Done', 'Medium', null),
];

describe('column filters (§2 filtering model)', () => {
  it('empty checked set = no constraint (matches all)', () => {
    const filters = emptyMyWorkFilters();
    expect(rows.every((r) => matchesFilters(r, filters))).toBe(true);
  });

  it('checked names constrain case-insensitively', () => {
    const filters = { ...emptyMyWorkFilters(), status: ['open'] };
    expect(matchesFilters(rows[0], filters)).toBe(true);
    expect(matchesFilters(rows[1], filters)).toBe(false);
  });

  it('options cascade from rows passing all *other* filters (gotcha 6)', () => {
    const filters = { ...emptyMyWorkFilters(), type: ['Bug'], status: ['Open'] };
    // Status options ignore the status constraint but respect type=Bug.
    expect(buildOptions(rows, filters, 'status')).toEqual(['In Progress', 'Open']);
    // Type options ignore the type constraint but respect status=Open.
    expect(buildOptions(rows, filters, 'type')).toEqual(['Bug', 'Task']);
    // Assignee options respect both.
    expect(buildOptions(rows, filters, 'assignee')).toEqual(['Alice']);
  });

  it('free text matches key OR summary, ci', () => {
    expect(matchesFreeText(rows[0], 'isw-1')).toBe(true);
    expect(matchesFreeText(rows[0], 'summary of isw-1')).toBe(true);
    expect(matchesFreeText(rows[0], 'nope')).toBe(false);
    expect(matchesFreeText(rows[0], '')).toBe(true);
  });

  it('filterRows = free text AND column filters', () => {
    const filters = { ...emptyMyWorkFilters(), type: ['Bug'] };
    expect(filterRows(rows, filters, 'isw').map((r) => r.key)).toEqual(['ISW-1', 'ISW-2']);
    expect(filterRows(rows, filters, 'isw-2').map((r) => r.key)).toEqual(['ISW-2']);
  });
});

describe('default / board JQL (§2, verbatim)', () => {
  it('default JQL', () => {
    expect(defaultMyWorkJql('ISW')).toBe(
      'project = ISW AND assignee = currentUser() AND statusCategory != Done' +
        ' ORDER BY Sprint ASC, updated DESC, created DESC',
    );
  });

  it('board JQL uses filter id; falls back to project when null', () => {
    expect(boardModeJql(123, 'ISW')).toBe(
      'filter = 123 AND statusCategory != Done ORDER BY Sprint ASC, updated DESC, created DESC',
    );
    expect(boardModeJql(null, 'ISW')).toBe(
      'project = ISW AND statusCategory != Done ORDER BY Sprint ASC, updated DESC, created DESC',
    );
  });
});

describe('applyAssigneeFilter (§2 JQL rewrite)', () => {
  it('strips currentUser clause, appends the picked user, reattaches ORDER BY', () => {
    const jql = defaultMyWorkJql('ISW');
    expect(applyAssigneeFilter(jql, 'Jane Doe')).toBe(
      'project = ISW AND statusCategory != Done AND assignee = "Jane Doe"' +
        ' ORDER BY Sprint ASC, updated DESC, created DESC',
    );
  });

  it('replaces an existing quoted assignee clause', () => {
    const once = applyAssigneeFilter(defaultMyWorkJql('ISW'), 'Jane Doe');
    const twice = applyAssigneeFilter(once, 'Bob');
    expect(twice).toContain('assignee = "Bob"');
    expect(twice).not.toContain('Jane Doe');
    expect((twice.match(/assignee/g) ?? []).length).toBe(1);
  });

  it('empty user strips the assignee clause without appending', () => {
    const cleared = applyAssigneeFilter(defaultMyWorkJql('ISW'), '');
    expect(cleared).toBe(
      'project = ISW AND statusCategory != Done ORDER BY Sprint ASC, updated DESC, created DESC',
    );
  });

  it('works on JQL without ORDER BY', () => {
    expect(applyAssigneeFilter('project = ISW', 'X')).toBe('project = ISW AND assignee = "X"');
  });
});

describe('applySprintOnly (board current-sprint scope)', () => {
  const base = 'project = ISW AND statusCategory != Done ORDER BY updated DESC';

  it('appends the openSprints clause before ORDER BY', () => {
    expect(applySprintOnly(base, true)).toBe(
      'project = ISW AND statusCategory != Done AND sprint in openSprints() ORDER BY updated DESC',
    );
  });

  it('removes the clause when toggled off', () => {
    expect(applySprintOnly(applySprintOnly(base, true), false)).toBe(base);
  });

  it('is idempotent when already applied', () => {
    const once = applySprintOnly(base, true);
    expect(applySprintOnly(once, true)).toBe(once);
  });
});

describe('applyQuickFilter (§2 quick-filter swap)', () => {
  const base = 'project = ISW AND statusCategory != Done ORDER BY updated DESC';

  it('appends AND ({q}) before ORDER BY', () => {
    expect(applyQuickFilter(base, 'assignee = "A"', null)).toBe(
      'project = ISW AND statusCategory != Done AND (assignee = "A") ORDER BY updated DESC',
    );
  });

  it('removes the previously appended quick clause first', () => {
    const one = applyQuickFilter(base, 'assignee = "A"', null);
    const two = applyQuickFilter(one, 'labels = hot', 'assignee = "A"');
    expect(two).toBe(
      'project = ISW AND statusCategory != Done AND (labels = hot) ORDER BY updated DESC',
    );
  });

  it('All chip (null query) removes only', () => {
    const one = applyQuickFilter(base, 'assignee = "A"', null);
    expect(applyQuickFilter(one, null, 'assignee = "A"')).toBe(base);
  });

  it('splitOrderBy is case-insensitive', () => {
    expect(splitOrderBy('a = b order by x')).toEqual({ body: 'a = b', orderBy: 'order by x' });
    expect(splitOrderBy('a = b')).toEqual({ body: 'a = b', orderBy: '' });
  });
});

describe('board route params', () => {
  it('parses #/mywork?board={id}&filter={fid}&name=', () => {
    expect(parseBoardParams('#/mywork?board=42&filter=99&name=My%20Board')).toEqual({
      boardId: 42,
      filterId: 99,
      name: 'My Board',
    });
    expect(parseBoardParams('#/mywork?board=42')).toEqual({ boardId: 42, filterId: null, name: '' });
  });

  it('rejects other routes / missing board id', () => {
    expect(parseBoardParams('#/mywork')).toBeNull();
    expect(parseBoardParams('#/dashboard?board=42')).toBeNull();
    expect(parseBoardParams('#/mywork?filter=99')).toBeNull();
  });

  it('round-trips through boardHash', () => {
    expect(parseBoardParams(boardHash(7, 12, 'Indigo Board'))).toEqual({
      boardId: 7,
      filterId: 12,
      name: 'Indigo Board',
    });
    expect(parseBoardParams(boardHash(7, null, ''))).toEqual({ boardId: 7, filterId: null, name: '' });
  });
});
