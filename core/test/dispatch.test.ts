import { describe, expect, it, vi } from 'vitest';
import { createCore } from '../src/composition.js';
import { createDispatcher, injectUpdatedClause, formatJqlMinute } from '../src/dispatch.js';
import { MemoryKvStore, MemoryPeopleStore } from '../src/storage/kv.js';
import type { Credentials, JiraUser } from '../src/types.js';

const USER: JiraUser = {
  accountId: 'me',
  displayName: 'Me',
  emailAddress: null,
  avatarUrl: null,
  active: true,
};

function harness() {
  let stored: Credentials | null = null;
  const core = createCore({
    kv: new MemoryKvStore(),
    people: new MemoryPeopleStore(),
    credentials: {
      load: () => stored,
      save: (c) => {
        stored = c;
      },
      clear: () => {
        stored = null;
      },
    },
  });
  const dispatch = createDispatcher(core, { probe: async () => USER });
  return { core, dispatch, saved: () => stored };
}

describe('routing', () => {
  it('404s a route group the mobile build does not serve', async () => {
    const { dispatch } = harness();
    // Lumo is desktop-only: it needs a local model runner.
    expect(await dispatch('POST', '/api/lumo/ask', {})).toEqual({
      status: 404,
      body: { message: 'Not available in the mobile build.' },
    });
  });

  it('404s anything not under /api', async () => {
    const { dispatch } = harness();
    expect((await dispatch('GET', '/index.html')).status).toBe(404);
  });

  it('is case-insensitive about the method', async () => {
    const { dispatch } = harness();
    expect((await dispatch('get', '/api/auth/status')).status).toBe(200);
  });
});

describe('auth', () => {
  it('reports a disconnected status with a null profile', async () => {
    const { dispatch } = harness();
    expect(await dispatch('GET', '/api/auth/status')).toEqual({
      status: 200,
      body: { connected: false, user: null, profile: null },
    });
  });

  it('login verifies, persists and activates, then status echoes the profile', async () => {
    const { dispatch, saved } = harness();
    const res = await dispatch('POST', '/api/auth/login', {
      email: 'me@hp.com',
      pat: 'pat',
      instanceType: 'datacenter',
    });
    expect(res.status).toBe(200);
    expect(saved()?.jiraPat).toBe('pat');

    const status = await dispatch('GET', '/api/auth/status');
    expect(status.body).toMatchObject({
      connected: true,
      user: USER,
      profile: { email: 'me@hp.com', jiraBaseUrl: 'https://hp-jira.external.hp.com', instanceType: 'datacenter' },
    });
  });

  it('login defaults the base URL to the HP gateway', async () => {
    const { dispatch, saved } = harness();
    await dispatch('POST', '/api/auth/login', { email: 'me@hp.com', pat: 'pat' });
    expect(saved()?.jiraBaseUrl).toBe('https://hp-jira.external.hp.com');
  });

  it('login rejects a missing PAT with 400', async () => {
    const { dispatch } = harness();
    expect(await dispatch('POST', '/api/auth/login', { email: 'me@hp.com' })).toEqual({
      status: 400,
      body: { message: 'Missing required parameter: pat' },
    });
  });

  it('logout blanks only the Jira fields, keeping TestRail credentials', async () => {
    const { core, dispatch, saved } = harness();
    // Stub the TestRail handshake: the real one would hit the network, which
    // would make this test depend on the gateway being reachable.
    vi.spyOn(core.testrail, 'connect').mockResolvedValue({ id: 1, name: 'Me' } as never);
    await dispatch('POST', '/api/auth/login', { email: 'me@hp.com', pat: 'pat' });
    await dispatch('POST', '/api/testrail/session', { email: 'me@hp.com', apiKey: 'trkey' });
    expect(saved()?.testRailApiKey).toBe('trkey');

    expect(await dispatch('POST', '/api/auth/logout')).toEqual({ status: 204, body: undefined });
    expect(saved()?.jiraPat).toBe('');
    expect(saved()?.email).toBe('');
    expect(saved()?.testRailApiKey).toBe('trkey');
  });
});

