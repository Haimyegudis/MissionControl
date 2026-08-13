// Route tests (Task A7): createApp with plain mocked service deps, exercised
// over real HTTP against an ephemeral port.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, translateError, type AppDeps } from '../src/app.js';
import { JiraError } from '../src/jira/httpClient.js';
import { JiraSession } from '../src/jira/session.js';
import { defaultAppSettings, type JiraIssue, type JiraUser, type PagedResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures + harness
// ---------------------------------------------------------------------------

function issue(key: string, extra: Partial<JiraIssue> = {}): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key,
    summary: `Issue ${key}`,
    issueType: 'Bug',
    status: 'Open',
    statusCategory: 'new',
    priority: 'S3',
    assignee: null,
    reporter: null,
    projectKey: 'ISW',
    sprint: null,
    created: '2026-08-01T00:00:00.000Z',
    updated: '2026-08-10T00:00:00.000Z',
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
    ...extra,
  };
}

function paged(items: JiraIssue[], total = items.length): PagedResult<JiraIssue> {
  return { items, startAt: 0, maxResults: Math.max(items.length, 1), total, hasMore: false };
}

const USER: JiraUser = {
  accountId: 'acc-1',
  displayName: 'Test User',
  emailAddress: 'me@example.com',
  avatarUrl: null,
  active: true,
};

function connect(session: JiraSession): void {
  session.activate(
    {
      email: 'me@example.com',
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'secret-pat',
      instanceType: 'datacenter',
      defaultProjectKey: 'ISW',
      testRailBaseUrl: '',
      testRailEmail: '',
      testRailApiKey: '',
      confluenceBaseUrl: '',
      confluencePat: '',
    },
    USER,
  );
}

