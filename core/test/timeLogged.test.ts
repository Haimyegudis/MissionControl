import { describe, it, expect } from 'vitest';
import { JiraSession } from '../src/jira/session.js';
import {
  TimeLoggedService,
  resolvePeriodRange,
  startOfWeek,
  type IssueSearcher,
  type WorklogFetcher,
} from '../src/jira/timeLogged.js';
import { DashboardAggregator } from '../src/jira/aggregator.js';
import type { JiraIssue, JiraWorklog, SprintInfo, PagedResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(): JiraSession {
  const session = new JiraSession();
  session.activate(
    {
      email: 'me@example.com',
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'secret-pat',
      instanceType: 'datacenter',
      defaultProjectKey: 'ISW',
    },
    { accountId: 'me-123', displayName: 'Me Person', emailAddress: null, avatarUrl: null, active: true },
  );
  return session;
}

function makeIssue(key: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key,
    summary: `Summary ${key}`,
    issueType: 'Task',
    status: 'Open',
    statusCategory: 'new',
    priority: 'Medium',
    assignee: 'Me Person',
    reporter: null,
    projectKey: 'ISW',
    sprint: null,
    created: '2026-08-01T10:00:00+03:00',
    updated: '2026-08-10T12:00:00+03:00',
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
    ...overrides,
  };
}

let worklogSeq = 0;
function makeWorklog(
  issueKey: string,
  started: Date,
  timeSpent: number,
  author = 'Me Person',
  authorAccountId: string | null = 'me-123',
): JiraWorklog {
  return {
    id: `wl-${++worklogSeq}`,
    issueKey,
    author,
    authorAccountId,
    started: started.toISOString(),
    timeSpent,
    comment: null,
  };
}

/** Issue searcher mock — routes JQL to canned results, records calls. */
function makeSearcher(handler: (jql: string) => JiraIssue[]): IssueSearcher & {
  calls: Array<{ jql: string; hardCap: number }>;
} {
  const calls: Array<{ jql: string; hardCap: number }> = [];
  return {
    calls,
    async searchAll(jql: string, hardCap: number): Promise<JiraIssue[]> {
      calls.push({ jql, hardCap });
      return handler(jql);
    },
  };
}

function makeWorklogFetcher(byKey: Record<string, JiraWorklog[]>): WorklogFetcher & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async getWorklogs(issueKey: string): Promise<JiraWorklog[]> {
      calls.push(issueKey);
      return byKey[issueKey] ?? [];
    },
  };
}

function sprint(name: string, state: string, startDate: string | null = null, endDate: string | null = null): SprintInfo {
  return { name, state, startDate, endDate };
}

// Wednesday 2026-08-12 (local)
const TODAY = new Date(2026, 7, 12);
const NOW = () => new Date(2026, 7, 12, 15, 30, 0);

function service(
  searcher: IssueSearcher,
  worklogs: WorklogFetcher,
  session = makeSession(),
): TimeLoggedService {
  return new TimeLoggedService(session, searcher, worklogs, NOW);
}

// ---------------------------------------------------------------------------
// Period range math
// ---------------------------------------------------------------------------

