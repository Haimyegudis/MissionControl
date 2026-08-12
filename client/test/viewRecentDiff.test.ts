// Recent Updates change detection (ui-parity §6) — verbatim diff strings.

import { describe, expect, it } from 'vitest';
import {
  applyChangeDetection,
  diffChange,
  recentUpdatesJql,
  snapshotOf,
  type IssueSnapshot,
} from '../src/lib/viewRecentDiff';
import type { JiraIssue } from '../src/types';

function snap(partial: Partial<IssueSnapshot>): IssueSnapshot {
  return {
    updated: '2026-08-12T10:00:00.000+03:00',
    status: 'Open',
    assignee: 'Adir Takiar',
    priority: 'High',
    timeSpent: 3600,
    ...partial,
  };
}

function issue(partial: Partial<JiraIssue>): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key: 'ISW-1',
    summary: 'S',
    issueType: 'Bug',
    status: 'Open',
    statusCategory: 'new',
    priority: 'High',
    assignee: 'Adir Takiar',
    reporter: null,
    projectKey: 'ISW',
    sprint: null,
    created: '2026-08-01T00:00:00.000+03:00',
    updated: '2026-08-12T10:00:00.000+03:00',
    timeSpent: 3600,
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

describe('diffChange (§6 verbatim strings)', () => {
  it('unknown key → First seen, not recentlyChanged', () => {
    expect(diffChange(undefined, snap({}))).toEqual({ changeSummary: 'First seen', recentlyChanged: false });
  });

  it('status change', () => {
    const r = diffChange(snap({}), snap({ status: 'In Progress', updated: '2026-08-12T11:00:00.000+03:00' }));
    expect(r.changeSummary).toBe('Status: Open → In Progress');
    expect(r.recentlyChanged).toBe(true);
  });

  it('assignee change with null → —', () => {
    const r = diffChange(snap({ assignee: null }), snap({ assignee: 'Dana' }));
    expect(r.changeSummary).toBe('Assignee: — → Dana');
    const r2 = diffChange(snap({ assignee: 'Dana' }), snap({ assignee: null }));
    expect(r2.changeSummary).toBe('Assignee: Dana → —');
  });

  it('priority change', () => {
    expect(diffChange(snap({}), snap({ priority: 'Highest' })).changeSummary).toBe('Priority: High → Highest');
  });

  it('worklog delta formatted 0.##', () => {
    expect(diffChange(snap({ timeSpent: 3600 }), snap({ timeSpent: 9000 })).changeSummary).toBe('Worklog +1.5h');
    expect(diffChange(snap({ timeSpent: null }), snap({ timeSpent: 7200 })).changeSummary).toBe('Worklog +2h');
    expect(diffChange(snap({ timeSpent: 3600 }), snap({ timeSpent: 4800 })).changeSummary).toBe('Worklog +0.33h');
  });

  it('multiple diffs join with "; "', () => {
    const r = diffChange(snap({}), snap({ status: 'Done', priority: 'Low' }));
    expect(r.changeSummary).toBe('Status: Open → Done; Priority: High → Low');
  });

  it('updated changed with no field diff → Other field updated', () => {
    const r = diffChange(snap({}), snap({ updated: '2026-08-12T12:00:00.000+03:00' }));
    expect(r.changeSummary).toBe('Other field updated');
    expect(r.recentlyChanged).toBe(true);
  });

  it('nothing changed → null summary, not recentlyChanged', () => {
    expect(diffChange(snap({}), snap({}))).toEqual({ changeSummary: null, recentlyChanged: false });
  });
});

describe('applyChangeDetection', () => {
  it('stamps issues and advances the snapshot map', () => {
    const lastSeen = new Map();
    const first = issue({});
    applyChangeDetection(lastSeen, [first]);
    expect(first.changeSummary).toBe('First seen');
    expect(first.recentlyChanged).toBe(false);
    expect(lastSeen.get('ISW-1')).toEqual(snapshotOf(first));

    const second = issue({ status: 'Done', updated: '2026-08-12T13:00:00.000+03:00' });
    applyChangeDetection(lastSeen, [second]);
    expect(second.changeSummary).toBe('Status: Open → Done');
    expect(second.recentlyChanged).toBe(true);
    expect(lastSeen.get('ISW-1')!.status).toBe('Done');
  });
});

describe('recentUpdatesJql (§6 verbatim)', () => {
  it('current-user variant', () => {
    expect(recentUpdatesJql('')).toBe(
      'updated >= -7d AND (assignee = currentUser() OR reporter = currentUser() OR worklogAuthor = currentUser()) ORDER BY updated DESC',
    );
  });

  it('picked-user variant with quote escaping', () => {
    expect(recentUpdatesJql('Adir Takiar')).toBe(
      'updated >= -7d AND (assignee = "Adir Takiar" OR reporter = "Adir Takiar") ORDER BY updated DESC',
    );
    expect(recentUpdatesJql('O"Brien')).toBe(
      'updated >= -7d AND (assignee = "O\\"Brien" OR reporter = "O\\"Brien") ORDER BY updated DESC',
    );
  });
});
