// Public surface of @mc/core. Enumerated rather than `export *` so the API the
// server and the Android shell depend on stays deliberate.

export * from './types.js';

// --- storage ports -----------------------------------------------------------
export {
  KV_TABLES,
  MemoryKvStore,
  MemoryPeopleStore,
  type KvRecord,
  type KvStore,
  type KvTable,
  type PeopleStore,
  type TestRailPerson,
} from './storage/kv.js';
export {
  AppSettingsRepo,
  IssueCacheRepo,
  MetadataCacheRepo,
  toCamelKeys,
  toPascalKeys,
  type MetadataCacheEntry,
} from './storage/repos.js';
export {
  KvBoardWorkspaceRepo,
  KvCreateDefaultsRepo,
  KvPinnedBoardRepo,
  KvSavedFilterRepo,
  KvTeamRepo,
} from './storage/lists.js';

// --- composition -------------------------------------------------------------
export {
  createCore,
  type ConnectionProbe,
  type Core,
  type CorePorts,
  type CredentialsPort,
} from './composition.js';
export {
  CACHE_FRESH_MS,
  DELTA_SLACK_MS,
  createDispatcher,
  formatJqlMinute,
  injectUpdatedClause,
  type Dispatch,
  type DispatchResponse,
  type DispatcherOptions,
} from './dispatch.js';

// --- Jira --------------------------------------------------------------------
export { JiraSession, type SessionChangedListener } from './jira/session.js';
export {
  JiraError,
  agilePrefix,
  apiPrefix,
  extractErrorMessage,
  jiraFetch,
  normalizeBaseUrl,
  type JiraFetchOptions,
} from './jira/httpClient.js';
export { JiraIssueService } from './jira/issueService.js';
export { JiraWorklogService, type AdjustEstimate } from './jira/worklogService.js';
export { JiraBoardService } from './jira/boardService.js';
export { JiraMetadataService } from './jira/metadataService.js';
export { JiraDashboardService } from './jira/dashboardService.js';
export { JiraCreateIssueService } from './jira/createIssueService.js';
export {
  BOARDS_CACHE_KEY,
  CachedBoardService,
  CachedMetadataService,
  type BoardServiceLike,
  type MetadataServiceLike,
} from './jira/cached.js';
export { TimeLoggedService, type TimeLoggedPeriod } from './jira/timeLogged.js';
export { INCIDENT_FILTERS } from './jira/incidentCatalog.js';
export { buildIncidentJql } from './jira/jqlBuilder.js';
export { jqlQuote } from './jira/jqlEscape.js';
export { DashboardAggregator } from './jira/aggregator.js';
export { metadataWarmup } from './jira/warmup.js';

// --- Confluence --------------------------------------------------------------
export { ConfluenceApiError, ConfluenceClient } from './confluence/client.js';
export {
  ConfluenceService,
  isIndigoSpace,
  setIndigoSpaceOverride,
  type CredentialReader,
} from './confluence/service.js';
export * from './confluence/types.js';

// --- TestRail ----------------------------------------------------------------
export {
  TestRailNotConnectedError,
  TestRailService,
  parsePeople,
  type TrMeta,
  type TrPrefetchProgress,
  type TrSessionStatus,
} from './testrail/service.js';
export { TestRailClient, type TestRailClientLike } from './testrail/client.js';
export { TestRailApiError, TestRailHttp } from './testrail/httpClient.js';
export * from './testrail/types.js';
