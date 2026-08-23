// In-process route dispatcher. Answers the same (method, path, body) contract
// the Express routes answer, so client/src/api/* needs no per-endpoint change
// and the views need no change at all. Only the Phase 1 mobile surface exists
// here; every other path 404s loudly rather than silently misbehaving.
//
// Handlers are ports of server/src/routes/{auth,issues,settings,misc,testrail}
// and must keep the same status codes, payload shapes and validation messages.

import type { Core } from './composition.js';
import type { TrAddCasePayload } from './testrail/types.js';
import { INCIDENT_FILTERS } from './jira/incidentCatalog.js';
import { buildIncidentJql } from './jira/jqlBuilder.js';
import { jqlQuote } from './jira/jqlEscape.js';
import { BOARDS_CACHE_KEY } from './jira/cached.js';
import type { TimeLoggedPeriod } from './jira/timeLogged.js';
import { apiPrefix, jiraFetch } from './jira/httpClient.js';
import type {
  BoardWorkspace,
  JiraFilterSelection,
  PinnedBoard,
  SavedFilter,
  Team,
} from './types.js';
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

/** Single-profile deployment — fixed pinned-board / workspace profile id. */
const PINNED_PROFILE_ID = '00000000-0000-0000-0000-000000000000';

const INCIDENT_MAX_RESULTS = 200;
const DISTINCT_MAX = 5000;

const PEOPLE_FIELDS = new Set(['assignee', 'reporter', 'primary developer', 'primary tester']);
const VERSION_FIELDS = new Set([
  'fixversion',
  'fix version/s',
  'affectedversion',
  'affects version',
  'affects version/s',
]);
const COMPONENT_FIELDS = new Set(['components', 'component']);

const TIME_PERIODS: ReadonlySet<string> = new Set([
  'today',
  'yesterday',
  'thisWeek',
  'previousWeek',
  'thisMonth',
  'customRange',
]);

/** C# `.Trim('"')` — strip all leading/trailing double quotes. */
function stripQuotes(value: string): string {
  return value.replace(/^"+/, '').replace(/"+$/, '');
}

function parseSelections(raw: unknown): JiraFilterSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: JiraFilterSelection[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const filterId = (el as Record<string, unknown>).filterId;
    const values = (el as Record<string, unknown>).values;
    if (typeof filterId !== 'string' || filterId.length === 0) continue;
    out.push({
      filterId,
      values: Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [],
    });
  }
  return out;
}

function parseDate(value: string | null, name: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new DispatchError(400, `Invalid date for ${name}: ${value}`);
  return d;
}

function numericId(raw: string, name: string): number {
  const id = Number(raw);
  if (!Number.isFinite(id)) throw new DispatchError(400, `Invalid ${name}: ${raw}`);
  return id;
}

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

/** [{content, expected}] rows for custom_steps_separated; null when absent. */
function stepRows(value: unknown): Array<{ content: string; expected: string }> | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        content: typeof r.content === 'string' ? r.content : '',
        expected: typeof r.expected === 'string' ? r.expected : '',
      };
    })
    .filter((r) => r.content.trim().length > 0 || r.expected.trim().length > 0);
}

