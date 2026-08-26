// Shared route dependencies + helpers (Task A7).
// Every route factory receives an AppDeps whose members are narrow structural
// interfaces so tests can pass plain mock objects.

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Credentials } from '../config/credentialsStore.js';
import type {
  AdjustEstimate,
  BoardServiceLike,
  JiraSession,
  MetadataCacheEntry,
  MetadataServiceLike,
  TimeLoggedPeriod,
} from '@mc/core';
import type { LumoResult, LumoTurn } from '../ai/lumoAgent.js';
import type { CreateDefaultsEntry, CreateMetaEntry } from '../storage/fileStores.js';

import type { TestRailClientLike } from '@mc/core';
import type { TrMeta, TrPrefetchProgress, TrSessionStatus } from '@mc/core';
import type { TrConnection, TrUser } from '@mc/core';
import type { ConfluenceService } from '@mc/core';
import type {
  AppSettings,
  DashboardSnapshot,
  JiraCreateIssueMeta,
  JiraDashboardDetails,
  JiraDashboardSummary,
  JiraIssue,
  JiraIssueDetails,
  JiraTimelineEvent,
  JiraTransition,
  JiraTransitionField,
  JiraUser,
  JiraWorklog,
  PagedResult,
  PinnedBoard,
  SavedFilter,
  Team,
  TimeLoggedReport,
  WatchConfig,
  WatchEvent,
} from '@mc/core';

// ---------------------------------------------------------------------------
// Narrow service interfaces (structurally satisfied by the real services)
// ---------------------------------------------------------------------------

export interface CredentialsDep {
  load(): Credentials | null;
  save(credentials: Credentials): void;
  clear(): void;
}

export interface IssuesDep {
  searchIssues(jql: string, startAt?: number, maxResults?: number): Promise<PagedResult<JiraIssue>>;
  getIssueDetails(issueKey: string): Promise<JiraIssueDetails>;
  getIssueTimeline(issueKey: string): Promise<JiraTimelineEvent[]>;
  getTransitions(issueKey: string): Promise<JiraTransition[]>;
  getTransitionScreen(issueKey: string, transitionId: string): Promise<JiraTransitionField[]>;
  performTransition(issueKey: string, transitionId: string): Promise<void>;
  performTransitionWithData(
    issueKey: string,
    transitionId: string,
    fields: Record<string, unknown>,
    comment?: string | null,
    assignee?: string | null,
    timeSpent?: string | null,
    worklogStarted?: string | null,
  ): Promise<void>;
  addComment(issueKey: string, body: string): Promise<void>;
  addLabel(issueKey: string, label: string): Promise<void>;
  setAssignee(issueKey: string, assignee: string): Promise<void>;
  resetFieldCache(): void;
}

export interface WorklogsDep {
  getWorklogs(issueKey: string): Promise<JiraWorklog[]>;
  addWorklog(
    issueKey: string,
    totalSeconds: number,
    startedIso: string,
    comment?: string | null,
    adjust?: AdjustEstimate,
    adjustValue?: string | null,
  ): Promise<JiraWorklog>;
}

export interface DashboardsDep {
  getDashboards(): Promise<JiraDashboardSummary[]>;
  getDashboardDetails(id: string): Promise<JiraDashboardDetails>;
}

export interface CreateIssuesDep {
  getCreateMeta(projectKey: string, issueType: string): Promise<JiraCreateIssueMeta>;
  createIssue(projectKey: string, issueType: string, fields: Record<string, unknown>): Promise<string>;
}

export interface TimeLoggedDep {
  buildReport(
    period: TimeLoggedPeriod,
    customFrom?: Date | null,
    customTo?: Date | null,
    extraJql?: string | null,
  ): Promise<TimeLoggedReport>;
  buildReportForSprint(sprintName: string): Promise<TimeLoggedReport>;
  buildReportForRange(fromLocal: Date, toLocalExclusive: Date): Promise<TimeLoggedReport>;
}

export interface WatchDep {
  runCycle(): Promise<WatchEvent[]>;
  feed(): { events: WatchEvent[]; unreadCount: number; lastCycle: string | null };
  ack(): void;
  getConfig(): WatchConfig;
  setConfig(raw: unknown): WatchConfig;
}

export interface AggregatorDep {
  buildDashboardSnapshot(): Promise<DashboardSnapshot>;
}

export interface AppSettingsRepoDep {
  get(): AppSettings;
  save(settings: AppSettings): void;
}

export interface IssueCacheRepoDep {
  getCached(cacheKey: string): JiraIssue[];
  /** `full` marks a result that came from re-running the whole query. */
  saveCache(cacheKey: string, issues: JiraIssue[], full?: boolean): void;
  getLastRefresh(cacheKey: string): Date | null;
  getLastFullRefresh(cacheKey: string): Date | null;
  clearAll(): void;
}

