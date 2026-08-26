// Typed fetch wrapper for the JiraWeb server API (Task A7 route contract).
// Errors are thrown as ApiError { status, message }. A 401 anywhere emits a
// `session-lost` event so the app can drop back to the login page.

import type {
  AppSettings,
  AuthStatus,
  DashboardSnapshot,
  JiraBoard,
  JiraCreateIssueMeta,
  JiraDashboardDetails,
  JiraDashboardSummary,
  JiraIssue,
  JiraIssueDetails,
  JiraTimelineEvent,
  JiraQuickFilter,
  JiraSprint,
  JiraTransition,
  JiraTransitionField,
  JiraUser,
  JiraWorklog,
  LoginRequest,
  LumoResult,
  LumoTurn,
  PagedResult,
  PinnedBoard,
  SavedFilter,
  Team,
  TimeLoggedReport,
  ConfluencePage,
  ConfluencePageContent,
  ConfluenceSearchOptions,
  ConfluenceSpace,
  ConfluenceStatus,
  ConfluenceUser,
  WatchConfig,
  WatchFeed,
} from '../types';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const SESSION_LOST_EVENT = 'jiraweb:session-lost';

const sessionLostListeners = new Set<() => void>();

/** Subscribe to 401-triggered session loss. Returns an unsubscribe fn. */
export function onSessionLost(cb: () => void): () => void {
  sessionLostListeners.add(cb);
  return () => sessionLostListeners.delete(cb);
}

function emitSessionLost(): void {
  for (const cb of [...sessionLostListeners]) cb();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT));
  }
}

// ---------------------------------------------------------------------------
// Native dispatch
// ---------------------------------------------------------------------------
// In the Android shell there is no server: the same (method, path, body)
// contract is answered in-process by @mc/core's dispatcher. The slot is typed
// structurally so the desktop bundle never pulls core in.

export interface DispatchResponse {
  status: number;
  body: unknown;
}

export type Dispatch = (method: string, path: string, body?: unknown) => Promise<DispatchResponse>;

let nativeDispatch: Dispatch | null = null;

/** Install the in-process dispatcher; null restores HTTP mode. */
export function setNativeDispatch(dispatch: Dispatch | null): void {
  nativeDispatch = dispatch;
}

/** api/testrail reads the same slot rather than owning a second one. */
export function getNativeDispatch(): Dispatch | null {
  return nativeDispatch;
}

// ---------------------------------------------------------------------------
// Local API token
// ---------------------------------------------------------------------------
// The server gates /api on a per-install token, handed to the browser in the
// launcher's URL fragment and exchanged for an HttpOnly cookie. Holding the
// token in memory lets a later token 401 — a dropped or rotated cookie — redo
// that exchange and replay, instead of dumping the user on the login page with
// an error that has nothing to do with their Jira PAT.

/** Server's wording for a request that failed the local API gate. */
const API_TOKEN_MESSAGE = 'Missing or invalid API token';

let bootstrapToken: string | null = null;

/** Remember the launcher token for the lifetime of the page. */
export function setBootstrapToken(token: string | null): void {
  bootstrapToken = token;
}

/** Exchange the token (or an existing cookie) for a fresh session cookie. */
export async function bootstrapSession(): Promise<boolean> {
  const headers = bootstrapToken ? { 'x-mc-token': bootstrapToken } : undefined;
  try {
    const res = await fetch('/api/bootstrap', { method: 'POST', headers });
    return res.status === 204;
  } catch {
    return false; // server not up yet; the caller reports it
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  if (nativeDispatch) {
    const res = await nativeDispatch(method, path, body);
    if (res.status === 401) emitSessionLost();
    if (res.status >= 400) {
      const data = res.body as { message?: string } | null;
      const message =
        data && typeof data.message === 'string' && data.message
          ? data.message
          : `Request failed (${res.status})`;
      throw new ApiError(res.status, message);
    }
    return res.body as T;
  }

  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string; status?: number };
      if (data && typeof data.message === 'string' && data.message) message = data.message;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      // The local API gate, not Jira: re-run the token exchange once and
      // replay before treating this as a lost Jira session.
      if (message === API_TOKEN_MESSAGE && !retried && (await bootstrapSession())) {
        return request<T>(method, path, body, true);
      }
      emitSessionLost();
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, query?: Query) => request<T>('DELETE', withQuery(path, query)),
};

// ---------------------------------------------------------------------------
// Route groups
// ---------------------------------------------------------------------------