describe('issues', () => {
  it('routes a search to the issue service', async () => {
    const { core, dispatch } = harness();
    const search = vi.spyOn(core.issues, 'searchIssues').mockResolvedValue({ items: [], total: 0 } as never);
    const res = await dispatch('POST', '/api/issues/search', { jql: 'project = X', startAt: 0, maxResults: 50 });
    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith('project = X', 0, 50);
  });

  it('defaults startAt and maxResults', async () => {
    const { core, dispatch } = harness();
    const search = vi.spyOn(core.issues, 'searchIssues').mockResolvedValue({ items: [], total: 0 } as never);
    await dispatch('POST', '/api/issues/search', { jql: 'project = X' });
    expect(search).toHaveBeenCalledWith('project = X', 0, 100);
  });

  it('decodes a URL-encoded issue key from the path', async () => {
    const { core, dispatch } = harness();
    const details = vi.spyOn(core.issues, 'getIssueDetails').mockResolvedValue({ key: 'ABC-1' } as never);
    await dispatch('GET', '/api/issues/ABC-1');
    expect(details).toHaveBeenCalledWith('ABC-1');
  });

  it('adds a comment and answers 204', async () => {
    const { core, dispatch } = harness();
    const add = vi.spyOn(core.issues, 'addComment').mockResolvedValue(undefined as never);
    expect(await dispatch('POST', '/api/issues/ABC-1/comments', { body: 'hi' })).toEqual({
      status: 204,
      body: undefined,
    });
    expect(add).toHaveBeenCalledWith('ABC-1', 'hi');
  });

  it('a transition clears the issue cache', async () => {
    const { core, dispatch } = harness();
    vi.spyOn(core.issues, 'performTransition').mockResolvedValue(undefined as never);
    core.issueCache.saveCache('mywork', [{ key: 'A-1' } as never]);
    await dispatch('POST', '/api/issues/ABC-1/transitions', { id: '5' });
    expect(core.issueCache.getCached('mywork')).toEqual([]);
  });

  it('a transition carrying data uses the extended call', async () => {
    const { core, dispatch } = harness();
    const withData = vi.spyOn(core.issues, 'performTransitionWithData').mockResolvedValue(undefined as never);
    await dispatch('POST', '/api/issues/ABC-1/transitions', { id: '5', comment: 'note' });
    expect(withData).toHaveBeenCalledWith('ABC-1', '5', {}, 'note', null, null);
  });

  it('rejects a worklog with a non-numeric seconds value', async () => {
    const { dispatch } = harness();
    expect(await dispatch('POST', '/api/issues/A-1/worklogs', { seconds: 'lots', started: 'now' })).toEqual({
      status: 400,
      body: { message: 'Missing required parameter: seconds' },
    });
  });

  it('maps a thrown JiraError onto its status', async () => {
    const { core, dispatch } = harness();
    vi.spyOn(core.issues, 'getIssueDetails').mockRejectedValue(
      Object.assign(new Error('nope'), { name: 'JiraError', status: 403 }),
    );
    expect(await dispatch('GET', '/api/issues/A-1')).toEqual({ status: 403, body: { message: 'nope' } });
  });

  it('maps an unexpected error onto a 500', async () => {
    const { core, dispatch } = harness();
    vi.spyOn(core.issues, 'getIssueDetails').mockRejectedValue(new Error('boom'));
    expect(await dispatch('GET', '/api/issues/A-1')).toEqual({ status: 500, body: { message: 'boom' } });
  });
});

