// In-process route dispatcher. Answers the same (method, path, body) contract
// the Express routes answer, so client/src/api/* needs no per-endpoint change
// and the views need no change at all. Only the Phase 1 mobile surface exists
// here; every other path 404s loudly rather than silently misbehaving.
//
// Handlers are ports of server/src/routes/{auth,issues,settings,misc,testrail}
// and must keep the same status codes, payload shapes and validation messages.

import type { Core } from './composition.js';
import { DEFAULT_APP_SETTINGS, type AppSettings, type Credentials, type JiraIssue, type JiraUser } from './types.js';

export interface DispatchResponse {
  status: number;
  body: unknown;
}

export type Dispatch = (method: string, path: string, body?: unknown) => Promise<DispatchResponse>;

export interface DispatcherOptions {
  /** Overrides the Jira connection probe (tests inject a stub). */
  probe?: Parameters<Core['testConnection']>[1];
  /** Clock for the issue-cache freshness window. */
  now?: () => Date;
}

/** Issue-cache freshness window (ui-parity §2): 1 hour. */
export const CACHE_FRESH_MS = 60 * 60 * 1000;
/** Delta lower bound = last refresh - 2 minutes. */
export const DELTA_SLACK_MS = 2 * 60 * 1000;

/** Fixed HP endpoints — the Settings UI no longer sends base URLs. */
const DEFAULT_JIRA_BASE_URL = 'https://hp-jira.external.hp.com';
const DEFAULT_TESTRAIL_BASE_URL = 'https://hp-testrail.external.hp.com';

const KNOWN_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_APP_SETTINGS));

/** `yyyy-MM-dd HH:mm` in local time (JQL `updated >=` literal). */
export function formatJqlMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Insert `AND updated >= "yyyy-MM-dd HH:mm"` before a trailing ORDER BY
 * (appended when the JQL has none).
 */
export function injectUpdatedClause(jql: string, since: Date): string {
  const clause = `updated >= "${formatJqlMinute(since)}"`;
  const match = /\border\s+by\b/i.exec(jql);
  if (match) {
    const head = jql.slice(0, match.index).trim();
    const tail = jql.slice(match.index).trim();
    return `${head} AND ${clause} ${tail}`;
  }
  return `${jql.trim()} AND ${clause}`;
}

// ---------------------------------------------------------------------------
// Small helpers mirroring routes/deps.ts
// ---------------------------------------------------------------------------

class DispatchError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra fields merged into the error body (TestRail's 502 shape). */
    readonly extra: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DispatchError(400, `Missing required parameter: ${name}`);
  }
  return value;
}

function requireInt(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(n)) throw new DispatchError(400, `Missing or invalid parameter: ${name}`);
  return n;
}

function optInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(n) ? n : null;
}

function optStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function intArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => optInt(v)).filter((n): n is number => n !== null);
}

const NOT_FOUND: DispatchResponse = {
  status: 404,
  body: { message: 'Not available in the mobile build.' },
};

function ok(body: unknown): DispatchResponse {
  return { status: 200, body };
}

const NO_CONTENT: DispatchResponse = { status: 204, body: undefined };

/** Split a path into decoded segments plus its query string. */
function parse(path: string): { segments: string[]; query: URLSearchParams } {
  const [rawPath, rawQuery = ''] = path.split('?', 2);
  return {
    segments: rawPath.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(rawQuery),
  };
}

function isFresh(query: URLSearchParams): boolean {
  const value = query.get('fresh');
  return value === '1' || value === 'true';
}

/** The client consumes JiraUser[]; DC assignable-user search yields names. */
function toJiraUser(displayName: string): JiraUser {
  return { accountId: '', displayName, emailAddress: null, avatarUrl: null, active: true };
}

function emptyCredentials(): Credentials {
  return {
    email: '',
    jiraBaseUrl: '',
    jiraPat: '',
    instanceType: 'datacenter',
    defaultProjectKey: 'ISW',
    testRailBaseUrl: '',
    testRailEmail: '',
    testRailApiKey: '',
    confluenceBaseUrl: '',
    confluencePat: '',
  };
}

/** mcpServerEnv may hold user-entered tokens — never echo the values. */
function redacted(settings: AppSettings): AppSettings {
  const env = settings.mcpServerEnv ?? {};
  return { ...settings, mcpServerEnv: Object.fromEntries(Object.keys(env).map((k) => [k, '•••'])) };
}

/**
 * Translate a thrown error into a response. JiraError and DispatchError carry
 * their own status; TestRail failures keep the {error, statusCode, body} shape
 * that TrApiError on the client parses.
 */