export interface MetadataCacheRepoDep {
  get(cacheKey: string): MetadataCacheEntry | null;
  set(cacheKey: string, json: string): void;
  delete(cacheKey: string): void;
  clearAll(): void;
}

export interface SavedFilterRepoDep {
  getAll(): SavedFilter[];
  upsert(filter: SavedFilter): SavedFilter;
  delete(id: string): void;
}

export interface TeamRepoDep {
  getAll(): Team[];
  upsert(team: Team): Team;
  delete(id: string): void;
}

export interface PinnedBoardRepoDep {
  getForProfile(profileId: string): PinnedBoard[];
  upsert(board: PinnedBoard): PinnedBoard;
  delete(id: string): void;
}

export interface CreateDefaultsDep {
  load(key: string): CreateDefaultsEntry | null;
  save(key: string, defaults: CreateDefaultsEntry): void;
  clear(key: string): void;
}

export interface CreateMetaCacheDep {
  load(key: string): CreateMetaEntry | null;
  save(key: string, meta: JiraCreateIssueMeta | null): void;
  clearAll(): void;
}

export interface TestRailDep {
  status(): TrSessionStatus;
  connect(connection: TrConnection): Promise<TrUser>;
  disconnect(): void;
  /** Throws TestRailNotConnectedError (→ 401) when no session is active. */
  requireClient(): TestRailClientLike;
  cachedJson(key: string, fetchFn: () => Promise<unknown>, fresh: boolean): Promise<unknown>;
  clearCache(): void;
  fetchMeta(projectId?: number | null): Promise<TrMeta>;
  prefetch(projectIds: number[]): { started: boolean; active?: boolean };
  prefetchStatus(): TrPrefetchProgress;
  getPeople(): Record<string, string>;
  setPeople(people: Record<string, unknown>): void;
}

export interface AskLumoRequest {
  turns: LumoTurn[];
  projectKey: string;
  model: string;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

export interface AppDeps {
  session: JiraSession;
  credentials: CredentialsDep;
  /** Per-install API token (security.ts); absent/empty disables auth (tests). */
  apiToken?: string;
  /** Loopback port used to narrow the Host/Origin allow-list. */
  apiPort?: number;
  /** Build a throwaway session for the given credentials and GET /myself. */
  testConnection(credentials: Credentials): Promise<JiraUser>;
  /** Fire-and-forget metadata warmup after a successful login. */
  warmup?: () => void;
  issues: IssuesDep;
  worklogs: WorklogsDep;
  boards: BoardServiceLike;
  /** Cached metadata service. */
  metadata: MetadataServiceLike;
  /** Cached distinct-field loader (CachedMetadataService.getDistinct over issueService). */
  getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]>;
  dashboards: DashboardsDep;
  createIssues: CreateIssuesDep;
  timeLogged: TimeLoggedDep;
  aggregator: AggregatorDep;
  watch: WatchDep;
  repos: {
    appSettings: AppSettingsRepoDep;
    issueCache: IssueCacheRepoDep;
    metadataCache: MetadataCacheRepoDep;
    savedFilters: SavedFilterRepoDep;
    teams: TeamRepoDep;
    pinnedBoards: PinnedBoardRepoDep;
  };
  createDefaults: CreateDefaultsDep;
  createMetaCache: CreateMetaCacheDep;
  testrail: TestRailDep;
  /** Optional for isolated route tests; the real app always provides it. */
  confluence?: ConfluenceService;
  askLumo(request: AskLumoRequest): Promise<LumoResult>;
  /** Injectable fetch for the attachment proxy (defaults to global fetch). */
  fetchFn?: typeof fetch;
  /** client/dist; static serving is skipped when absent. */
  staticDir?: string;
  /** /createmeta timeout override for tests (default 15 000 ms). */
  createMetaTimeoutMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Error carrying an explicit HTTP status; the error middleware honors it. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Wrap an async handler so rejections reach the error middleware. */
export function h(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** First string value of a query parameter, or undefined. */
export function qstr(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0];
  return undefined;
}

/** Required string body/query field or 400. */
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `Missing required parameter: ${name}`);
  }
  return value;
}

/** Session default project key falling back to AppSettings then "ISW". */
export function defaultProjectKey(deps: AppDeps): string {
  const fromSession = deps.session.profile?.defaultProjectKey?.trim();
  if (fromSession) return fromSession;
  try {
    const fromSettings = deps.repos.appSettings.get().defaultProjectKey?.trim();
    if (fromSettings) return fromSettings;
  } catch {
    // settings repo failures must not break project resolution
  }
  return 'ISW';
}
