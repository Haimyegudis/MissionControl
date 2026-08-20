// Composition root shared by the desktop server and the Android shell. Both
// build the identical service graph; only the injected ports differ.

import { DashboardAggregator } from './jira/aggregator.js';
import { CachedBoardService, CachedMetadataService } from './jira/cached.js';
import { JiraCreateIssueService } from './jira/createIssueService.js';
import { JiraDashboardService } from './jira/dashboardService.js';
import { JiraBoardService } from './jira/boardService.js';
import { JiraIssueService } from './jira/issueService.js';
import { JiraMetadataService } from './jira/metadataService.js';
import { JiraSession } from './jira/session.js';
import { JiraWorklogService } from './jira/worklogService.js';
import { TimeLoggedService } from './jira/timeLogged.js';
import { AppSettingsRepo, IssueCacheRepo, MetadataCacheRepo } from './storage/repos.js';
import {
  KvBoardWorkspaceRepo,
  KvPinnedBoardRepo,
  KvSavedFilterRepo,
  KvTeamRepo,
} from './storage/lists.js';
import type { KvStore, PeopleStore } from './storage/kv.js';
import { TestRailService } from './testrail/service.js';
import type { Credentials, JiraUser } from './types.js';

export interface CredentialsPort {
  load(): Credentials | null;
  save(credentials: Credentials): void;
  clear(): void;
}

export interface CorePorts {
  kv: KvStore;
  people: PeopleStore;
  credentials: CredentialsPort;
  /**
   * Single clock for everything time-dependent in the graph (cache stamps and
   * freshness windows). Injectable so a test can move time without the cache
   * and its reader disagreeing about what "now" is.
   */
  now?: () => number;
}

/** Probes a candidate profile; injectable so tests need no network. */
export type ConnectionProbe = (session: JiraSession) => Promise<JiraUser>;

const defaultProbe: ConnectionProbe = (session) => new JiraIssueService(session).getCurrentUser();

export interface Core {
  session: JiraSession;
  issues: JiraIssueService;
  worklogs: JiraWorklogService;
  boards: CachedBoardService;
  metadata: CachedMetadataService;
  timeLogged: TimeLoggedService;
  testrail: TestRailService;
  dashboards: JiraDashboardService;
  createIssues: JiraCreateIssueService;
  aggregator: DashboardAggregator;
  savedFilters: KvSavedFilterRepo;
  teams: KvTeamRepo;
  pinnedBoards: KvPinnedBoardRepo;
  boardWorkspaces: KvBoardWorkspaceRepo;
  settings: AppSettingsRepo;
  issueCache: IssueCacheRepo;
  metadataCache: MetadataCacheRepo;
  credentials: CredentialsPort;
  /** The graph's clock, so callers such as the dispatcher share it. */
  now(): number;
  getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]>;
  /** Verify a profile without touching the live session. */
  testConnection(credentials: Credentials, probe?: ConnectionProbe): Promise<JiraUser>;
}

export function createCore(ports: CorePorts): Core {
  const now = ports.now ?? (() => Date.now());
  const session = new JiraSession();
  const metadataCache = new MetadataCacheRepo(ports.kv, now);
  const issues = new JiraIssueService(session);
  const worklogs = new JiraWorklogService(session);
  const boards = new CachedBoardService(new JiraBoardService(session), metadataCache);
  const metadata = new CachedMetadataService(new JiraMetadataService(session), metadataCache);
  const timeLogged = new TimeLoggedService(session, issues, worklogs);
  const testrail = new TestRailService(ports.kv, ports.people);
  const dashboards = new JiraDashboardService(session);
  const createIssues = new JiraCreateIssueService(session);
  const aggregator = new DashboardAggregator(session, issues, timeLogged);

  return {
    session,
    issues,
    worklogs,
    boards,
    metadata,
    timeLogged,
    testrail,
    dashboards,
    createIssues,
    aggregator,
    savedFilters: new KvSavedFilterRepo(ports.kv),
    teams: new KvTeamRepo(ports.kv),
    pinnedBoards: new KvPinnedBoardRepo(ports.kv),
    boardWorkspaces: new KvBoardWorkspaceRepo(ports.kv),
    settings: new AppSettingsRepo(ports.kv),
    issueCache: new IssueCacheRepo(ports.kv, now),
    metadataCache,
    credentials: ports.credentials,
    now,
    getDistinct: (projectKey, fieldName, maxIssues) =>
      metadata.getDistinct(projectKey, fieldName, () =>
        issues.getDistinctIssueField(projectKey, fieldName, maxIssues, metadata),
      ),
    testConnection: (credentials, probe = defaultProbe) => {
      const throwaway = new JiraSession();
      throwaway.activate(credentials, null);
      return probe(throwaway);
    },
  };
}