export const auth = {
  test: (req: LoginRequest) => api.post<JiraUser>('/api/auth/test', req),
  login: (req: LoginRequest) => api.post<AuthStatus>('/api/auth/login', req),
  logout: () => api.post<void>('/api/auth/logout'),
  status: () => api.get<AuthStatus>('/api/auth/status'),
};

export const issues = {
  search: (jql: string, startAt = 0, maxResults = 100) =>
    api.post<PagedResult<JiraIssue>>('/api/issues/search', { jql, startAt, maxResults }),
  details: (key: string) => api.get<JiraIssueDetails>(`/api/issues/${encodeURIComponent(key)}`),
  timeline: (key: string) => api.get<JiraTimelineEvent[]>(`/api/issues/${encodeURIComponent(key)}/timeline`),
  transitions: (key: string) => api.get<JiraTransition[]>(`/api/issues/${encodeURIComponent(key)}/transitions`),
  transitionScreen: (key: string, id: string) =>
    api.get<JiraTransitionField[]>(`/api/issues/${encodeURIComponent(key)}/transitions/${encodeURIComponent(id)}/screen`),
  performTransition: (
    key: string,
    body: {
      id: string;
      fields?: Record<string, unknown>;
      comment?: string;
      assignee?: string;
      timeSpent?: string;
      worklogStarted?: string;
    },
  ) => api.post<void>(`/api/issues/${encodeURIComponent(key)}/transitions`, body),
  addComment: (key: string, body: string) =>
    api.post<void>(`/api/issues/${encodeURIComponent(key)}/comments`, { body }),
  addLabel: (key: string, label: string) =>
    api.post<void>(`/api/issues/${encodeURIComponent(key)}/labels`, { label }),
  setAssignee: (key: string, assignee: string) =>
    api.put<void>(`/api/issues/${encodeURIComponent(key)}/assignee`, { assignee }),
  worklogs: (key: string) => api.get<JiraWorklog[]>(`/api/issues/${encodeURIComponent(key)}/worklogs`),
  addWorklog: (
    key: string,
    body: {
      /** Seconds; server rejects < 60. */
      seconds: number;
      /** ISO start timestamp. */
      started: string;
      comment?: string;
      adjustEstimate?: string;
      adjustValue?: string;
    },
  ) => api.post<JiraWorklog>(`/api/issues/${encodeURIComponent(key)}/worklogs`, body),
};

export const boards = {
  list: (force = false) => api.get<JiraBoard[]>('/api/boards', force ? { force: 1 } : undefined),
  sprints: (boardId: number) => api.get<JiraSprint[]>(`/api/boards/${boardId}/sprints`),
  issues: (boardId: number, jql?: string) =>
    api.get<JiraIssue[]>(`/api/boards/${boardId}/issues`, jql ? { jql } : undefined),
  quickFilters: (boardId: number) => api.get<JiraQuickFilter[]>(`/api/boards/${boardId}/quickfilters`),
  filterJql: (filterId: number) => api.get<{ jql: string | null }>(`/api/boards/filter/${filterId}/jql`),
};

export const metadataExtra = {
  resolveUser: (name: string) => api.get<{ username: string | null }>('/api/metadata/resolve-user', { name }),
};

export const dashboard = {
  snapshot: () => api.get<DashboardSnapshot>('/api/dashboard/snapshot'),
};

export const watch = {
  feed: () => api.get<WatchFeed>('/api/watch/feed'),
  ack: () => api.post<WatchFeed>('/api/watch/ack', {}),
  clear: () => api.post<WatchFeed>('/api/watch/clear', {}),
  run: () => api.post<WatchFeed & { count: number }>('/api/watch/run', {}),
  getConfig: () => api.get<WatchConfig>('/api/watch/config'),
  setConfig: (config: WatchConfig) => api.put<WatchConfig>('/api/watch/config', config),
};

export const dashboards = {
  list: () => api.get<JiraDashboardSummary[]>('/api/dashboards'),
  details: (id: string) => api.get<JiraDashboardDetails>(`/api/dashboards/${encodeURIComponent(id)}`),
};

export const timelogged = {
  report: (period: string, opts?: { from?: string; to?: string; user?: string }) =>
    api.get<TimeLoggedReport>('/api/timelogged', { period, ...opts }),
  sprint: (name: string) => api.get<TimeLoggedReport>('/api/timelogged/sprint', { name }),
  range: (from: string, to: string, user?: string) =>
    api.get<TimeLoggedReport>('/api/timelogged/range', { from, to, ...(user ? { user } : {}) }),
};