describe('resolvePeriodRange', () => {
  it('today / yesterday are single local days, to-exclusive', () => {
    expect(resolvePeriodRange('today', TODAY)).toEqual({
      from: new Date(2026, 7, 12),
      to: new Date(2026, 7, 13),
    });
    expect(resolvePeriodRange('yesterday', TODAY)).toEqual({
      from: new Date(2026, 7, 11),
      to: new Date(2026, 7, 12),
    });
  });

  it('thisWeek starts on Sunday and spans 7 days', () => {
    // 2026-08-12 is a Wednesday → week starts Sunday 2026-08-09
    expect(resolvePeriodRange('thisWeek', TODAY)).toEqual({
      from: new Date(2026, 7, 9),
      to: new Date(2026, 7, 16),
    });
    // A Sunday is its own week start
    expect(startOfWeek(new Date(2026, 7, 9))).toEqual(new Date(2026, 7, 9));
    // A Saturday belongs to the week that started 6 days earlier
    expect(startOfWeek(new Date(2026, 7, 15))).toEqual(new Date(2026, 7, 9));
  });

  it('previousWeek is the 7 days before startOfWeek', () => {
    expect(resolvePeriodRange('previousWeek', TODAY)).toEqual({
      from: new Date(2026, 7, 2),
      to: new Date(2026, 7, 9),
    });
  });

  it('thisMonth spans first-of-month to first-of-next-month', () => {
    expect(resolvePeriodRange('thisMonth', TODAY)).toEqual({
      from: new Date(2026, 7, 1),
      to: new Date(2026, 8, 1),
    });
    // month rollover (December → January)
    expect(resolvePeriodRange('thisMonth', new Date(2026, 11, 15))).toEqual({
      from: new Date(2026, 11, 1),
      to: new Date(2027, 0, 1),
    });
  });

  it('customRange uses provided dates, defaulting to [today, today+1d)', () => {
    expect(
      resolvePeriodRange('customRange', TODAY, new Date(2026, 7, 3, 9, 45), new Date(2026, 7, 6, 18, 0)),
    ).toEqual({ from: new Date(2026, 7, 3), to: new Date(2026, 7, 6) });
    expect(resolvePeriodRange('customRange', TODAY)).toEqual({
      from: new Date(2026, 7, 12),
      to: new Date(2026, 7, 13),
    });
    expect(resolvePeriodRange('customRange', TODAY, new Date(2026, 7, 10), null)).toEqual({
      from: new Date(2026, 7, 10),
      to: new Date(2026, 7, 13),
    });
  });
});

// ---------------------------------------------------------------------------
// buildReport (period report)
// ---------------------------------------------------------------------------