describe('cached-search (MyWork delta)', () => {
  it('a cold cache does a full search and stores the result', async () => {
    const { core, dispatch } = harness();
    vi.spyOn(core.issues, 'searchIssues').mockResolvedValue({
      items: [{ key: 'A-1' }, { key: 'A-2' }],
      total: 2,
    } as never);
    const res = await dispatch('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalCount: 2, fromCache: false });
    expect(core.issueCache.getCached('mywork')).toHaveLength(2);
  });

  it('a warm cache issues a delta query and merges by key, case-insensitively', async () => {
    const { core, dispatch } = harness();
    const search = vi.spyOn(core.issues, 'searchIssues');
    search.mockResolvedValueOnce({ items: [{ key: 'A-1', summary: 'old' }], total: 1 } as never);
    await dispatch('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });

    search.mockResolvedValueOnce({ items: [{ key: 'a-1', summary: 'new' }, { key: 'A-2' }], total: 2 } as never);
    const res = await dispatch('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });

    expect(search.mock.calls[1][0]).toContain('updated >=');
    const body = res.body as { issues: Array<{ key: string; summary?: string }>; fromCache: boolean };
    expect(body.fromCache).toBe(true);
    expect(body.issues).toHaveLength(2);
    expect(body.issues[0].summary).toBe('new');
  });

  it('a stale cache falls back to a full search', async () => {
    // One clock for the whole graph: the cache stamps writes with it and the
    // dispatcher measures freshness against it.
    let clock = 1_700_000_000_000;
    const core = createCore({
      kv: new MemoryKvStore(),
      people: new MemoryPeopleStore(),
      credentials: { load: () => null, save: () => {}, clear: () => {} },
      now: () => clock,
    });
    vi.spyOn(core.issues, 'searchIssues').mockResolvedValue({ items: [{ key: 'A-1' }], total: 1 } as never);
    const d = createDispatcher(core, { probe: async () => USER });

    await d('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });
    clock += 2 * 60 * 60 * 1000; // beyond the 1 h freshness window
    const res = await d('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });
    expect((res.body as { fromCache: boolean }).fromCache).toBe(false);
  });

  it('a cache inside the freshness window uses the delta path', async () => {
    let clock = 1_700_000_000_000;
    const core = createCore({
      kv: new MemoryKvStore(),
      people: new MemoryPeopleStore(),
      credentials: { load: () => null, save: () => {}, clear: () => {} },
      now: () => clock,
    });
    vi.spyOn(core.issues, 'searchIssues').mockResolvedValue({ items: [{ key: 'A-1' }], total: 1 } as never);
    const d = createDispatcher(core, { probe: async () => USER });

    await d('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });
    clock += 30 * 60 * 1000; // still inside the 1 h window
    const res = await d('POST', '/api/issues/cached-search', { cacheKey: 'mywork', jql: 'project = X' });
    expect((res.body as { fromCache: boolean }).fromCache).toBe(true);
  });
});

describe('settings', () => {
  it('GET returns the stored settings', async () => {
    const { dispatch } = harness();
    const res = await dispatch('GET', '/api/settings');
    expect(res.status).toBe(200);
    expect((res.body as { theme: string }).theme).toBe('Dark');
  });

  it('PUT merges only known keys and echoes the result', async () => {
    const { core, dispatch } = harness();
    const res = await dispatch('PUT', '/api/settings', { theme: 'Light', bogusKey: 1 });
    expect((res.body as Record<string, unknown>).bogusKey).toBeUndefined();
    expect(core.settings.get().theme).toBe('Light');
  });

  it('PUT rejects a malformed default project key', async () => {
    const { dispatch } = harness();
    expect(await dispatch('PUT', '/api/settings', { defaultProjectKey: 'not a key' })).toEqual({
      status: 400,
      body: { message: 'Invalid project key: not a key' },
    });
  });

  it('clear-issue-cache empties the cache', async () => {
    const { core, dispatch } = harness();
    core.issueCache.saveCache('mywork', [{ key: 'A-1' } as never]);
    expect(await dispatch('POST', '/api/settings/clear-issue-cache')).toEqual({ status: 204, body: undefined });
    expect(core.issueCache.getCached('mywork')).toEqual([]);
  });
});

describe('filters', () => {
  it('returns an empty saved-filter list in the mobile build', async () => {
    const { dispatch } = harness();
    expect(await dispatch('GET', '/api/filters')).toEqual({ status: 200, body: [] });
  });
});

describe('testrail', () => {
  it('reports a disconnected session', async () => {
    const { dispatch } = harness();
    expect(await dispatch('GET', '/api/testrail/session')).toEqual({
      status: 200,
      body: { connected: false, baseUrl: null, email: null, user: null },
    });
  });

  it('answers 401 with the TestRail error shape while disconnected', async () => {
    const { dispatch } = harness();
    const res = await dispatch('GET', '/api/testrail/projects');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining('Not connected to TestRail') });
  });

  it('people round-trip as an id to name map', async () => {
    const { dispatch } = harness();
    expect(await dispatch('PUT', '/api/testrail/people', { '4': 'Dana' })).toEqual({ status: 204, body: undefined });
    expect(await dispatch('GET', '/api/testrail/people')).toEqual({ status: 200, body: { '4': 'Dana' } });
  });

  it('rejects a non-object people payload', async () => {
    const { dispatch } = harness();
    expect((await dispatch('PUT', '/api/testrail/people', [])).status).toBe(400);
  });

  it('parses the run id out of a nested path', async () => {
    const { core, dispatch } = harness();
    const client = { getTests: vi.fn(async () => [{ id: 1 }]) };
    vi.spyOn(core.testrail, 'requireClient').mockReturnValue(client as never);
    const res = await dispatch('GET', '/api/testrail/runs/77/tests');
    expect(res.status).toBe(200);
    expect(client.getTests).toHaveBeenCalledWith(77);
  });

  it('honours fresh=1 by bypassing the cache', async () => {
    const { core, dispatch } = harness();
    const client = { getProjects: vi.fn(async () => [{ id: 1 }]) };
    vi.spyOn(core.testrail, 'requireClient').mockReturnValue(client as never);
    await dispatch('GET', '/api/testrail/projects');
    await dispatch('GET', '/api/testrail/projects');
    expect(client.getProjects).toHaveBeenCalledTimes(1);
    await dispatch('GET', '/api/testrail/projects?fresh=1');
    expect(client.getProjects).toHaveBeenCalledTimes(2);
  });

  it('surfaces a TestRail API failure as a structured 502', async () => {
    const { core, dispatch } = harness();
    const err = Object.assign(new Error('TestRail rejected it'), {
      name: 'TestRailApiError',
      statusCode: 400,
      body: 'detail',
    });
    vi.spyOn(core.testrail, 'requireClient').mockImplementation(() => {
      throw err;
    });
    const res = await dispatch('GET', '/api/testrail/projects');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'TestRail rejected it', statusCode: 400, body: 'detail' });
  });
});

describe('MyWork JQL helpers', () => {
  it('formats a JQL minute literal in local time', () => {
    expect(formatJqlMinute(new Date(2026, 7, 20, 9, 5))).toBe('2026-08-20 09:05');
  });

  it('injects the updated clause before a trailing ORDER BY', () => {
    const out = injectUpdatedClause('project = X ORDER BY created DESC', new Date(2026, 7, 20, 9, 5));
    expect(out).toBe('project = X AND updated >= "2026-08-20 09:05" ORDER BY created DESC');
  });

  it('appends the updated clause when there is no ORDER BY', () => {
    expect(injectUpdatedClause('project = X', new Date(2026, 7, 20, 9, 5))).toBe(
      'project = X AND updated >= "2026-08-20 09:05"',
    );
  });
});


describe('the wider Jira surface', () => {
  it('serves saved filters from storage rather than an empty stub', async () => {
    const { dispatch } = harness();
    const created = await dispatch('POST', '/api/filters', { name: 'Mine', jql: 'project = ISW' });
    expect(created.status).toBe(200);
    const id = (created.body as { id: string }).id;
    expect(id).toBeTruthy();

    const list = await dispatch('GET', '/api/filters');
    expect((list.body as unknown[]).length).toBe(1);

    expect(await dispatch('DELETE', `/api/filters/${id}`)).toEqual({ status: 204, body: undefined });
    expect(await dispatch('GET', '/api/filters')).toEqual({ status: 200, body: [] });
  });

  it('round-trips a team', async () => {
    const { dispatch } = harness();
    const created = await dispatch('POST', '/api/teams', { name: 'Squad', members: ['a', 'b'] });
    expect((created.body as { members: string[] }).members).toEqual(['a', 'b']);
    expect(((await dispatch('GET', '/api/teams')).body as unknown[]).length).toBe(1);
  });

  it('rejects a pinned board with no boardId', async () => {
    const { dispatch } = harness();
    expect(await dispatch('POST', '/api/pinned-boards', { name: 'X' })).toEqual({
      status: 400,
      body: { message: 'Missing required parameter: boardId' },
    });
  });

  it('round-trips a pinned board under the fixed profile', async () => {
    const { dispatch } = harness();
    await dispatch('POST', '/api/pinned-boards', { boardId: 12, name: 'Board' });
    const list = (await dispatch('GET', '/api/pinned-boards')).body as Array<{ boardId: number }>;
    expect(list.map((b) => b.boardId)).toEqual([12]);
  });

  it('routes board sub-resources by id', async () => {
    const { core, dispatch } = harness();
    const sprints = vi.spyOn(core.boards, 'getActiveSprints').mockResolvedValue([] as never);
    await dispatch('GET', '/api/boards/42/sprints');
    expect(sprints).toHaveBeenCalledWith(42);
  });

  it('rejects a non-numeric board id', async () => {
    const { dispatch } = harness();
    expect((await dispatch('GET', '/api/boards/abc/sprints')).status).toBe(400);
  });

  it('runs the three incident searches in one call', async () => {
    const { core, dispatch } = harness();
    const search = vi.spyOn(core.issues, 'searchIssues').mockResolvedValue({ items: [], total: 0 } as never);
    const res = await dispatch('POST', '/api/incidents/search', { selections: [] });
    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledTimes(3);
    expect(res.body).toEqual({ all: [], verification: [], rejected: [] });
  });

  it('exposes the incident filter catalog', async () => {
    const { dispatch } = harness();
    const res = await dispatch('GET', '/api/incidents/definitions');
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('rejects an unknown time-logged period', async () => {
    const { dispatch } = harness();
    expect(await dispatch('GET', '/api/timelogged?period=someday')).toEqual({
      status: 400,
      body: { message: 'Invalid period: someday' },
    });
  });

  it('requires both ends of a time-logged range', async () => {
    const { dispatch } = harness();
    expect((await dispatch('GET', '/api/timelogged/range?from=2026-01-01')).status).toBe(400);
  });

  it('serves the dashboard snapshot from the aggregator', async () => {
    const { core, dispatch } = harness();
    const build = vi.spyOn(core.aggregator, 'buildDashboardSnapshot').mockResolvedValue({ ok: true } as never);
    expect(await dispatch('GET', '/api/dashboard/snapshot')).toEqual({ status: 200, body: { ok: true } });
    expect(build).toHaveBeenCalled();
  });

  it('lists and details Jira dashboards', async () => {
    const { core, dispatch } = harness();
    vi.spyOn(core.dashboards, 'getDashboards').mockResolvedValue([] as never);
    const details = vi.spyOn(core.dashboards, 'getDashboardDetails').mockResolvedValue({ id: '7' } as never);
    expect((await dispatch('GET', '/api/dashboards')).status).toBe(200);
    await dispatch('GET', '/api/dashboards/7');
    expect(details).toHaveBeenCalledWith('7');
  });
});


describe('confluence', () => {
  it('reports a disconnected status', async () => {
    const { dispatch } = harness();
    const res = await dispatch('GET', '/api/confluence/status');
    expect(res.status).toBe(200);
    expect((res.body as { connected: boolean }).connected).toBe(false);
  });

  it('requires a PAT to connect', async () => {
    const { dispatch } = harness();
    expect(await dispatch('PUT', '/api/confluence/connection', { baseUrl: 'https://c/' })).toEqual({
      status: 400,
      body: { message: 'Missing required parameter: pat' },
    });
  });

  it('disconnect blanks only the Confluence fields', async () => {
    const { core, dispatch, saved } = harness();
    core.credentials.save({
      email: 'a@hp.com',
      jiraBaseUrl: 'https://j/',
      jiraPat: 'jira',
      instanceType: 'datacenter',
      defaultProjectKey: 'ISW',
      testRailBaseUrl: '',
      testRailEmail: '',
      testRailApiKey: 'tr',
      confluenceBaseUrl: 'https://c/',
      confluencePat: 'cf',
    });
    expect(await dispatch('DELETE', '/api/confluence/connection')).toEqual({ status: 204, body: undefined });
    expect(saved()?.confluencePat).toBe('');
    expect(saved()?.jiraPat).toBe('jira');
    expect(saved()?.testRailApiKey).toBe('tr');
  });

  it('routes a space page listing by key', async () => {
    const { core, dispatch } = harness();
    const pages = vi.spyOn(core.confluence, 'pages').mockResolvedValue({ items: [], startAt: 0, nextStart: 0, hasMore: false } as never);
    await dispatch('GET', '/api/confluence/spaces/ISW/pages?start=20&limit=50');
    expect(pages).toHaveBeenCalledWith('ISW', 20, 50);
  });
});