function makeDeps(): AppDeps {
  const session = new JiraSession();
  let settings = defaultAppSettings();
  return {
    session,
    credentials: { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() },
    testConnection: vi.fn(async () => USER),
    warmup: vi.fn(),
    issues: {
      searchIssues: vi.fn(async () => paged([])),
      getIssueDetails: vi.fn(async () => ({}) as never),
      getTransitions: vi.fn(async () => []),
      getTransitionScreen: vi.fn(async () => []),
      performTransition: vi.fn(async () => undefined),
      performTransitionWithData: vi.fn(async () => undefined),
      addComment: vi.fn(async () => undefined),
      addLabel: vi.fn(async () => undefined),
      resetFieldCache: vi.fn(),
    },
    worklogs: {
      getWorklogs: vi.fn(async () => []),
      addWorklog: vi.fn(async () => ({
        id: 'w1',
        issueKey: 'ISW-1',
        author: 'Test User',
        authorAccountId: 'acc-1',
        started: '2026-08-12T09:00:00.000Z',
        timeSpent: 3600,
        comment: null,
      })),
    },
    boards: {
      getBoards: vi.fn(async () => ({
        boards: [],
        fromGreenhopper: 0,
        fromAgile: 0,
        greenhopperError: null,
        agileError: null,
      })),
      getActiveSprints: vi.fn(async () => []),
      getBoardIssues: vi.fn(async () => []),
      getQuickFilters: vi.fn(async () => []),
    },
    metadata: {
      getProjects: vi.fn(async () => []),
      getIssueTypes: vi.fn(async () => []),
      getStatuses: vi.fn(async () => []),
      getPriorities: vi.fn(async () => []),
      getResolutions: vi.fn(async () => []),
      getFields: vi.fn(async () => []),
      getVersions: vi.fn(async () => []),
      getComponents: vi.fn(async () => []),
      getAssignableUsers: vi.fn(async () => []),
      getFieldSuggestions: vi.fn(async () => []),
      resolveFieldId: vi.fn(async () => null),
      resolveJqlField: vi.fn(async (name: string) => name),
    },
    getDistinct: vi.fn(async () => []),
    dashboards: {
      getDashboards: vi.fn(async () => []),
      getDashboardDetails: vi.fn(async () => ({}) as never),
    },
    createIssues: {
      getCreateMeta: vi.fn(async () => ({ projectKey: 'ISW', issueType: 'Incident', fields: [] })),
      createIssue: vi.fn(async () => 'ISW-999'),
    },
    timeLogged: {
      buildReport: vi.fn(async () => ({}) as never),
      buildReportForSprint: vi.fn(async () => ({}) as never),
      buildReportForRange: vi.fn(async () => ({}) as never),
    },
    aggregator: { buildDashboardSnapshot: vi.fn(async () => ({}) as never) },
    repos: {
      appSettings: {
        get: vi.fn(() => structuredClone(settings)),
        save: vi.fn((s) => {
          settings = structuredClone(s);
        }),
      },
      issueCache: {
        getCached: vi.fn(() => [] as JiraIssue[]),
        saveCache: vi.fn(),
        getLastRefresh: vi.fn(() => null as Date | null),
        clearAll: vi.fn(),
      },
      metadataCache: {
        get: vi.fn(() => null),
        set: vi.fn(),
        delete: vi.fn(),
        clearAll: vi.fn(),
      },
      savedFilters: { getAll: vi.fn(() => []), upsert: vi.fn((f) => f), delete: vi.fn() },
      teams: { getAll: vi.fn(() => []), upsert: vi.fn((t) => t), delete: vi.fn() },
      pinnedBoards: { getForProfile: vi.fn(() => []), upsert: vi.fn((b) => b), delete: vi.fn() },
    },
    createDefaults: { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() },
    createMetaCache: { load: vi.fn(() => null), save: vi.fn(), clearAll: vi.fn() },
    testrail: {
      status: vi.fn(() => ({ connected: false, baseUrl: null, email: null, user: null })),
      connect: vi.fn(async () => ({ id: 1, name: 'TR User', email: null, isActive: true })),
      disconnect: vi.fn(),
      requireClient: vi.fn(() => {
        throw new Error('not connected');
      }),
      cachedJson: vi.fn(async () => null),
      clearCache: vi.fn(),
      fetchMeta: vi.fn(async () => ({ users: [], statuses: [], caseTypes: [], priorities: [] })),
      prefetch: vi.fn(() => ({ started: true })),
      prefetchStatus: vi.fn(() => ({ active: false, done: 0, total: 0 })),
      getPeople: vi.fn(() => ({})),
      setPeople: vi.fn(),
    },
    askLumo: vi.fn(async () => ({ summary: 'ok', cards: [] })),
  };
}

let server: Server | null = null;

async function start(deps: AppDeps): Promise<string> {
  const app = createApp(deps);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

async function json(res: globalThis.Response): Promise<any> {
  return (await res.json()) as any;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('auth routes', () => {
  it('reports disconnected status with a null profile', async () => {
    const deps = makeDeps();
    const base = await start(deps);
    const res = await fetch(`${base}/api/auth/status`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ connected: false, user: null, profile: null });
  });

  it('login tests the connection, saves credentials, activates and warms up — PAT never returned', async () => {
    const deps = makeDeps();
    const base = await start(deps);
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://jira.example.com',
        email: 'me@example.com',
        pat: 'secret-pat',
        instanceType: 'datacenter',
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.connected).toBe(true);
    expect(body.user.displayName).toBe('Test User');
    expect(body.profile).toEqual({
      email: 'me@example.com',
      jiraBaseUrl: 'https://jira.example.com',
      instanceType: 'datacenter',
      defaultProjectKey: 'ISW',
    });
    expect(JSON.stringify(body)).not.toContain('secret-pat');
    expect(deps.testConnection).toHaveBeenCalledOnce();
    expect(deps.credentials.save).toHaveBeenCalledWith(
      expect.objectContaining({ jiraPat: 'secret-pat', jiraBaseUrl: 'https://jira.example.com' }),
    );
    expect(deps.warmup).toHaveBeenCalledOnce();
    expect(deps.session.isConnected).toBe(true);
  });

  it('login failure propagates the Jira 401 and leaves the session disconnected', async () => {
    const deps = makeDeps();
    (deps.testConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new JiraError(401, 'Jira authentication failed (401). Check the PAT.'),
    );
    const base = await start(deps);
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://jira.example.com', pat: 'bad' }),
    });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      status: 401,
      message: 'Jira authentication failed (401). Check the PAT.',
    });
    expect(deps.session.isConnected).toBe(false);
    expect(deps.credentials.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

describe('issue routes', () => {
  it('POST /issues/search passes jql/startAt/maxResults through', async () => {
    const deps = makeDeps();
    const result = paged([issue('ISW-1')], 12);
    (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mockResolvedValue(result);
    const base = await start(deps);
    const res = await fetch(`${base}/api/issues/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: 'project = ISW', startAt: 5, maxResults: 25 }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.total).toBe(12);
    expect(body.items[0].key).toBe('ISW-1');
    expect(deps.issues.searchIssues).toHaveBeenCalledWith('project = ISW', 5, 25);
  });

  it('POST /issues/:key/worklogs maps the client body onto addWorklog', async () => {
    const deps = makeDeps();
    const base = await start(deps);
    const res = await fetch(`${base}/api/issues/ISW-1/worklogs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seconds: 3600,
        started: '2026-08-12T09:00:00.000Z',
        comment: 'did work',
        adjustEstimate: 'new',
        adjustValue: '2d',
      }),
    });
    expect(res.status).toBe(200);
    expect(deps.worklogs.addWorklog).toHaveBeenCalledWith(
      'ISW-1',
      3600,
      '2026-08-12T09:00:00.000Z',
      'did work',
      'new',
      '2d',
    );
  });
});

