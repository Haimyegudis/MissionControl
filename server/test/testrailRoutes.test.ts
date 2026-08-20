// TestRail route tests (Phase 2 — unified-deck plan T10): createApp with the
// real TestRailService over an in-memory SQLite db and a mocked TestRail
// client, exercised over real HTTP against an ephemeral port (routes.test.ts
// harness conventions).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { createApp, type AppDeps } from '../src/app.js';
import type { Credentials } from '../src/config/credentialsStore.js';
import { JiraSession } from '@mc/core';
import { openDb, type Db } from '../src/storage/db.js';
import { SqliteKvStore, SqlitePeopleStore } from '../src/storage/sqliteKv.js';
import type { TestRailClientLike } from '@mc/core';
import { TestRailApiError } from '@mc/core';
import { TestRailService } from '@mc/core';
import type { TrUser } from '@mc/core';
import { defaultAppSettings, type JiraIssue } from '@mc/core';

// ---------------------------------------------------------------------------
// Fixtures + harness
// ---------------------------------------------------------------------------

const TR_USER: TrUser = { id: 1, name: 'TR User', email: 'tr@example.com', isActive: true };

function makeMockClient(): TestRailClientLike {
  return {
    getProjects: vi.fn(async () => [{ id: 1, name: 'Project One', suiteMode: 3, isCompleted: false }]),
    getSuites: vi.fn(async () => [
      { id: 3, projectId: 1, name: 'Master', description: null, isCompleted: false },
    ]),
    getSections: vi.fn(async () => []),
    getCases: vi.fn(async () => []),
    getCurrentUser: vi.fn(async () => TR_USER),
    getUsers: vi.fn(async () => [TR_USER]),
    getStatuses: vi.fn(async () => []),
    getCaseTypes: vi.fn(async () => []),
    getPriorities: vi.fn(async () => []),
    getRuns: vi.fn(async () => []),
    getPlanRuns: vi.fn(async () => []),
    getTests: vi.fn(async () => []),
    getResultsForTest: vi.fn(async () => []),
    getResultsForRun: vi.fn(async () => []),
    addResultExtended: vi.fn(async () => undefined),
    addRun: vi.fn(async () => ({}) as never),
    updateRun: vi.fn(async () => ({}) as never),
    closeRun: vi.fn(async () => undefined),
    deleteRun: vi.fn(async () => undefined),
    addSection: vi.fn(async () => ({}) as never),
    updateSection: vi.fn(async () => ({}) as never),
    deleteSection: vi.fn(async () => undefined),
    moveSection: vi.fn(async () => undefined),
    addCase: vi.fn(async () => ({}) as never),
    updateCase: vi.fn(async () => ({}) as never),
    deleteCase: vi.fn(async () => undefined),
    copyCasesToSection: vi.fn(async () => undefined),
    moveCasesToSection: vi.fn(async () => undefined),
    getRaw: vi.fn(async () => ({})),
  };
}

interface Harness {
  deps: AppDeps;
  db: Db;
  client: TestRailClientLike;
  service: TestRailService;
  savedCredentials: () => Credentials | null;
}

function makeDeps(): Harness {
  const session = new JiraSession();
  let settings = defaultAppSettings();
  let stored: Credentials | null = null;
  const db = openDb(':memory:');
  const client = makeMockClient();
  const service = new TestRailService(new SqliteKvStore(db), new SqlitePeopleStore(db), () => client);
  const deps: AppDeps = {
    session,
    credentials: {
      load: vi.fn(() => stored),
      save: vi.fn((c: Credentials) => {
        stored = c;
      }),
      clear: vi.fn(() => {
        stored = null;
      }),
    },
    testConnection: vi.fn(async () => ({}) as never),
    warmup: vi.fn(),
    issues: {
      searchIssues: vi.fn(async () => ({}) as never),
      getIssueDetails: vi.fn(async () => ({}) as never),
      getTransitions: vi.fn(async () => []),
      getTransitionScreen: vi.fn(async () => []),
      performTransition: vi.fn(async () => undefined),
      performTransitionWithData: vi.fn(async () => undefined),
      addComment: vi.fn(async () => undefined),
      addLabel: vi.fn(async () => undefined),
      resetFieldCache: vi.fn(),
    },
    worklogs: { getWorklogs: vi.fn(async () => []), addWorklog: vi.fn(async () => ({}) as never) },
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
      metadataCache: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn(), clearAll: vi.fn() },
      savedFilters: { getAll: vi.fn(() => []), upsert: vi.fn((f) => f), delete: vi.fn() },
      teams: { getAll: vi.fn(() => []), upsert: vi.fn((t) => t), delete: vi.fn() },
      pinnedBoards: { getForProfile: vi.fn(() => []), upsert: vi.fn((b) => b), delete: vi.fn() },
    },
    createDefaults: { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() },
    createMetaCache: { load: vi.fn(() => null), save: vi.fn(), clearAll: vi.fn() },
    testrail: service,
    askLumo: vi.fn(async () => ({ summary: 'ok', cards: [] })),
  };
  return { deps, db, client, service, savedCredentials: () => stored };
}