function casePayload(body: Record<string, unknown>): TrAddCasePayload {
  return {
    title: requireString(body.title, 'title'),
    typeId: optInt(body.typeId),
    priorityId: optInt(body.priorityId),
    estimate: optStr(body.estimate),
    refs: optStr(body.refs),
    description: optStr(body.description),
    preconds: optStr(body.preconds),
    steps: optStr(body.steps),
    stepsSeparated: stepRows(body.stepsSeparated),
    expected: optStr(body.expected),
    ownerId: optInt(body.ownerId),
  };
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

/**
 * Time-boxed memo with in-flight de-duplication.
 *
 * The dashboard snapshot is the most expensive call in the product and the
 * client can poll it on a timer; the Express routes always wrapped it this way
 * and the first mobile dispatcher did not, so every visit to Home paid full
 * price. Concurrent callers share one promise so a burst cannot stampede.
 */
function ttlMemo<T>(ttlMs: number, load: () => Promise<T>): (fresh: boolean) => Promise<T> {
  let cached: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  return (fresh: boolean) => {
    const now = Date.now();
    if (!fresh && cached && now - cached.at < ttlMs) return Promise.resolve(cached.value);
    if (!inflight) {
      inflight = load()
        .then((value) => {
          cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

export function createDispatcher(core: Core, options: DispatcherOptions = {}): Dispatch {
  const snapshot = ttlMemo(60_000, () => core.aggregator.buildDashboardSnapshot());
  const dashboardList = ttlMemo(10 * 60_000, () => core.dashboards.getDashboards());
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
    // The saved identity carries no secret, and travels even while
    // disconnected so a re-login only has to ask for the token.
    const saved = core.credentials.load();
    return {
      connected: core.session.isConnected,
      user: core.session.currentUser,
      profile: profile
        ? {
            email: profile.email,
            jiraBaseUrl: profile.jiraBaseUrl,
            instanceType: profile.instanceType,
            defaultProjectKey: profile.defaultProjectKey,
            authMode: profile.authMode,
          }
        : null,
      saved:
        saved && saved.email.trim().length > 0
          ? { email: saved.email, jiraBaseUrl: saved.jiraBaseUrl, instanceType: saved.instanceType }
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
      // Signing in with HP OneUID stores no token at all: the SAML cookie is
      // the only credential, and any previously stored token is dropped so
      // nothing long-lived is left behind on the device.
      jiraPat: body.authMode === 'sso' ? '' : requireString(body.pat, 'pat'),
      instanceType: body.instanceType === 'cloud' ? 'cloud' : 'datacenter',
      defaultProjectKey: defaultProjectKey(),
      testRailBaseUrl: saved?.testRailBaseUrl ?? '',
      testRailEmail: saved?.testRailEmail ?? '',
      testRailApiKey: saved?.testRailApiKey ?? '',
      confluenceBaseUrl: saved?.confluenceBaseUrl ?? '',
      confluencePat: saved?.confluencePat ?? '',
      authMode: body.authMode === 'sso' ? 'sso' : saved?.authMode,
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
      if (saved) {
        core.credentials.save({
          ...saved,
          email: '',
          jiraBaseUrl: '',
          jiraPat: '',
          authMode: saved.testRailBaseUrl && saved.authMode === 'sso' ? 'sso' : undefined,
        });
      }
      else core.credentials.clear();
      core.session.clear();
      core.issueCache.clearAll();
      core.metadataCache.clearAll();
      core.issues.resetFieldCache();
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
    // Freshness is measured from the last FULL query, not the last write:
    // deltas only add and replace rows, so without a periodic full re-run an
    // issue that leaves the JQL scope would stay on screen forever.
    const lastFull = core.issueCache.getLastFullRefresh(cacheKey);
    const fresh = lastFull !== null && now().getTime() - lastFull.getTime() < CACHE_FRESH_MS;

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

    core.issueCache.saveCache(cacheKey, issues, !fromCache);
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
    if (method === 'POST' && rest[0] === 'erase-local-data') {
      if (String(b.confirmation ?? '') !== 'ERASE') {
        throw new DispatchError(400, 'Confirmation must be ERASE.');
      }
      core.credentials.clear();
      core.session.clear();
      core.testrail.disconnect();
      core.clearLocalData();
      core.issues.resetFieldCache();
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
        // Under SSO the cookie authenticates, so the key may legitimately be
        // blank; every other caller still has to supply one.
        // Same rule as Jira: an SSO sign-in stores no API key.
        const cookieAuth = body.cookieAuth === true;
        const apiKey = cookieAuth ? '' : requireString(body.apiKey, 'apiKey');
        const user = await service.connect({ baseUrl, email, apiKey, cookieAuth });
        const saved = core.credentials.load() ?? emptyCredentials();
        core.credentials.save({
          ...saved,
          testRailBaseUrl: baseUrl,
          testRailEmail: email,
          testRailApiKey: apiKey,
          authMode: cookieAuth ? 'sso' : saved.authMode,
        });
        return ok({ connected: true, user });
      }
      if (method === 'DELETE') {
        service.disconnect();
        service.clearCache();
        service.setPeople({});
        const saved = core.credentials.load();
        if (saved) {
          core.credentials.save({
            ...saved,
            testRailBaseUrl: '',
            testRailEmail: '',
            testRailApiKey: '',
            authMode: saved.jiraBaseUrl && saved.authMode === 'sso' ? 'sso' : undefined,
          });
        }
        return NO_CONTENT;
      }
      return NOT_FOUND;
    }

    if (method === 'GET' && head === 'users' && second !== undefined) {
      const userId = requireInt(second, 'userId');
      // Cached like any other reference lookup; names change rarely.
      return ok(await service.cachedJson(`user:${userId}`, () => service.requireClient().getUser(userId), fresh));
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
      if (method === 'GET' && third === 'sections') {
        const suiteId = optInt(query.get('suiteId'));
        return ok(
          await service.cachedJson(
            `sections:${pid}:${suiteId ?? ''}`,
            () => service.requireClient().getSections(pid, suiteId),
            fresh,
          ),
        );
      }
      if (method === 'GET' && third === 'cases') {
        const suiteId = optInt(query.get('suiteId'));
        const sectionId = optInt(query.get('sectionId'));
        return ok(
          await service.cachedJson(
            `cases:${pid}:${suiteId ?? ''}:${sectionId ?? ''}`,
            () => service.requireClient().getCases(pid, suiteId, sectionId),
            fresh,
          ),
        );
      }
      if (method === 'POST' && third === 'sections') {
        return ok(
          await service.requireClient().addSection(pid, {
            suiteId: optInt(body.suiteId),
            parentId: optInt(body.parentId),
            name: requireString(body.name, 'name'),
            description: optStr(body.description),
          }),
        );
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

    if (head === 'sections' && second !== undefined) {
      const sectionId = requireInt(second, 'sectionId');
      if (method === 'PUT' && third === undefined) {
        return ok(
          await service
            .requireClient()
            .updateSection(sectionId, requireString(body.name, 'name'), optStr(body.description)),
        );
      }
      if (method === 'DELETE' && third === undefined) {
        await service.requireClient().deleteSection(sectionId);
        return NO_CONTENT;
      }
      if (method === 'POST' && third === 'move') {
        await service.requireClient().moveSection(sectionId, optInt(body.parentId), optInt(body.afterId));
        return NO_CONTENT;
      }
      if (method === 'POST' && third === 'cases') {
        return ok(await service.requireClient().addCase(sectionId, casePayload(body)));
      }
      return NOT_FOUND;
    }

    if (head === 'cases' && second !== undefined) {
      // Bulk partial edit — only provided fields change on each selected case.
      if (method === 'PUT' && second === 'bulk') {
        const ids = intArray(body.caseIds);
        if (ids.length === 0) throw new DispatchError(400, 'caseIds is required');
        const set = (body.set ?? {}) as Record<string, unknown>;
        const fields: Record<string, unknown> = {};
        if (optInt(set.ownerId) !== null) fields.custom_testcaseowner = optInt(set.ownerId);
        if (optInt(set.assignedToId) !== null) fields.case_assignedto_id = optInt(set.assignedToId);
        if (optInt(set.priorityId) !== null) fields.priority_id = optInt(set.priorityId);
        if (optInt(set.typeId) !== null) fields.type_id = optInt(set.typeId);
        if (typeof set.estimate === 'string' && set.estimate.trim()) fields.estimate = set.estimate.trim();
        if (typeof set.refs === 'string' && set.refs.trim()) fields.refs = set.refs.trim();
        if (Object.keys(fields).length === 0) throw new DispatchError(400, 'No fields to set');

        const client = service.requireClient();
        const failures: Array<{ id: number; error: string }> = [];
        let next = 0;
        const worker = async (): Promise<void> => {
          for (;;) {
            const i = next++;
            if (i >= ids.length) return;
            try {
              await client.updateCaseFields(ids[i], fields);
            } catch (err) {
              failures.push({ id: ids[i], error: err instanceof Error ? err.message : String(err) });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, ids.length) }, () => worker()));
        return ok({ updated: ids.length - failures.length, failures });
      }
      if (method === 'POST' && second === 'copy') {
        await service
          .requireClient()
          .copyCasesToSection(requireInt(body.targetSectionId, 'targetSectionId'), intArray(body.caseIds));
        return NO_CONTENT;
      }
      if (method === 'POST' && second === 'move') {
        await service
          .requireClient()
          .moveCasesToSection(
            requireInt(body.targetSectionId, 'targetSectionId'),
            optInt(body.targetSuiteId),
            intArray(body.caseIds),
          );
        return NO_CONTENT;
      }
      const caseId = requireInt(second, 'caseId');
      if (method === 'PUT') return ok(await service.requireClient().updateCase(caseId, casePayload(body)));
      if (method === 'DELETE') {
        await service.requireClient().deleteCase(caseId);
        return NO_CONTENT;
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

  async function boardsRoute(
    method: string,
    rest: string[],
    query: URLSearchParams,
  ): Promise<DispatchResponse> {
    if (method !== 'GET') return NOT_FOUND;
    if (rest.length === 0) {
      if (query.get('force')) core.metadataCache.delete(BOARDS_CACHE_KEY);
      return ok((await core.boards.getBoards()).boards);
    }
    // Raw JQL of a board's saved filter — board mode rewrites it.
    if (rest[0] === 'filter' && rest[2] === 'jql') {
      const id = numericId(rest[1], 'board id');
      const prefix = apiPrefix(core.session.profile?.instanceType ?? 'datacenter');
      const filter = (await jiraFetch(core.session, `${prefix}/filter/${id}`)) as { jql?: unknown } | null;
      return ok({ jql: typeof filter?.jql === 'string' ? filter.jql : null });
    }
    const boardId = numericId(rest[0], 'board id');
    if (rest[1] === 'sprints') return ok(await core.boards.getActiveSprints(boardId));
    if (rest[1] === 'issues') return ok(await core.boards.getBoardIssues(boardId, query.get('jql') ?? undefined));
    if (rest[1] === 'quickfilters') return ok(await core.boards.getQuickFilters(boardId));
    return NOT_FOUND;
  }

  async function incidentsRoute(
    method: string,
    rest: string[],
    b: Record<string, unknown>,
  ): Promise<DispatchResponse> {
    if (method === 'POST' && rest[0] === 'search') {
      // Summary search stays client-side; body.summarySearch is accepted and ignored.
      const jql = buildIncidentJql(INCIDENT_FILTERS, parseSelections(b.selections), defaultProjectKey());
      const [all, verification, rejected] = await Promise.all([
        core.issues.searchIssues(jql.main, 0, INCIDENT_MAX_RESULTS),
        core.issues.searchIssues(jql.verification, 0, INCIDENT_MAX_RESULTS),
        core.issues.searchIssues(jql.rejected, 0, INCIDENT_MAX_RESULTS),
      ]);
      return ok({ all: all.items, verification: verification.items, rejected: rejected.items });
    }
    if (method === 'GET' && rest[0] === 'definitions') return ok(INCIDENT_FILTERS);
    if (method === 'GET' && rest[0] === 'filter-options' && rest[1] !== undefined) {
      const def = INCIDENT_FILTERS.find((f) => f.id.toLowerCase() === rest[1].toLowerCase());
      if (!def) throw new DispatchError(404, `Unknown incident filter: ${rest[1]}`);
      const field = stripQuotes((def.jiraFieldName ?? def.displayName).trim());
      const lower = field.toLowerCase();
      const project = defaultProjectKey();

      if (lower === 'priority') return ok(await core.metadata.getPriorities());
      if (lower === 'status') return ok(await core.metadata.getStatuses());
      if (lower === 'issuetype') return ok(await core.metadata.getIssueTypes());

      let options = await core.getDistinct(project, field, DISTINCT_MAX);
      if (options.length === 0 && VERSION_FIELDS.has(lower)) {
        options = await core.metadata.getVersions(project);
      } else if (options.length === 0 && COMPONENT_FIELDS.has(lower)) {
        options = await core.metadata.getComponents(project);
      } else if (options.length === 0 && !PEOPLE_FIELDS.has(lower)) {
        options = await core.metadata.getFieldSuggestions(field);
      }
      return ok(options);
    }
    return NOT_FOUND;
  }

  async function timeLoggedRoute(
    method: string,
    rest: string[],
    query: URLSearchParams,
  ): Promise<DispatchResponse> {
    if (method !== 'GET') return NOT_FOUND;
    if (rest[0] === 'sprint') return ok(await core.timeLogged.buildReportForSprint(query.get('name') ?? ''));
    if (rest[0] === 'range') {
      const from = parseDate(query.get('from'), 'from');
      const to = parseDate(query.get('to'), 'to');
      if (!from || !to) throw new DispatchError(400, 'Both from and to are required.');
      return ok(await core.timeLogged.buildReportForRange(from, to));
    }
    if (rest.length > 0) return NOT_FOUND;

    const period = query.get('period') ?? 'thisWeek';
    if (!TIME_PERIODS.has(period)) throw new DispatchError(400, `Invalid period: ${period}`);
    // extraJql replaces the default scope; ?user= composes the same default
    // scope pinned to that assignee (the client sends one or the other).
    let extraJql = query.get('extraJql');
    const user = query.get('user');
    if (!extraJql && user) {
      extraJql =
        `project = ${defaultProjectKey()} AND sprint in openSprints() AND assignee = ${jqlQuote(user)}` +
        ' AND issuetype != Incident ORDER BY updated DESC';
    }
    return ok(
      await core.timeLogged.buildReport(
        period as TimeLoggedPeriod,
        parseDate(query.get('from'), 'from'),
        parseDate(query.get('to'), 'to'),
        extraJql,
      ),
    );
  }

  function filtersRoute(method: string, rest: string[], b: Record<string, unknown>): DispatchResponse {
    if (method === 'GET' && rest.length === 0) return ok(core.savedFilters.getAll());
    if (method === 'POST' && rest.length === 0) {
      const filter: SavedFilter = {
        id: typeof b.id === 'string' ? b.id : '',
        name: requireString(b.name, 'name'),
        description: typeof b.description === 'string' ? b.description : null,
        jql: requireString(b.jql, 'jql'),
        isFavorite: b.isFavorite === true,
        created: typeof b.created === 'string' ? b.created : '',
        lastUsed: typeof b.lastUsed === 'string' ? b.lastUsed : null,
      };
      return ok(core.savedFilters.upsert(filter));
    }
    if (method === 'DELETE' && rest[0] !== undefined) {
      core.savedFilters.delete(rest[0]);
      return NO_CONTENT;
    }
    return NOT_FOUND;
  }

  function teamsRoute(method: string, rest: string[], b: Record<string, unknown>): DispatchResponse {
    if (method === 'GET' && rest.length === 0) return ok(core.teams.getAll());
    if (method === 'POST' && rest.length === 0) {
      const team: Team = {
        id: typeof b.id === 'string' ? b.id : '',
        name: requireString(b.name, 'name'),
        members: Array.isArray(b.members) ? b.members.filter((m): m is string => typeof m === 'string') : [],
      };
      return ok(core.teams.upsert(team));
    }
    if (method === 'DELETE' && rest[0] !== undefined) {
      core.teams.delete(rest[0]);
      return NO_CONTENT;
    }
    return NOT_FOUND;
  }

  function pinnedBoardsRoute(method: string, rest: string[], b: Record<string, unknown>): DispatchResponse {
    if (method === 'GET' && rest.length === 0) return ok(core.pinnedBoards.getForProfile(PINNED_PROFILE_ID));
    if (method === 'POST' && rest.length === 0) {
      const board: PinnedBoard = {
        id: typeof b.id === 'string' ? b.id : '',
        profileId: PINNED_PROFILE_ID,
        boardId: typeof b.boardId === 'number' ? b.boardId : Number(b.boardId ?? NaN),
        name: typeof b.name === 'string' ? b.name : '',
        filterId: typeof b.filterId === 'number' ? b.filterId : null,
      };
      if (!Number.isFinite(board.boardId)) throw new DispatchError(400, 'Missing required parameter: boardId');
      return ok(core.pinnedBoards.upsert(board));
    }
    if (method === 'DELETE' && rest[0] !== undefined) {
      core.pinnedBoards.delete(rest[0]);
      return NO_CONTENT;
    }
    return NOT_FOUND;
  }

  function workspacesRoute(method: string, rest: string[], b: Record<string, unknown>): DispatchResponse {
    if (method === 'GET' && rest.length === 0) return ok(core.boardWorkspaces.getForProfile(PINNED_PROFILE_ID));
    if (method === 'POST' && rest[1] === 'default' && rest[0] !== undefined) {
      core.boardWorkspaces.setDefault(rest[0], PINNED_PROFILE_ID);
      return NO_CONTENT;
    }
    if (method === 'POST' && rest.length === 0) {
      const ws: BoardWorkspace = {
        id: typeof b.id === 'string' ? b.id : '',
        profileId: PINNED_PROFILE_ID,
        name: requireString(b.name, 'name'),
        boardIds: intArray(b.boardIds),
        isDefault: b.isDefault === true,
      };
      return ok(core.boardWorkspaces.upsert(ws));
    }
    if (method === 'DELETE' && rest[0] !== undefined) {
      core.boardWorkspaces.delete(rest[0]);
      return NO_CONTENT;
    }
    return NOT_FOUND;
  }

  /**
   * Confluence. Read paths plus connect/disconnect — enough for the mobile
   * screen. Note this only works on the corporate network: the host is
   * internal-only with no external counterpart.
   */
  async function confluenceRoute(
    method: string,
    rest: string[],
    query: URLSearchParams,
    b: Record<string, unknown>,
  ): Promise<DispatchResponse> {
    const service = core.confluence;
    const [head, second, third] = rest;

    if (method === 'GET' && head === 'status') return ok(service.status());

    if (method === 'POST' && head === 'test') {
      return ok(await service.test({ baseUrl: requireString(b.baseUrl, 'baseUrl'), pat: requireString(b.pat, 'pat') }));
    }

    if (method === 'PUT' && head === 'connection') {
      const next = { baseUrl: requireString(b.baseUrl, 'baseUrl'), pat: requireString(b.pat, 'pat') };
      const user = await service.test(next);
      const saved = core.credentials.load() ?? emptyCredentials();
      core.credentials.save({
        ...saved,
        confluenceBaseUrl: next.baseUrl.trim().replace(/\/+$/, ''),
        confluencePat: next.pat.trim(),
      });
      service.disconnect();
      await service.connect();
      return ok({ ...service.status(), user });
    }

    if (method === 'DELETE' && head === 'connection') {
      const saved = core.credentials.load();
      if (saved) core.credentials.save({ ...saved, confluenceBaseUrl: '', confluencePat: '' });
      service.disconnect();
      return NO_CONTENT;
    }

    if (method === 'GET' && head === 'spaces' && second === undefined) {
      return ok(await service.spaces(isFresh(query)));
    }

    if (method === 'GET' && head === 'spaces' && second !== undefined) {
      if (third === 'pages') {
        const startAt = Math.max(0, Number.parseInt(query.get('start') ?? '0', 10) || 0);
        const limit = Math.min(200, Math.max(1, Number.parseInt(query.get('limit') ?? '200', 10) || 200));
        return ok(await service.pages(second, startAt, limit));
      }
      if (third === 'tree') return ok(await service.treeRoots(second));
      return NOT_FOUND;
    }

    if (method === 'GET' && head === 'pages' && second !== undefined) {
      if (third === 'children') return ok(await service.children(second));
      if (third === undefined) return ok(await service.requirePage(second));
      return NOT_FOUND;
    }

    return NOT_FOUND;
  }

  /**
   * Create-issue support for the desktop dialog, which the phone reuses so the
   * field set and validation are identical rather than a second, drifting
   * form. Defaults are the remembered per project+type values.
   */
  async function createRoute(
    method: string,
    rest: string[],
    query: URLSearchParams,
    b: Record<string, unknown>,
  ): Promise<DispatchResponse> {
    if (method === 'GET' && rest[0] === 'meta') {
      return ok(
        await core.createIssues.getCreateMeta(
          requireString(query.get('project'), 'project'),
          requireString(query.get('type'), 'type'),
        ),
      );
    }

    if (rest[0] === 'defaults') {
      const key = requireString(query.get('key'), 'key');
      if (method === 'GET') return ok(core.createDefaults.get(key));
      if (method === 'PUT') {
        core.createDefaults.put(key, b);
        return NO_CONTENT;
      }
      if (method === 'DELETE') {
        core.createDefaults.delete(key);
        return NO_CONTENT;
      }
      return NOT_FOUND;
    }

    if (method === 'POST' && rest[0] === 'issue') {
      const fields =
        b.fields !== null && typeof b.fields === 'object' && !Array.isArray(b.fields)
          ? (b.fields as Record<string, unknown>)
          : {};
      const key = await core.createIssues.createIssue(
        requireString(b.project, 'project'),
        requireString(b.type, 'type'),
        fields,
      );
      return ok({ key });
    }

    return NOT_FOUND;
  }

  /** /api/watch — dashboard change feed, mirroring server/src/routes/watch.ts. */
  async function watchRoute(
    method: string,
    rest: string[],
    body: Record<string, unknown>,
  ): Promise<DispatchResponse> {
    const [sub] = rest;
    if (method === 'GET' && sub === 'feed') return ok(core.watch.feed());
    if (method === 'GET' && sub === 'config') return ok(core.watch.getConfig());
    if (method === 'PUT' && sub === 'config') return ok(core.watch.setConfig(body));
    if (method === 'POST' && sub === 'ack') {
      core.watch.ack();
      return ok(core.watch.feed());
    }
    if (method === 'POST' && sub === 'run') {
      const events = await core.watch.runCycle();
      return ok({ count: events.length, ...core.watch.feed() });
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
      case 'confluence':
        return confluenceRoute(method, rest, query, b);
      case 'boards':
        return boardsRoute(method, rest, query);
      case 'incidents':
        return incidentsRoute(method, rest, b);
      case 'timelogged':
        return timeLoggedRoute(method, rest, query);
      case 'teams':
        return teamsRoute(method, rest, b);
      case 'pinned-boards':
        return pinnedBoardsRoute(method, rest, b);
      case 'board-workspaces':
        return workspacesRoute(method, rest, b);
      case 'dashboard':
        return method === 'GET' && rest[0] === 'snapshot'
          ? ok(await snapshot(isFresh(query)))
          : NOT_FOUND;
      case 'watch':
        return watchRoute(method, rest, b);
      case 'dashboards':
        if (method !== 'GET') return NOT_FOUND;
        return rest.length === 0
          ? ok(await dashboardList(isFresh(query)))
          : ok(await core.dashboards.getDashboardDetails(rest[0]));
      case 'create':
        return createRoute(method, rest, query, b);
      case 'filters':
        return filtersRoute(method, rest, b);
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
