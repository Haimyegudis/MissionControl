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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    emitSessionLost();
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string; status?: number };
      if (data && typeof data.message === 'string' && data.message) message = data.message;
    } catch {
      /* non-JSON error body */
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
    },
  ) => api.post<void>(`/api/issues/${encodeURIComponent(key)}/transitions`, body),
  addComment: (key: string, body: string) =>
    api.post<void>(`/api/issues/${encodeURIComponent(key)}/comments`, { body }),
  addLabel: (key: string, label: string) =>
    api.post<void>(`/api/issues/${encodeURIComponent(key)}/labels`, { label }),
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
};

export const dashboard = {
  snapshot: () => api.get<DashboardSnapshot>('/api/dashboard/snapshot'),
};

export const dashboards = {
  list: () => api.get<JiraDashboardSummary[]>('/api/dashboards'),
  details: (id: string) => api.get<JiraDashboardDetails>(`/api/dashboards/${encodeURIComponent(id)}`),
};

export const timelogged = {
  report: (period: string, opts?: { from?: string; to?: string; user?: string }) =>
    api.get<TimeLoggedReport>('/api/timelogged', { period, ...opts }),
  sprint: (name: string) => api.get<TimeLoggedReport>('/api/timelogged/sprint', { name }),
  range: (from: string, to: string) => api.get<TimeLoggedReport>('/api/timelogged/range', { from, to }),
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
  /** Server semantics: load-then-mutate — send only the fields to change. */
  put: (partial: Partial<AppSettings>) => api.put<AppSettings>('/api/settings', partial),
  clearIssueCache: () => api.post<void>('/api/settings/clear-issue-cache'),
  hardRefresh: () => api.post<void>('/api/settings/hard-refresh'),
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

export type MetadataKind = 'projects' | 'issuetypes' | 'statuses' | 'priorities' | 'resolutions';

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