// ---------------------------------------------------------------------------
// Cached search (MyWork delta semantics)
// ---------------------------------------------------------------------------

describe('POST /issues/cached-search', () => {
  const JQL = 'project = ISW AND assignee = currentUser() ORDER BY updated DESC';

  it('fresh cache → delta jql with updated >= (lastRefresh − 2min) before ORDER BY, merged by key ci', async () => {
    const deps = makeDeps();
    const lastRefresh = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago → fresh
    (deps.repos.issueCache.getCached as ReturnType<typeof vi.fn>).mockReturnValue([
      issue('ISW-1', { summary: 'old summary' }),
      issue('ISW-2'),
    ]);
    (deps.repos.issueCache.getLastRefresh as ReturnType<typeof vi.fn>).mockReturnValue(lastRefresh);
    (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mockResolvedValue(
      paged([issue('isw-1', { summary: 'new summary' }), issue('ISW-3')], 2),
    );

    const base = await start(deps);
    const res = await fetch(`${base}/api/issues/cached-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheKey: 'mywork:test', jql: JQL }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);

    const deltaJql = (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(deltaJql).toMatch(
      /^project = ISW AND assignee = currentUser\(\) AND updated >= "\d{4}-\d{2}-\d{2} \d{2}:\d{2}" ORDER BY updated DESC$/,
    );
    // The injected timestamp is lastRefresh − 2 minutes (local, minute precision).
    const expected = new Date(lastRefresh.getTime() - 2 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())} ${pad(expected.getHours())}:${pad(expected.getMinutes())}`;
    expect(deltaJql).toContain(`updated >= "${stamp}"`);

    expect(body.fromCache).toBe(true);
    expect(body.totalCount).toBe(3); // merged count, not the server total
    const keys = body.issues.map((i: JiraIssue) => i.key);
    expect(keys).toEqual(['isw-1', 'ISW-2', 'ISW-3']); // ISW-1 replaced ci, ISW-3 appended
    expect(body.issues[0].summary).toBe('new summary');
    expect(deps.repos.issueCache.saveCache).toHaveBeenCalledWith(
      'mywork:test',
      expect.arrayContaining([expect.objectContaining({ key: 'ISW-3' })]),
    );
  });

  it('stale/empty cache → full fetch with the original jql, totalCount = server total', async () => {
    const deps = makeDeps();
    (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mockResolvedValue(
      paged([issue('ISW-1')], 42),
    );
    const base = await start(deps);
    const res = await fetch(`${base}/api/issues/cached-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheKey: 'mywork:test', jql: JQL, maxResults: 200 }),
    });
    const body = await json(res);
    expect(deps.issues.searchIssues).toHaveBeenCalledWith(JQL, 0, 200);
    expect(body.fromCache).toBe(false);
    expect(body.totalCount).toBe(42);
    expect(body.issues).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('settings routes', () => {
  it('PUT merges the partial into the loaded settings and saves the full object', async () => {
    const deps = makeDeps();
    const base = await start(deps);
    const res = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'Light', refreshIntervalSeconds: 300, bogusKey: 'ignored' }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.theme).toBe('Light');
    expect(body.refreshIntervalSeconds).toBe(300);
    expect(body.defaultProjectKey).toBe('ISW'); // untouched default preserved
    expect(body.bogusKey).toBeUndefined();
    expect(deps.repos.appSettings.save).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'Light', refreshIntervalSeconds: 300 }),
    );

    const roundTrip = await json(await fetch(`${base}/api/settings`));
    expect(roundTrip.theme).toBe('Light');
  });
});

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

describe('incident routes', () => {
  it('POST /incidents/search runs three parallel searches and returns three lists', async () => {
    const deps = makeDeps();
    connect(deps.session);
    (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mockImplementation(
      async (jql: string) => {
        if (jql.includes('status = "Verification"')) return paged([issue('ISW-2')]);
        if (jql.includes('status = "Rejected"')) return paged([issue('ISW-3')]);
        return paged([issue('ISW-1')]);
      },
    );
    const base = await start(deps);
    const res = await fetch(`${base}/api/incidents/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections: [{ filterId: 'priority', values: ['S3'] }] }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.all.map((i: JiraIssue) => i.key)).toEqual(['ISW-1']);
    expect(body.verification.map((i: JiraIssue) => i.key)).toEqual(['ISW-2']);
    expect(body.rejected.map((i: JiraIssue) => i.key)).toEqual(['ISW-3']);
    expect(deps.issues.searchIssues).toHaveBeenCalledTimes(3);
    for (const call of (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[2]).toBe(200); // maxResults 200 each
    }
  });

  it('GET /incidents/filter-options/priority resolves via metadata lists, not distinct', async () => {
    const deps = makeDeps();
    connect(deps.session);
    (deps.metadata.getPriorities as ReturnType<typeof vi.fn>).mockResolvedValue(['S3', 'S4']);
    const base = await start(deps);
    const res = await fetch(`${base}/api/incidents/filter-options/priority`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(['S3', 'S4']);
    expect(deps.metadata.getPriorities).toHaveBeenCalledOnce();
    expect(deps.getDistinct).not.toHaveBeenCalled();
  });

  it('GET /incidents/filter-options/assignee resolves via distinct issue field (max 5000)', async () => {
    const deps = makeDeps();
    connect(deps.session);
    (deps.getDistinct as ReturnType<typeof vi.fn>).mockResolvedValue(['Alice', 'Bob']);
    const base = await start(deps);
    const res = await fetch(`${base}/api/incidents/filter-options/assignee`);
    expect(await json(res)).toEqual(['Alice', 'Bob']);
    expect(deps.getDistinct).toHaveBeenCalledWith('ISW', 'assignee', 5000);
  });
});

// ---------------------------------------------------------------------------
// Attachment proxy
// ---------------------------------------------------------------------------

describe('GET /misc/attachment-proxy', () => {
  it('rejects URLs whose host differs from the Jira base host with 403', async () => {
    const deps = makeDeps();
    connect(deps.session);
    deps.fetchFn = vi.fn() as unknown as typeof fetch;
    const base = await start(deps);
    const res = await fetch(
      `${base}/api/misc/attachment-proxy?url=${encodeURIComponent('https://evil.example.org/secure/attachment/1/x.png')}`,
    );
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body).toEqual({
      status: 403,
      message: 'Attachment URL host does not match the Jira base URL.',
    });
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('streams same-host attachments with the session auth header injected', async () => {
    const deps = makeDeps();
    connect(deps.session);
    const upstream = vi.fn(
      async () =>
        new Response('PNGDATA', { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    deps.fetchFn = upstream as unknown as typeof fetch;
    const base = await start(deps);
    const res = await fetch(
      `${base}/api/misc/attachment-proxy?url=${encodeURIComponent('https://jira.example.com/secure/attachment/1/x.png')}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNGDATA');
    const [, init] = upstream.mock.calls[0] as [URL, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer secret-pat');
  });

  it('returns 401 when no session is active', async () => {
    const deps = makeDeps();
    const base = await start(deps);
    const res = await fetch(
      `${base}/api/misc/attachment-proxy?url=${encodeURIComponent('https://jira.example.com/x.png')}`,
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

describe('error middleware', () => {
  it('translates JiraError into {status, message} with its HTTP status', async () => {
    const deps = makeDeps();
    (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mockRejectedValue(
      new JiraError(500, 'Jira exploded'),
    );
    const base = await start(deps);
    const res = await fetch(`${base}/api/issues/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: 'x' }),
    });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ status: 500, message: 'Jira exploded' });
  });

  it('passes a Jira 401 through as HTTP 401', async () => {
    const deps = makeDeps();
    (deps.issues.searchIssues as ReturnType<typeof vi.fn>).mockRejectedValue(
      new JiraError(401, 'Unauthorized'),
    );
    const base = await start(deps);
    const res = await fetch(`${base}/api/issues/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: 'x' }),
    });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ status: 401, message: 'Unauthorized' });
  });

  it('maps "No active Jira session." to 401 and unknown errors to 500', () => {
    expect(translateError(new Error('No active Jira session.'))).toEqual({
      status: 401,
      message: 'No active Jira session.',
    });
    expect(translateError(new Error('boom'))).toEqual({ status: 500, message: 'boom' });
  });

  it('unknown /api routes yield a 404 in the same shape', async () => {
    const deps = makeDeps();
    const base = await start(deps);
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.status).toBe(404);
    expect(typeof body.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Boards / misc contract spot-checks
// ---------------------------------------------------------------------------

describe('board routes', () => {
  it('GET /boards returns the plain board array; ?force=1 clears the cache key first', async () => {
    const deps = makeDeps();
    (deps.boards.getBoards as ReturnType<typeof vi.fn>).mockResolvedValue({
      boards: [
        {
          id: 7,
          name: 'ISW board',
          type: 'scrum',
          projectKey: 'ISW',
          projectName: null,
          filterId: null,
          filterName: null,
        },
      ],
      fromGreenhopper: 1,
      fromAgile: 0,
      greenhopperError: null,
      agileError: null,
    });
    const base = await start(deps);

    const plain = await fetch(`${base}/api/boards`);
    expect(await json(plain)).toEqual([expect.objectContaining({ id: 7, name: 'ISW board' })]);
    expect(deps.repos.metadataCache.delete).not.toHaveBeenCalled();

    await fetch(`${base}/api/boards?force=1`);
    expect(deps.repos.metadataCache.delete).toHaveBeenCalledWith('meta:default:boards');
  });
});

describe('lumo SSE route', () => {
  it('streams status events then the final result frame', async () => {
    const deps = makeDeps();
    (deps.askLumo as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ onStatus }: { onStatus?: (s: string) => void }) => {
        onStatus?.('Calling model (round 1/3)...');
        return { summary: 'All good.', cards: [] };
      },
    );
    const base = await start(deps);
    const res = await fetch(`${base}/api/lumo/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        projectKey: 'ISW',
        model: 'claude-sonnet-5[1m]',
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: status\ndata: {"status":"Calling model (round 1/3)..."}');
    expect(text).toContain('event: result\ndata: {"summary":"All good.","cards":[]}');
    expect(deps.askLumo).toHaveBeenCalledWith(
      expect.objectContaining({
        turns: [{ role: 'user', content: 'hi' }],
        projectKey: 'ISW',
        model: 'claude-sonnet-5[1m]',
      }),
    );
  });
});