export const incidents = {
  search: (selections: Array<{ filterId: string; values: string[] }>, summarySearch: string | null) =>
    api.post<{ all: JiraIssue[]; verification: JiraIssue[]; rejected: JiraIssue[] }>('/api/incidents/search', {
      selections,
      summarySearch,
    }),
  filterOptions: (filterId: string) =>
    api.get<string[]>(`/api/incidents/filter-options/${encodeURIComponent(filterId)}`),
};

export const settings = {
  get: () => api.get<AppSettings>('/api/settings'),
  connectionHealth: () => api.get<{
    checkedAt: string;
    services: Array<{ name: string; configured: boolean; ok: boolean; latencyMs: number | null; message: string }>;
  }>('/api/settings/connection-health'),
  /** Server semantics: load-then-mutate — send only the fields to change. */
  put: (partial: Partial<AppSettings>) => api.put<AppSettings>('/api/settings', partial),
  clearIssueCache: () => api.post<void>('/api/settings/clear-issue-cache'),
  hardRefresh: () => api.post<void>('/api/settings/hard-refresh'),
  clearCaches: () => api.post<void>('/api/settings/clear-caches'),
  disconnectAll: () => api.post<void>('/api/settings/disconnect-all', { confirmation: 'DISCONNECT' }),
  eraseLocalData: () => api.post<void>('/api/settings/erase-local-data', { confirmation: 'ERASE' }),
};

export const filters = {
  list: () => api.get<SavedFilter[]>('/api/filters'),
  save: (filter: SavedFilter) => api.post<SavedFilter>('/api/filters', filter),
  remove: (id: string) => api.del<void>(`/api/filters/${encodeURIComponent(id)}`),
};

export const teams = {
  list: () => api.get<Team[]>('/api/teams'),
  save: (team: Team) => api.post<Team>('/api/teams', team),
  remove: (id: string) => api.del<void>(`/api/teams/${encodeURIComponent(id)}`),
};

export const pinnedBoards = {
  list: () => api.get<PinnedBoard[]>('/api/pinned-boards'),
  add: (board: Omit<PinnedBoard, 'id' | 'profileId'>) => api.post<PinnedBoard>('/api/pinned-boards', board),
  remove: (id: string) => api.del<void>(`/api/pinned-boards/${encodeURIComponent(id)}`),
};

export const create = {
  meta: (project: string, type: string) =>
    api.get<JiraCreateIssueMeta>('/api/create/meta', { project, type }),
  issue: (body: { project: string; type: string; fields: Record<string, unknown> }) =>
    api.post<{ key: string }>('/api/create/issue', body),
  getDefaults: (key: string) => api.get<Record<string, unknown>>('/api/create/defaults', { key }),
  putDefaults: (key: string, values: Record<string, unknown>) =>
    api.put<void>(withQuery('/api/create/defaults', { key }), values),
  deleteDefaults: (key: string) => api.del<void>('/api/create/defaults', { key }),
};

export type MetadataKind = 'projects' | 'issuetypes' | 'statuses' | 'priorities' | 'resolutions' | 'fields';

export const metadata = {
  kind: (kind: MetadataKind) => api.get<string[]>(`/api/metadata/${kind}`),
  users: (project?: string) => api.get<JiraUser[]>('/api/metadata/users', project ? { project } : undefined),
  versions: (project?: string) => api.get<string[]>('/api/metadata/versions', project ? { project } : undefined),
  components: (project?: string) => api.get<string[]>('/api/metadata/components', project ? { project } : undefined),
  distinct: (project: string, field: string, max?: number) =>
    api.get<string[]>('/api/metadata/distinct', { project, field, max }),
  suggestions: (field: string, query: string) => api.get<string[]>('/api/metadata/suggestions', { field, query }),
};

export const misc = {
  attachmentProxyUrl: (url: string) => withQuery('/api/misc/attachment-proxy', { url }),
};