let server: Server | null = null;
let openDbs: Db[] = [];

async function start(harness: Harness): Promise<string> {
  openDbs.push(harness.db);
  const app = createApp(harness.deps);
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
  for (const db of openDbs) db.close();
  openDbs = [];
});

async function json(res: globalThis.Response): Promise<any> {
  return (await res.json()) as any;
}

async function connectSession(base: string): Promise<void> {
  const res = await fetch(`${base}/api/testrail/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'https://tr.example.com', email: 'tr@example.com', apiKey: 'key-1' }),
  });
  expect(res.status).toBe(200);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

describe('testrail session routes', () => {
  it('reports a disconnected session', async () => {
    const base = await start(makeDeps());
    const res = await fetch(`${base}/api/testrail/session`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ connected: false, baseUrl: null, email: null, user: null });
  });

  it('GETs that hit TestRail answer 401 while disconnected', async () => {
    const base = await start(makeDeps());
    const res = await fetch(`${base}/api/testrail/projects`);
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'Not connected to TestRail. Open Settings and connect first.' });
  });

  it('POST /session verifies via get_current_user and persists credentials', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);
    expect(harness.client.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(harness.savedCredentials()).toMatchObject({
      testRailBaseUrl: 'https://tr.example.com',
      testRailEmail: 'tr@example.com',
      testRailApiKey: 'key-1',
    });

    const res = await fetch(`${base}/api/testrail/session`);
    expect(await json(res)).toEqual({
      connected: true,
      baseUrl: 'https://tr.example.com',
      email: 'tr@example.com',
      user: TR_USER,
    });
  });

  it('DELETE /session disconnects and blanks only the TestRail credential fields', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);
    harness.deps.credentials.save({
      ...(harness.savedCredentials() as Credentials),
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'jira-pat',
    });

    const res = await fetch(`${base}/api/testrail/session`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(harness.service.status().connected).toBe(false);
    expect(harness.savedCredentials()).toMatchObject({
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'jira-pat',
      testRailBaseUrl: '',
      testRailEmail: '',
      testRailApiKey: '',
    });
  });
});

// ---------------------------------------------------------------------------
// Cached GETs
// ---------------------------------------------------------------------------

describe('testrail cached routes', () => {
  it('GET /projects fetches once, then serves the SQLite cache', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);

    const first = await json(await fetch(`${base}/api/testrail/projects`));
    expect(first).toEqual([{ id: 1, name: 'Project One', suiteMode: 3, isCompleted: false }]);
    const second = await json(await fetch(`${base}/api/testrail/projects`));
    expect(second).toEqual(first);
    expect(harness.client.getProjects).toHaveBeenCalledTimes(1);
    expect(new SqliteKvStore(harness.db).get('trCache', 'projects')).not.toBeNull();
  });

  it('fresh=1 bypasses and re-fills the cache', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);

    await fetch(`${base}/api/testrail/projects`);
    const res = await fetch(`${base}/api/testrail/projects?fresh=1`);
    expect(res.status).toBe(200);
    expect(harness.client.getProjects).toHaveBeenCalledTimes(2);
  });

  it('DELETE /cache clears entries so the next GET refetches', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);

    await fetch(`${base}/api/testrail/projects`);
    expect(await fetch(`${base}/api/testrail/cache`, { method: 'DELETE' }).then((r) => r.status)).toBe(204);
    expect(new SqliteKvStore(harness.db).get('trCache', 'projects')).toBeNull();
    await fetch(`${base}/api/testrail/projects`);
    expect(harness.client.getProjects).toHaveBeenCalledTimes(2);
  });

  it('suites/sections/cases use the exact cache keys', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);

    await fetch(`${base}/api/testrail/projects/1/suites`);
    await fetch(`${base}/api/testrail/projects/1/sections?suiteId=3`);
    await fetch(`${base}/api/testrail/projects/1/cases?suiteId=3`);
    await fetch(`${base}/api/testrail/projects/1/cases?suiteId=3&sectionId=7`);
    expect(new SqliteKvStore(harness.db).get('trCache', 'suites:1')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'sections:1:3')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'cases:1:3:')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'cases:1:3:7')).not.toBeNull();
    expect(harness.client.getCases).toHaveBeenCalledWith(1, 3, null);
    expect(harness.client.getCases).toHaveBeenCalledWith(1, 3, 7);
  });

  it('GET /meta tolerates a get_users failure and caches under meta:{projectId}', async () => {
    const harness = makeDeps();
    (harness.client.getUsers as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TestRailApiError('TestRail returned 403 Forbidden.', 403, ''),
    );
    const base = await start(harness);
    await connectSession(base);

    const res = await fetch(`${base}/api/testrail/meta?projectId=1`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ users: [], statuses: [], caseTypes: [], priorities: [] });
    expect(new SqliteKvStore(harness.db).get('trCache', 'meta:1')).not.toBeNull();
  });

  it('a TestRail API failure surfaces as a structured 502', async () => {
    const harness = makeDeps();
    (harness.client.getSuites as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TestRailApiError('TestRail returned 400 Bad Request.', 400, '{"error":"boom"}'),
    );
    const base = await start(harness);
    await connectSession(base);

    const res = await fetch(`${base}/api/testrail/projects/1/suites`);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({
      error: 'TestRail returned 400 Bad Request.',
      statusCode: 400,
      body: '{"error":"boom"}',
    });
  });
});

// ---------------------------------------------------------------------------
// Prefetch + people
// ---------------------------------------------------------------------------

describe('testrail prefetch and people', () => {
  it('prefetch warms suites/runs/meta/sections/cases and reports progress', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);

    const started = await json(
      await fetch(`${base}/api/testrail/prefetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: [1] }),
      }),
    );
    expect(started).toEqual({ started: true });

    await vi.waitFor(() => {
      expect(harness.service.prefetchStatus().active).toBe(false);
    });

    const status = await json(await fetch(`${base}/api/testrail/prefetch/status`));
    // 1 project * 3 + 1 suite * 2
    expect(status).toEqual({ active: false, done: 5, total: 5 });
    expect(new SqliteKvStore(harness.db).get('trCache', 'suites:1')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'runs:1')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'meta:1')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'sections:1:3')).not.toBeNull();
    expect(new SqliteKvStore(harness.db).get('trCache', 'cases:1:3:')).not.toBeNull();

    // Already-warm projects are skipped wholesale on the next prefetch.
    await fetch(`${base}/api/testrail/prefetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIds: [1] }),
    });
    await vi.waitFor(() => {
      expect(harness.service.prefetchStatus().active).toBe(false);
    });
    expect(harness.service.prefetchStatus()).toEqual({ active: false, done: 3, total: 3 });
    expect(harness.client.getSuites).toHaveBeenCalledTimes(1);
  });

  it('POST /projects/:id/runs forwards includeAll/assignedToId (caseIds only when not include-all)', async () => {
    const harness = makeDeps();
    const base = await start(harness);
    await connectSession(base);

    const post = (body: unknown) =>
      fetch(`${base}/api/testrail/projects/1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    // include_all run: case ids are dropped before they reach the client.
    let res = await post({ suiteId: 3, name: 'Full', includeAll: true, assignedToId: 9, caseIds: [1, 2] });
    expect(res.status).toBe(200);
    expect(harness.client.addRun).toHaveBeenLastCalledWith(1, {
      suiteId: 3,
      name: 'Full',
      description: null,
      refs: null,
      assignedToId: 9,
      includeAll: true,
      caseIds: undefined,
    });

    // explicit snapshot run.
    res = await post({ suiteId: 3, name: 'Picked', refs: 'ISW-1', caseIds: [4, 5] });
    expect(res.status).toBe(200);
    expect(harness.client.addRun).toHaveBeenLastCalledWith(1, {
      suiteId: 3,
      name: 'Picked',
      description: null,
      refs: 'ISW-1',
      assignedToId: null,
      includeAll: false,
      caseIds: [4, 5],
    });
  });

  it('people round-trips as an id -> name map and PUT replaces the set', async () => {
    const harness = makeDeps();
    const base = await start(harness);

    expect(await json(await fetch(`${base}/api/testrail/people`))).toEqual({});

    const put = await fetch(`${base}/api/testrail/people`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '5': 'Alice', '6': 'Bob' }),
    });
    expect(put.status).toBe(204);
    expect(await json(await fetch(`${base}/api/testrail/people`))).toEqual({ '5': 'Alice', '6': 'Bob' });

    await fetch(`${base}/api/testrail/people`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '7': 'Carol' }),
    });
    expect(await json(await fetch(`${base}/api/testrail/people`))).toEqual({ '7': 'Carol' });
  });
});