function errorResponse(err: unknown): DispatchResponse {
  const e = err as {
    name?: string;
    status?: number;
    statusCode?: number | null;
    body?: string | null;
    message?: string;
    extra?: Record<string, unknown> | null;
  };
  const message = e.message ?? 'Request failed.';
  if (e.name === 'TestRailNotConnectedError') return { status: 401, body: { error: message } };
  if (e.name === 'TestRailApiError') {
    return { status: 502, body: { error: message, statusCode: e.statusCode ?? null, body: e.body ?? null } };
  }
  if (e.name === 'DispatchError') {
    return { status: e.status ?? 500, body: { message, ...(e.extra ?? {}) } };
  }
  return { status: typeof e.status === 'number' ? e.status : 500, body: { message } };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function createDispatcher(core: Core, options: DispatcherOptions = {}): Dispatch {
  // Default to the graph's own clock so freshness checks and cache stamps agree.
  const now = options.now ?? (() => new Date(core.now()));

  /** Session default project key falling back to AppSettings then "ISW". */
  function defaultProjectKey(): string {
    const fromSession = core.session.profile?.defaultProjectKey?.trim();
    if (fromSession) return fromSession;
    try {
      const fromSettings = core.settings.get().defaultProjectKey?.trim();
      if (fromSettings) return fromSettings;
    } catch {
      // settings failures must not break project resolution
    }
    return 'ISW';
  }

  function authStatus(): unknown {
    const profile = core.session.profile;
    return {
      connected: core.session.isConnected,
      user: core.session.currentUser,
      profile: profile
        ? {
            email: profile.email,
            jiraBaseUrl: profile.jiraBaseUrl,
            instanceType: profile.instanceType,
            defaultProjectKey: profile.defaultProjectKey,
          }
        : null,
    };
  }

  /** Build a full profile from a login body, preserving saved integrations. */
  function credentialsFromBody(body: Record<string, unknown>): Credentials {
    const saved = core.credentials.load();
    return {
      email: typeof body.email === 'string' ? body.email : '',
      jiraBaseUrl:
        typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl : DEFAULT_JIRA_BASE_URL,
      jiraPat: requireString(body.pat, 'pat'),
      instanceType: body.instanceType === 'cloud' ? 'cloud' : 'datacenter',
      defaultProjectKey: defaultProjectKey(),
      testRailBaseUrl: saved?.testRailBaseUrl ?? '',
      testRailEmail: saved?.testRailEmail ?? '',
      testRailApiKey: saved?.testRailApiKey ?? '',
      confluenceBaseUrl: saved?.confluenceBaseUrl ?? '',
      confluencePat: saved?.confluencePat ?? '',
    };
  }

  async function authRoute(method: string, rest: string[], b: Record<string, unknown>): Promise<DispatchResponse> {
    const action = rest[0];
    if (method === 'GET' && action === 'status') return ok(authStatus());
    if (method === 'POST' && action === 'test') {
      return ok(await core.testConnection(credentialsFromBody(b), options.probe));
    }
    if (method === 'POST' && action === 'login') {
      const credentials = credentialsFromBody(b);
      const user = await core.testConnection(credentials, options.probe);
      core.credentials.save(credentials);
      core.session.activate(credentials, user);
      return ok(authStatus());
    }
    if (method === 'POST' && action === 'logout') {
      // Disconnect Jira without destroying an independent TestRail connection.
      const saved = core.credentials.load();
      if (saved) core.credentials.save({ ...saved, email: '', jiraBaseUrl: '', jiraPat: '' });
      else core.credentials.clear();
      core.session.clear();
      return NO_CONTENT;
    }
    return NOT_FOUND;
  }

  /** MyWork delta semantics (ui-parity §2 "Loading / delta fetch"). */
  async function cachedSearch(b: Record<string, unknown>): Promise<DispatchResponse> {
    const cacheKey = requireString(b.cacheKey, 'cacheKey');
    const jql = requireString(b.jql, 'jql');
    const maxResults = typeof b.maxResults === 'number' ? b.maxResults : 200;

    const cached = core.issueCache.getCached(cacheKey);
    const lastRefresh = core.issueCache.getLastRefresh(cacheKey);
    const fresh = lastRefresh !== null && now().getTime() - lastRefresh.getTime() < CACHE_FRESH_MS;

    let issues: JiraIssue[];
    let totalCount: number;
    let fromCache: boolean;

    if (cached.length > 0 && fresh && lastRefresh) {
      const deltaJql = injectUpdatedClause(jql, new Date(lastRefresh.getTime() - DELTA_SLACK_MS));
      const delta = await core.issues.searchIssues(deltaJql, 0, maxResults);
      // Merge by key (ci): updated rows replace in place, new rows append.
      const byKey = new Map<string, JiraIssue>();
      for (const issue of cached) byKey.set(issue.key.toLowerCase(), issue);
      for (const issue of delta.items) byKey.set(issue.key.toLowerCase(), issue);
      issues = [...byKey.values()];
      totalCount = issues.length;
      fromCache = true;
    } else {
      const result = await core.issues.searchIssues(jql, 0, maxResults);
      issues = result.items;
      totalCount = result.total;
      fromCache = false;
    }

    core.issueCache.saveCache(cacheKey, issues);
    const refreshed = core.issueCache.getLastRefresh(cacheKey);
    return ok({ issues, totalCount, fromCache, lastRefresh: (refreshed ?? now()).toISOString() });
  }

  async function issuesRoute(method: string, rest: string[], b: Record<string, unknown>): Promise<DispatchResponse> {
    if (method === 'POST' && rest[0] === 'search') {
      const startAt = typeof b.startAt === 'number' ? b.startAt : 0;
      const maxResults = typeof b.maxResults === 'number' ? b.maxResults : 100;
      return ok(await core.issues.searchIssues(requireString(b.jql, 'jql'), startAt, maxResults));
    }
    if (method === 'POST' && rest[0] === 'cached-search') return cachedSearch(b);

    const key = rest[0];
    if (!key) return NOT_FOUND;
    const sub = rest[1];

    if (method === 'GET' && sub === undefined) return ok(await core.issues.getIssueDetails(key));
    if (method === 'GET' && sub === 'timeline') return ok(await core.issues.getIssueTimeline(key));
    if (method === 'GET' && sub === 'transitions' && rest[2] === undefined) {
      return ok(await core.issues.getTransitions(key));
    }
    if (method === 'GET' && sub === 'transitions' && rest[3] === 'screen') {
      return ok(await core.issues.getTransitionScreen(key, rest[2]));
    }
    if (method === 'POST' && sub === 'transitions') {
      const id = requireString(b.id, 'id');
      const fields =
        b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields)
          ? (b.fields as Record<string, unknown>)
          : null;
      const comment = optStr(b.comment);
      const assignee = optStr(b.assignee);
      const timeSpent = optStr(b.timeSpent);
      if (fields || comment || assignee || timeSpent) {
        await core.issues.performTransitionWithData(key, id, fields ?? {}, comment, assignee, timeSpent);
      } else {
        await core.issues.performTransition(key, id);
      }
      // Status changed — cached search results are stale.
      core.issueCache.clearAll();
      return NO_CONTENT;
    }
    if (method === 'POST' && sub === 'comments') {
      await core.issues.addComment(key, requireString(b.body, 'body'));
      return NO_CONTENT;
    }
    if (method === 'POST' && sub === 'labels') {
      await core.issues.addLabel(key, requireString(b.label, 'label'));
      return NO_CONTENT;
    }
    if (method === 'PUT' && sub === 'assignee') {
      await core.issues.setAssignee(key, requireString(b.assignee, 'assignee'));
      return NO_CONTENT;
    }
    if (method === 'GET' && sub === 'worklogs') return ok(await core.worklogs.getWorklogs(key));
    if (method === 'POST' && sub === 'worklogs') {
      const seconds = b.seconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        throw new DispatchError(400, 'Missing required parameter: seconds');
      }
      const started = requireString(b.started, 'started');
      const adjustEstimate =
        typeof b.adjustEstimate === 'string' && b.adjustEstimate.length > 0 ? b.adjustEstimate : 'auto';
      return ok(
        await core.worklogs.addWorklog(
          key,
          seconds,
          started,
          optStr(b.comment),
          adjustEstimate as never,
          optStr(b.adjustValue),
        ),
      );
    }
    return NOT_FOUND;
  }

  function settingsRoute(method: string, rest: string[], b: Record<string, unknown>): DispatchResponse {
    if (method === 'GET' && rest.length === 0) return ok(redacted(core.settings.get()));
    if (method === 'PUT' && rest.length === 0) {
      // Load-then-merge-then-save: only known AppSettings keys are applied.
      const merged = { ...core.settings.get() } as Record<string, unknown>;
      for (const [key, value] of Object.entries(b)) {
        if (!KNOWN_SETTINGS_KEYS.has(key) || value === undefined) continue;
        if (key === 'defaultProjectKey') {
          // Interpolated unquoted into JQL — keep it a plain project key.
          const v = String(value).trim().toUpperCase();
          if (!/^[A-Z][A-Z0-9_]*$/.test(v)) {
            throw new DispatchError(400, `Invalid project key: ${String(value)}`);
          }
          merged[key] = v;
          continue;
        }
        if (key === 'mcpServerEnv' && value !== null && typeof value === 'object') {
          // Masked values from GET must not clobber the stored secrets.
          const prev = (merged.mcpServerEnv ?? {}) as Record<string, string>;
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            next[k] = String(v) === '•••' ? (prev[k] ?? '') : String(v);
          }
          merged[key] = next;
          continue;
        }
        merged[key] = value;
      }
      const settings = merged as unknown as AppSettings;
      core.settings.save(settings);
      return ok(redacted(settings));
    }
    if (method === 'POST' && rest[0] === 'clear-issue-cache') {
      core.issueCache.clearAll();
      return NO_CONTENT;
    }
    if (method === 'POST' && (rest[0] === 'hard-refresh' || rest[0] === 'clear-caches')) {
      core.issueCache.clearAll();
      core.metadataCache.clearAll();
      core.issues.resetFieldCache();
      if (rest[0] === 'clear-caches') core.testrail.clearCache();
      return NO_CONTENT;
    }
    if (method === 'POST' && rest[0] === 'disconnect-all') {
      if (String(b.confirmation ?? '') !== 'DISCONNECT') {
        throw new DispatchError(400, 'Confirmation must be DISCONNECT.');
      }
      core.credentials.clear();
      core.session.clear();
      core.testrail.disconnect();
      return NO_CONTENT;
    }
    return NOT_FOUND;
  }

  async function metadataRoute(method: string, rest: string[], query: URLSearchParams): Promise<DispatchResponse> {
    if (method !== 'GET') return NOT_FOUND;
    const project = query.get('project') || defaultProjectKey();
    switch (rest[0]) {
      case 'projects':
        return ok(await core.metadata.getProjects());
      case 'issuetypes':
        return ok(await core.metadata.getIssueTypes());
      case 'statuses':
        return ok(await core.metadata.getStatuses());
      case 'status-map':
        return ok(await core.metadata.getStatusMap());
      case 'priorities':
        return ok(await core.metadata.getPriorities());
      case 'resolutions':
        return ok(await core.metadata.getResolutions());
      case 'fields':
        return ok(await core.metadata.getFields());
      case 'users':
        return ok((await core.metadata.getAssignableUsers(project)).map(toJiraUser));
      case 'versions':
        return ok(await core.metadata.getVersions(project));
      case 'components':
        return ok(await core.metadata.getComponents(project));
      case 'suggestions':
        return ok(await core.metadata.getFieldSuggestions(requireString(query.get('field'), 'field'), query.get('query')));
      case 'distinct': {
        // project is interpolated unquoted into JQL — key charset only.
        if (!/^[A-Z][A-Z0-9_]*$/i.test(project)) {
          throw new DispatchError(400, `Invalid project key: ${project}`);
        }
        const field = requireString(query.get('field'), 'field');
        const rawMax = Number(query.get('max'));
        const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 5000;
        return ok(await core.getDistinct(project, field, max));
      }
      default:
        return NOT_FOUND;
    }
  }

  async function testrailRoute(
    method: string,
    rest: string[],
    query: URLSearchParams,
    b: unknown,
  ): Promise<DispatchResponse> {
    const service = core.testrail;
    const fresh = isFresh(query);
    const body = (b ?? {}) as Record<string, unknown>;
    const [head, second, third] = rest;

    if (head === 'session') {
      if (method === 'GET') return ok(service.status());
      if (method === 'POST') {
        const baseUrl =
          typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl : DEFAULT_TESTRAIL_BASE_URL;
        const email = requireString(body.email, 'email');
        const apiKey = requireString(body.apiKey, 'apiKey');
        const user = await service.connect({ baseUrl, email, apiKey });
        const saved = core.credentials.load() ?? emptyCredentials();
        core.credentials.save({ ...saved, testRailBaseUrl: baseUrl, testRailEmail: email, testRailApiKey: apiKey });
        return ok({ connected: true, user });
      }
      if (method === 'DELETE') {
        service.disconnect();
        const saved = core.credentials.load();
        if (saved) {
          core.credentials.save({ ...saved, testRailBaseUrl: '', testRailEmail: '', testRailApiKey: '' });
        }
        return NO_CONTENT;
      }
      return NOT_FOUND;
    }

    if (method === 'GET' && head === 'meta') {
      const projectId = optInt(query.get('projectId'));
      return ok(await service.cachedJson(`meta:${projectId ?? ''}`, () => service.fetchMeta(projectId), fresh));
    }

    if (method === 'GET' && head === 'projects' && second === undefined) {
      return ok(await service.cachedJson('projects', () => service.requireClient().getProjects(), fresh));
    }

    if (head === 'projects' && second !== undefined) {
      const pid = requireInt(second, 'projectId');
      if (method === 'GET' && third === 'suites') {
        return ok(await service.cachedJson(`suites:${pid}`, () => service.requireClient().getSuites(pid), fresh));
      }
      if (method === 'GET' && third === 'runs') {
        return ok(await service.cachedJson(`runs:${pid}`, () => service.requireClient().getRuns(pid), fresh));
      }
      if (method === 'GET' && third === 'planruns') {
        return ok(await service.cachedJson(`planruns:${pid}`, () => service.requireClient().getPlanRuns(pid), fresh));
      }
      if (method === 'POST' && third === 'runs') {
        const includeAll = body.includeAll === true;
        return ok(
          await service.requireClient().addRun(pid, {
            suiteId: optInt(body.suiteId),
            name: requireString(body.name, 'name'),
            description: optStr(body.description),
            refs: optStr(body.refs),
            assignedToId: optInt(body.assignedToId),
            includeAll,
            caseIds: includeAll ? undefined : intArray(body.caseIds),
          }),
        );
      }
      return NOT_FOUND;
    }

    if (head === 'runs' && second !== undefined) {
      const runId = requireInt(second, 'runId');
      if (method === 'GET' && third === 'tests') {
        return ok(await service.cachedJson(`tests:${runId}`, () => service.requireClient().getTests(runId), fresh));
      }
      if (method === 'GET' && third === 'results') {
        return ok(
          await service.cachedJson(
            `runresults:${runId}`,
            () => service.requireClient().getResultsForRun(runId),
            fresh,
          ),
        );
      }
      if (method === 'PUT' && third === undefined) {
        return ok(
          await service.requireClient().updateRun(runId, {
            name: optStr(body.name),
            description: optStr(body.description),
            refs: optStr(body.refs),
          }),
        );
      }
      if (method === 'POST' && third === 'close') {
        await service.requireClient().closeRun(runId);
        return NO_CONTENT;
      }
      if (method === 'DELETE' && third === undefined) {
        await service.requireClient().deleteRun(runId);
        return NO_CONTENT;
      }
      return NOT_FOUND;
    }

    if (head === 'tests' && second !== undefined && third === 'results') {
      const testId = requireInt(second, 'testId');
      if (method === 'GET') return ok(await service.requireClient().getResultsForTest(testId));
      if (method === 'POST') {
        await service.requireClient().addResultExtended(testId, {
          statusId: requireInt(body.statusId, 'statusId'),
          comment: optStr(body.comment),
          defects: optStr(body.defects),
          elapsed: optStr(body.elapsed),
          version: optStr(body.version),
        });
        return NO_CONTENT;
      }
      return NOT_FOUND;
    }

    if (method === 'POST' && head === 'prefetch' && second === undefined) {
      return ok(service.prefetch(intArray(body.projectIds)));
    }
    if (method === 'GET' && head === 'prefetch' && second === 'status') return ok(service.prefetchStatus());
    if (method === 'DELETE' && head === 'cache') {
      service.clearCache();
      return NO_CONTENT;
    }
    if (head === 'people') {
      if (method === 'GET') return ok(service.getPeople());
      if (method === 'PUT') {
        if (b === null || typeof b !== 'object' || Array.isArray(b)) {
          throw new DispatchError(400, 'People payload must be an object of id -> name.');
        }
        service.setPeople(b as Record<string, unknown>);
        return NO_CONTENT;
      }
    }
    return NOT_FOUND;
  }

  async function route(
    method: string,
    segments: string[],
    query: URLSearchParams,
    body: unknown,
  ): Promise<DispatchResponse> {
    const [api, group, ...rest] = segments;
    if (api !== 'api') return NOT_FOUND;
    const b = (body ?? {}) as Record<string, unknown>;

    switch (group) {
      case 'auth':
        return authRoute(method, rest, b);
      case 'issues':
        return issuesRoute(method, rest, b);
      case 'settings':
        return settingsRoute(method, rest, b);
      case 'metadata':
        return metadataRoute(method, rest, query);
      case 'testrail':
        return testrailRoute(method, rest, query, body);
      // Saved filters are desktop-only in Phase 1; an empty list keeps the
      // Backlog's JQL dialog working instead of throwing.
      case 'filters':
        return method === 'GET' && rest.length === 0 ? ok([]) : NOT_FOUND;
      default:
        return NOT_FOUND;
    }
  }

  return async (method, path, body) => {
    const { segments, query } = parse(path);
    try {
      return await route(method.toUpperCase(), segments, query, body);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