export const confluence = {
  status: () => api.get<ConfluenceStatus>('/api/confluence/status'),
  test: (baseUrl: string, pat: string) => api.post<ConfluenceUser>('/api/confluence/test', { baseUrl, pat }),
  connect: (baseUrl: string, pat: string) => api.put<ConfluenceStatus>('/api/confluence/connection', { baseUrl, pat }),
  disconnect: () => api.del<void>('/api/confluence/connection'),
  spaces: (fresh = false) => api.get<ConfluenceSpace[]>('/api/confluence/spaces', fresh ? { fresh: 1 } : undefined),
  pageBatch: (spaceKey: string, start = 0, limit = 200) =>
    api.get<{ items: ConfluencePage[]; startAt: number; nextStart: number; hasMore: boolean }>(
      `/api/confluence/spaces/${encodeURIComponent(spaceKey)}/pages`,
      { start, limit },
    ),
  treeRoots: (spaceKey: string) =>
    api.get<ConfluencePage[]>(`/api/confluence/spaces/${encodeURIComponent(spaceKey)}/tree`),
  children: (pageId: string) => api.get<ConfluencePage[]>(`/api/confluence/pages/${encodeURIComponent(pageId)}/children`),
  page: (pageId: string) => api.get<ConfluencePageContent>(`/api/confluence/pages/${encodeURIComponent(pageId)}`),
  resolvePage: (spaceKey: string, title: string) =>
    api.get<ConfluencePage>('/api/confluence/resolve', { spaceKey, title }),
  renderUrl: (pageId: string) => `/api/confluence/pages/${encodeURIComponent(pageId)}/render`,
  search: async (options: ConfluenceSearchOptions) => {
    const payload = await api.get<unknown>('/api/confluence/search', options as unknown as Query);
    if (Array.isArray(payload)) return payload as ConfluencePage[];
    if (payload && typeof payload === 'object') {
      const wrapped = payload as { items?: unknown; results?: unknown };
      if (Array.isArray(wrapped.items)) return wrapped.items as ConfluencePage[];
      if (Array.isArray(wrapped.results)) return wrapped.results as ConfluencePage[];
    }
    throw new ApiError(502, 'Confluence search returned an unexpected response.');
  },
  createPage: (body: { spaceKey: string; title: string; storageBody: string; parentId?: string | null }) =>
    api.post<ConfluencePageContent>('/api/confluence/pages', body),
  updatePage: (pageId: string, body: { title: string; storageBody: string; version: number; parentId?: string | null }) =>
    api.put<ConfluencePageContent>(`/api/confluence/pages/${encodeURIComponent(pageId)}`, body),
  deletePage: (pageId: string) => api.del<void>(`/api/confluence/pages/${encodeURIComponent(pageId)}`),
  proxyUrl: (url: string) => withQuery('/api/confluence/proxy', { url }),
};

// ---------------------------------------------------------------------------
// Lumo — SSE over a fetch-streamed POST
// ---------------------------------------------------------------------------

export interface LumoAskRequest {
  messages: LumoTurn[];
  projectKey: string;
  model: string;
}

/**
 * POST /api/lumo/ask and consume the SSE response stream.
 * `onStatus` fires for every `event: status`; resolves with the final
 * `event: result` payload; rejects on `event: error` or transport failure.
 */
export async function lumoAsk(
  req: LumoAskRequest,
  onStatus: (status: string) => void,
  signal?: AbortSignal,
): Promise<LumoResult> {
  const res = await fetch('/api/lumo/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(req),
    signal,
  });

  if (res.status === 401) emitSessionLost();
  if (!res.ok || !res.body) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: LumoResult | null = null;

  const handleEvent = (eventName: string, data: string) => {
    if (eventName === 'status') {
      try {
        const parsed = JSON.parse(data) as { status?: string } | string;
        onStatus(typeof parsed === 'string' ? parsed : (parsed.status ?? data));
      } catch {
        onStatus(data);
      }
    } else if (eventName === 'result') {
      result = JSON.parse(data) as LumoResult;
    } else if (eventName === 'error') {
      let message = data;
      try {
        const parsed = JSON.parse(data) as { message?: string };
        if (parsed?.message) message = parsed.message;
      } catch {
        /* raw text */
      }
      throw new ApiError(500, message);
    }
  };

  const processBuffer = (flush: boolean) => {
    // SSE frames are separated by a blank line.
    for (;;) {
      const sep = buffer.indexOf('\n\n');
      if (sep < 0) {
        if (flush && buffer.trim()) {
          const frame = buffer;
          buffer = '';
          parseFrame(frame);
        }
        return;
      }
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      parseFrame(frame);
    }
  };

  const parseFrame = (frame: string) => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const raw of frame.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) handleEvent(eventName, dataLines.join('\n'));
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    processBuffer(false);
  }
  buffer += decoder.decode();
  processBuffer(true);

  if (!result) throw new ApiError(500, 'Lumo stream ended without a result.');
  return result;
}
