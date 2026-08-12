// Team Dashboard pure logic (ui-parity §9): normalize / counters / hours /
// sorting / concurrency gate.

import { describe, expect, it } from 'vitest';
import {
  computeTeamRows,
  mapWithConcurrency,
  matchesMember,
  normalizeMember,
  otherCount,
} from '../src/lib/viewTeam';
import type { JiraIssue } from '../src/types';

function issue(partial: Partial<JiraIssue>): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key: 'ISW-1',
    summary: 'S',
    issueType: 'Feature',
    status: 'Open',
    statusCategory: 'new',
    priority: 'High',
    assignee: null,
    reporter: null,
    projectKey: 'ISW',
    sprint: null,
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

describe('normalizeMember (§9 fuzzy matching)', () => {
  it('local part before @, strip non-alnum, lowercase', () => {
    expect(normalizeMember('Adir Takiar')).toBe('adirtakiar');
    expect(normalizeMember('adir.takiar@hp.com')).toBe('adirtakiar');
    expect(normalizeMember('adir.takiar')).toBe('adirtakiar');
    expect(normalizeMember('')).toBe('');
    expect(normalizeMember(null)).toBe('');
  });

  it('matchesMember equates all spellings', () => {
    expect(matchesMember('adir.takiar@hp.com', 'Adir Takiar')).toBe(true);
    expect(matchesMember('Dana Lev', 'Adir Takiar')).toBe(false);
    expect(matchesMember(null, 'Adir Takiar')).toBe(false);
    expect(matchesMember('', '')).toBe(false);
  });
});

describe('computeTeamRows', () => {
  const members = ['Adir Takiar', 'Dana Lev'];
  const issues = [
    issue({ key: 'ISW-1', assignee: 'adir.takiar@hp.com', status: 'In Progress', originalEstimate: 7200, timeSpent: 3600 }),
    issue({ key: 'ISW-2', assignee: 'Adir Takiar', status: 'On Hold', remainingEstimate: 3600 }),
    issue({ key: 'ISW-3', assignee: 'Adir Takiar', status: 'Done' }),
    issue({ key: 'ISW-4', assignee: 'Dana Lev', status: 'In Review' }),
    issue({ key: 'ISW-5', assignee: 'Somebody Else', status: 'Open' }),
  ];

  it('counters by status substring; done/closed excluded from open', () => {
    const rows = computeTeamRows(members, issues);
    const adir = rows.find((r) => r.member === 'Adir Takiar')!;
    expect(adir.openCount).toBe(2);
    expect(adir.doneCount).toBe(1);
    expect(adir.inProgress).toBe(1);
    expect(adir.onHold).toBe(1);
    expect(adir.inReview).toBe(0);
    expect(adir.estimatedHours).toBe(2);
    expect(adir.remainingHours).toBe(1);
    expect(adir.loggedHours).toBe(1);
  });

  it('sorts OpenCount DESC and keeps every member (zero rows too)', () => {
    const rows = computeTeamRows([...members, 'Nobody Here'], issues);
    expect(rows.map((r) => r.member)).toEqual(['Adir Takiar', 'Dana Lev', 'Nobody Here']);
    expect(rows[2].openCount).toBe(0);
    expect(rows[2].issues).toEqual([]);
  });

  it('non-member assignees are ignored', () => {
    const rows = computeTeamRows(members, issues);
    expect(rows.flatMap((r) => r.issues.map((i) => i.key))).not.toContain('ISW-5');
  });

  it('otherCount = max(0, open − IP − IR − OH)', () => {
    const rows = computeTeamRows(['Adir Takiar'], [
      issue({ key: 'A', assignee: 'Adir Takiar', status: 'Open' }),
      issue({ key: 'B', assignee: 'Adir Takiar', status: 'In Progress' }),
    ]);
    expect(otherCount(rows[0])).toBe(1);
    const held = computeTeamRows(['Adir Takiar'], [
      issue({ key: 'C', assignee: 'Adir Takiar', status: 'On Hold' }),
    ]);
    expect(otherCount(held[0])).toBe(0);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order and honors the gate', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
