import { describe, expect, it } from 'vitest';
import { KANBAN_COLUMNS, buildColumns, columnForStatus } from '../src/lib/kanban';
import type { JiraIssue } from '../src/types';

function mkIssue(key: string, status: string): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key,
    summary: `Summary ${key}`,
    issueType: 'Task',
    status,
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assignee: null,
    reporter: null,
    projectKey: 'ISW',
    sprint: null,
    created: '2026-08-01T00:00:00Z',
    updated: '2026-08-10T00:00:00Z',
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
  };
}

describe('KANBAN_COLUMNS (ui-parity §12.1)', () => {
  it('has the fixed order To Do, In Progress, On Hold, In Review, Done', () => {
    expect(KANBAN_COLUMNS.map((c) => c.title)).toEqual(['To Do', 'In Progress', 'On Hold', 'In Review', 'Done']);
  });
});

describe('columnForStatus', () => {
  it('matches lowercase substrings per column', () => {
    expect(columnForStatus('To Do')).toBe('To Do');
    expect(columnForStatus('Not Started')).toBe('To Do');
    expect(columnForStatus('Open')).toBe('To Do');
    expect(columnForStatus('Backlog')).toBe('To Do');
    expect(columnForStatus('NEW')).toBe('To Do');
    expect(columnForStatus('In Progress')).toBe('In Progress');
    expect(columnForStatus('On Hold')).toBe('On Hold');
    expect(columnForStatus('Blocked')).toBe('On Hold');
    expect(columnForStatus('Waiting for customer')).toBe('On Hold');
    expect(columnForStatus('In Review')).toBe('In Review');
    expect(columnForStatus('Verification')).toBe('In Review');
    expect(columnForStatus('Done')).toBe('Done');
    expect(columnForStatus('Closed')).toBe('Done');
    expect(columnForStatus('Delivered')).toBe('Done');
  });

  it('Reopened lands in To Do via the "open" substring', () => {
    expect(columnForStatus('Reopened')).toBe('To Do');
  });

  it('unmatched statuses fall into To Do', () => {
    expect(columnForStatus('Some Custom State')).toBe('To Do');
    expect(columnForStatus('')).toBe('To Do');
  });
});

describe('buildColumns', () => {
  it('always returns the 5 columns in fixed order, buckets preserve input order', () => {
    const cols = buildColumns([
      mkIssue('A-1', 'In Progress'),
      mkIssue('A-2', 'Open'),
      mkIssue('A-3', 'In Progress'),
      mkIssue('A-4', 'Peer Review'),
    ]);
    expect(cols.map((c) => c.title)).toEqual(['To Do', 'In Progress', 'On Hold', 'In Review', 'Done']);
    expect(cols[0].issues.map((i) => i.key)).toEqual(['A-2']);
    expect(cols[1].issues.map((i) => i.key)).toEqual(['A-1', 'A-3']);
    expect(cols[3].issues.map((i) => i.key)).toEqual(['A-4']);
    expect(cols[4].count).toBe(0);
  });

  it('countDisplay is "{n}" without a WIP limit', () => {
    const cols = buildColumns([mkIssue('A-1', 'In Progress'), mkIssue('A-2', 'In Progress')]);
    const inProgress = cols[1];
    expect(inProgress.countDisplay).toBe('2');
    expect(inProgress.wipLimit).toBeUndefined();
    expect(inProgress.isOverLimit).toBe(false);
  });

  it('WIP limit produces "{n} / {cap}" and over-limit flag when count > cap', () => {
    const cols = buildColumns(
      [mkIssue('A-1', 'In Progress'), mkIssue('A-2', 'In Progress')],
      { 'In Progress': 1 },
    );
    const inProgress = cols[1];
    expect(inProgress.countDisplay).toBe('2 / 1');
    expect(inProgress.isOverLimit).toBe(true);
  });

  it('count == cap is not over the limit', () => {
    const cols = buildColumns([mkIssue('A-1', 'In Progress')], { 'In Progress': 1 });
    expect(cols[1].countDisplay).toBe('1 / 1');
    expect(cols[1].isOverLimit).toBe(false);
  });

  it('non-positive caps are ignored', () => {
    const cols = buildColumns([mkIssue('A-1', 'In Progress')], { 'In Progress': 0 });
    expect(cols[1].wipLimit).toBeUndefined();
    expect(cols[1].countDisplay).toBe('1');
  });
});