describe('TimeLoggedService.buildReport', () => {
  it('uses the default JQL (cap 500) when extraJql is blank, extraJql verbatim otherwise', async () => {
    const searcher = makeSearcher(() => []);
    const svc = service(searcher, makeWorklogFetcher({}));

    await svc.buildReport('today');
    expect(searcher.calls[0]).toEqual({
      jql: 'project = ISW AND sprint in openSprints() AND assignee = currentUser() AND issuetype != Incident ORDER BY updated DESC',
      hardCap: 500,
    });

    await svc.buildReport('today', null, null, 'assignee = currentUser()');
    expect(searcher.calls[1].jql).toBe('assignee = currentUser()');
  });

  it('matches worklog authors by accountId (ci) or displayName (ci)', async () => {
    const day = new Date(2026, 7, 12, 10, 0);
    const searcher = makeSearcher(() => [makeIssue('ISW-1')]);
    const worklogs = makeWorklogFetcher({
      'ISW-1': [
        makeWorklog('ISW-1', day, 3600, 'Somebody Else', 'ME-123'), // accountId match (ci)
        makeWorklog('ISW-1', day, 1800, 'me person', null), // displayName match (ci)
        makeWorklog('ISW-1', day, 900, 'Other Person', 'other-999'), // no match
      ],
    });
    const report = await service(searcher, worklogs).buildReport('today');
    expect(report.issues[0].workLoggedForPeriod).toBe(5400);
    expect(report.total).toBe(5400);
  });

  it('excludes worklogs outside the period range', async () => {
    const searcher = makeSearcher(() => [makeIssue('ISW-1')]);
    const worklogs = makeWorklogFetcher({
      'ISW-1': [
        makeWorklog('ISW-1', new Date(2026, 7, 12, 0, 0), 600), // first instant, in
        makeWorklog('ISW-1', new Date(2026, 7, 11, 23, 59), 1200), // yesterday, out
        makeWorklog('ISW-1', new Date(2026, 7, 13, 0, 0), 2400), // to-exclusive, out
      ],
    });
    const report = await service(searcher, worklogs).buildReport('today');
    expect(report.total).toBe(600);
  });

  it('keeps zero-logged issues in the period report', async () => {
    const searcher = makeSearcher(() => [makeIssue('ISW-1'), makeIssue('ISW-2')]);
    const worklogs = makeWorklogFetcher({
      'ISW-1': [makeWorklog('ISW-1', new Date(2026, 7, 12, 9, 0), 3600)],
    });
    const report = await service(searcher, worklogs).buildReport('today');
    expect(report.issues.map((i) => i.key)).toEqual(['ISW-1', 'ISW-2']);
    expect(report.issues[1].workLoggedForPeriod).toBe(0);
    expect(report.total).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// dailyByIssue grouping / ordering
// ---------------------------------------------------------------------------

describe('dailyByIssue', () => {
  it('groups by (day, issueKey), sums seconds, orders by day then issue key', async () => {
    const searcher = makeSearcher(() => [makeIssue('ISW-9'), makeIssue('ISW-1')]);
    const worklogs = makeWorklogFetcher({
      'ISW-9': [
        makeWorklog('ISW-9', new Date(2026, 7, 10, 9, 0), 600),
        makeWorklog('ISW-9', new Date(2026, 7, 10, 14, 0), 900), // same day, same issue → summed
        makeWorklog('ISW-9', new Date(2026, 7, 11, 9, 0), 300),
      ],
      'ISW-1': [makeWorklog('ISW-1', new Date(2026, 7, 10, 10, 0), 1200)],
    });
    const report = await service(searcher, worklogs).buildReport('thisWeek');
    expect(report.dailyByIssue).toEqual([
      { day: '2026-08-10', issueKey: 'ISW-1', issueSummary: 'Summary ISW-1', timeSpent: 1200 },
      { day: '2026-08-10', issueKey: 'ISW-9', issueSummary: 'Summary ISW-9', timeSpent: 1500 },
      { day: '2026-08-11', issueKey: 'ISW-9', issueSummary: 'Summary ISW-9', timeSpent: 300 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildReportForRange
// ---------------------------------------------------------------------------

describe('TimeLoggedService.buildReportForRange', () => {
  it('builds the worklogAuthor/worklogDate JQL with an inclusive last day', async () => {
    const searcher = makeSearcher(() => []);
    const svc = service(searcher, makeWorklogFetcher({}));
    await svc.buildReportForRange(new Date(2026, 7, 10), new Date(2026, 7, 13));
    expect(searcher.calls[0].jql).toBe(
      'worklogAuthor = currentUser() AND worklogDate >= "2026-08-10" AND worklogDate <= "2026-08-12" ORDER BY updated DESC',
    );
    expect(searcher.calls[0].hardCap).toBe(500);
  });

  it('falls back to the open-sprints JQL when the worklogDate search throws', async () => {
    const calls: string[] = [];
    const searcher: IssueSearcher = {
      async searchAll(jql: string): Promise<JiraIssue[]> {
        calls.push(jql);
        if (jql.includes('worklogAuthor')) throw new Error('worklogDate unsupported');
        return [];
      },
    };
    const svc = service(searcher, makeWorklogFetcher({}));
    await svc.buildReportForRange(new Date(2026, 7, 10), new Date(2026, 7, 13));
    expect(calls[1]).toBe('project = ISW AND assignee = currentUser() AND sprint in openSprints()');
  });

  it('drops zero-logged issues from the range report', async () => {
    const searcher = makeSearcher(() => [makeIssue('ISW-1'), makeIssue('ISW-2'), makeIssue('ISW-3')]);
    const worklogs = makeWorklogFetcher({
      'ISW-1': [makeWorklog('ISW-1', new Date(2026, 7, 11, 9, 0), 3600)],
      'ISW-2': [makeWorklog('ISW-2', new Date(2026, 7, 20, 9, 0), 3600)], // outside range → zero
      // ISW-3 has no worklogs at all
    });
    const report = await service(searcher, worklogs).buildReportForRange(
      new Date(2026, 7, 10),
      new Date(2026, 7, 13),
    );
    expect(report.issues.map((i) => i.key)).toEqual(['ISW-1']);
    expect(report.issues[0].workLoggedForPeriod).toBe(3600);
    expect(report.total).toBe(3600);
  });

  it('when a user is given, builds worklogAuthor JQL for that user and matches only their worklogs (ci)', async () => {
    const searcher = makeSearcher(() => [makeIssue('ISW-1')]);
    const worklogs = makeWorklogFetcher({
      'ISW-1': [
        makeWorklog('ISW-1', new Date(2026, 7, 11, 9, 0), 3600, 'dana q', null), // ci match
        makeWorklog('ISW-1', new Date(2026, 7, 11, 9, 0), 900, 'Someone Else', null), // no match
      ],
    });
    const svc = service(searcher, worklogs);
    const report = await svc.buildReportForRange(new Date(2026, 7, 10), new Date(2026, 7, 13), 'Dana Q');

    expect(searcher.calls[0].jql).toBe(
      'worklogAuthor = "Dana Q" AND worklogDate >= "2026-08-10" AND worklogDate <= "2026-08-12" ORDER BY updated DESC',
    );
    expect(report.issues.map((i) => i.key)).toEqual(['ISW-1']);
    expect(report.issues[0].workLoggedForPeriod).toBe(3600);
    expect(report.total).toBe(3600);
  });

  it('falls back to assignee = user in the catch branch when a user is given', async () => {
    const calls: string[] = [];
    const searcher: IssueSearcher = {
      async searchAll(jql: string): Promise<JiraIssue[]> {
        calls.push(jql);
        if (jql.includes('worklogAuthor')) throw new Error('worklogDate unsupported');
        return [];
      },
    };
    const svc = service(searcher, makeWorklogFetcher({}));
    await svc.buildReportForRange(new Date(2026, 7, 10), new Date(2026, 7, 13), 'Dana Q');
    expect(calls[1]).toBe('project = ISW AND assignee = "Dana Q" AND sprint in openSprints()');
  });
});

// ---------------------------------------------------------------------------
// buildReportForSprint
// ---------------------------------------------------------------------------

describe('TimeLoggedService.buildReportForSprint', () => {
  const activeSprint = sprint('Sprint 42', 'active', '2026-08-09T00:00:00+03:00', '2026-08-15T00:00:00+03:00');

  function sprintSearcher(mainIssues: JiraIssue[], availIssues: JiraIssue[]) {
    return makeSearcher((jql) => (jql.includes('sprint is not EMPTY') ? availIssues : mainIssues));
  }

  it('uses openSprints() for a blank name and sprint = "quoted" otherwise', async () => {
    const searcher = makeSearcher(() => []);
    const svc = service(searcher, makeWorklogFetcher({}));
    await svc.buildReportForSprint('');
    expect(searcher.calls[0].jql).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = currentUser() AND issuetype != Incident ORDER BY updated DESC',
    );
    await svc.buildReportForSprint('Sprint 42');
    expect(searcher.calls[2].jql).toBe(
      'project = ISW AND sprint = "Sprint 42" AND assignee = currentUser() AND issuetype != Incident ORDER BY updated DESC',
    );
  });

  it('when a user is given, builds sprint JQL with a quoted assignee and matches only their worklogs (ci)', async () => {
    const issue = makeIssue('ISW-1', { allSprints: [activeSprint] });
    const worklogs = makeWorklogFetcher({
      'ISW-1': [
        makeWorklog('ISW-1', new Date(2026, 7, 10, 9, 0), 3600, 'dana q', null), // ci match
        makeWorklog('ISW-1', new Date(2026, 7, 10, 9, 0), 900, 'Someone Else', null), // no match
      ],
    });
    const searcher = sprintSearcher([issue], []);
    const svc = service(searcher, worklogs);
    const report = await svc.buildReportForSprint('Sprint 42', 'Dana Q');

    expect(searcher.calls[0].jql).toBe(
      'project = ISW AND sprint = "Sprint 42" AND assignee = "Dana Q" AND issuetype != Incident ORDER BY updated DESC',
    );
    expect(report.total).toBe(3600);
  });

  it('excludes worklogs outside the sprint window (endDate + 1d exclusive)', async () => {
    const issue = makeIssue('ISW-1', { allSprints: [activeSprint] });
    const worklogs = makeWorklogFetcher({
      'ISW-1': [
        makeWorklog('ISW-1', new Date(2026, 7, 8, 12, 0), 100), // before start → out
        makeWorklog('ISW-1', new Date(2026, 7, 9, 8, 0), 200), // first day → in
        makeWorklog('ISW-1', new Date(2026, 7, 15, 23, 0), 400), // end date itself → in
        makeWorklog('ISW-1', new Date(2026, 7, 16, 0, 0), 800), // endDate+1d → out
      ],
    });
    const report = await service(sprintSearcher([issue], []), worklogs).buildReportForSprint('Sprint 42');
    expect(report.total).toBe(600);
    expect(new Date(report.fromUtc)).toEqual(new Date(2026, 7, 9));
    expect(new Date(report.toUtc)).toEqual(new Date(2026, 7, 16));
  });

  it('drops future sprints and lists active first, then startDate desc', async () => {
    const avail = [
      makeIssue('ISW-1', {
        allSprints: [
          sprint('Sprint 40', 'closed', '2026-07-12T00:00:00+03:00'),
          sprint('Sprint 43', 'future', '2026-08-23T00:00:00+03:00'),
          sprint('Sprint 42', 'active', '2026-08-09T00:00:00+03:00'),
        ],
      }),
      makeIssue('ISW-2', {
        allSprints: [
          sprint('sprint 40', 'closed', '2026-07-12T00:00:00+03:00'), // ci duplicate → dropped
          sprint('Sprint 41', 'closed', '2026-07-26T00:00:00+03:00'),
        ],
      }),
    ];
    const report = await service(sprintSearcher([], avail), makeWorklogFetcher({})).buildReportForSprint('');
    expect(report.availableSprints).toEqual(['Sprint 42', 'Sprint 41', 'Sprint 40']);
  });

  it('caps the availableSprints search at 200', async () => {
    const searcher = sprintSearcher([], []);
    await service(searcher, makeWorklogFetcher({})).buildReportForSprint('');
    const availCall = searcher.calls.find((c) => c.jql.includes('sprint is not EMPTY'))!;
    expect(availCall.jql).toBe(
      'project = ISW AND assignee = currentUser() AND sprint is not EMPTY ORDER BY updated DESC',
    );
    expect(availCall.hardCap).toBe(200);
  });

  it('falls back to min/max daily days when the sprint has no dates', async () => {
    const issue = makeIssue('ISW-1', { allSprints: [sprint('Sprint 42', 'active')] });
    const worklogs = makeWorklogFetcher({
      'ISW-1': [
        makeWorklog('ISW-1', new Date(2026, 7, 3, 9, 0), 600),
        makeWorklog('ISW-1', new Date(2026, 7, 11, 9, 0), 900),
      ],
    });
    const report = await service(sprintSearcher([issue], []), worklogs).buildReportForSprint('Sprint 42');
    expect(report.total).toBe(1500); // nothing excluded without a window
    expect(new Date(report.fromUtc)).toEqual(new Date(2026, 7, 3));
    expect(new Date(report.toUtc)).toEqual(new Date(2026, 7, 11));
  });
});

// ---------------------------------------------------------------------------
// DashboardAggregator
// ---------------------------------------------------------------------------

describe('DashboardAggregator.buildDashboardSnapshot', () => {
  const scope = 'project = ISW AND assignee = currentUser() AND Sprint in openSprints()';

  function pagedResult(total: number, items: JiraIssue[] = []): PagedResult<JiraIssue> {
    return { items, startAt: 0, maxResults: items.length || 1, total, hasMore: false };
  }

  it('runs the five KPI searches with the exact JQLs and merges time-logged totals', async () => {
    const calls: Array<{ jql: string; startAt: number; maxResults: number }> = [];
    const issues = {
      async searchIssues(jql: string, startAt = 0, maxResults = 50) {
        calls.push({ jql, startAt, maxResults });
        if (jql.includes('ORDER BY priority')) return pagedResult(2, [makeIssue('ISW-1'), makeIssue('ISW-2')]);
        if (jql.includes('statusCategory != Done') && jql.includes('issuetype in')) return pagedResult(3);
        if (jql.includes('statusCategory != Done')) return pagedResult(7);
        if (jql.includes('Blocked')) return pagedResult(1);
        return pagedResult(4); // updated today
      },
    };
    // One thisWeek report; today's total derives from its per-day rows.
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeLogged = {
      async buildReport(period: string) {
        expect(period).toBe('thisWeek');
        return {
          issues: [],
          total: 7200,
          fromUtc: '',
          toUtc: '',
          dailyByIssue: [
            { day: todayYmd, issueKey: 'ISW-1', issueSummary: 'a', timeSpent: 1800 },
            { day: '2000-01-01', issueKey: 'ISW-2', issueSummary: 'b', timeSpent: 5400 },
          ],
          availableSprints: [],
        };
      },
    };
    const snap = await new DashboardAggregator(makeSession(), issues, timeLogged).buildDashboardSnapshot();

    expect(snap.openIssues).toBe(7);
    expect(snap.criticalIncidents).toBe(3);
    expect(snap.blocked).toBe(1);
    expect(snap.updatedToday).toBe(4);
    expect(snap.timeLoggedToday).toBe(1800);
    expect(snap.timeLoggedThisWeek).toBe(7200);
    expect(snap.recentlyUpdated.map((i) => i.key)).toEqual(['ISW-1', 'ISW-2']);

    const jqls = calls.map((c) => c.jql);
    expect(jqls).toContain(`${scope} AND statusCategory != Done`);
    expect(jqls).toContain(
      `${scope} AND issuetype in (Incident, Bug, Defect) AND priority in (Critical, Highest) AND statusCategory != Done`,
    );
    expect(jqls).toContain(`${scope} AND (status = Blocked OR labels = blocked)`);
    expect(jqls).toContain(`${scope} AND updated >= startOfDay()`);
    expect(jqls).toContain(`${scope} ORDER BY priority DESC, updated DESC`);
    const recentCall = calls.find((c) => c.jql.includes('ORDER BY priority'))!;
    expect(recentCall.maxResults).toBe(50);
    expect(calls.filter((c) => !c.jql.includes('ORDER BY')).every((c) => c.maxResults === 1)).toBe(true);
  });

  it('defaults time-logged totals to zero when the report throws', async () => {
    const issues = {
      async searchIssues() {
        return pagedResult(0);
      },
    };
    const timeLogged = {
      async buildReport(): Promise<never> {
        throw new Error('boom');
      },
    };
    const snap = await new DashboardAggregator(makeSession(), issues, timeLogged).buildDashboardSnapshot();
    expect(snap.timeLoggedToday).toBe(0);
    expect(snap.timeLoggedThisWeek).toBe(0);
  });

  it('returns an empty snapshot when the session is disconnected', async () => {
    let searched = false;
    const issues = {
      async searchIssues() {
        searched = true;
        return pagedResult(99);
      },
    };
    const timeLogged = {
      async buildReport() {
        return { issues: [], total: 99, fromUtc: '', toUtc: '', dailyByIssue: [], availableSprints: [] };
      },
    };
    const snap = await new DashboardAggregator(new JiraSession(), issues, timeLogged).buildDashboardSnapshot();
    expect(searched).toBe(false);
    expect(snap).toMatchObject({
      openIssues: 0,
      criticalIncidents: 0,
      blocked: 0,
      updatedToday: 0,
      timeLoggedToday: 0,
      timeLoggedThisWeek: 0,
      recentlyUpdated: [],
    });
  });
});
