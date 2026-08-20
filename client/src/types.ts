// Domain models for JiraWeb client — mirrors server/src/types.ts (camelCase on
// the wire; TimeSpans are seconds; dates are ISO-8601 strings).

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface SprintInfo {
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
}

export interface JiraIssue {
  /** Load order; restores position when unstarred. */
  originalOrder: number;
  isStarred: boolean;
  key: string;
  summary: string;
  issueType: string;
  status: string;
  /** status.statusCategory.key */
  statusCategory: string;
  priority: string;
  /** displayName */
  assignee: string | null;
  reporter: string | null;
  projectKey: string;
  /** Resolved active sprint name. */
  sprint: string | null;
  created: string;
  updated: string;
  /** timespent, seconds */
  timeSpent: number | null;
  /** timeestimate, seconds */
  remainingEstimate: number | null;
  /** timeoriginalestimate, seconds */
  originalEstimate: number | null;
  epicKey: string | null;
  epicName: string | null;
  allSprints: SprintInfo[];
  /** Filled by the time-logged service, seconds. */
  workLoggedForPeriod: number | null;
  labels: string[];
  components: string[];
  fixVersions: string[];
  boardNames: string[];
  boardIds: number[];
  isBlocked: boolean;
  isCritical: boolean;
  recentlyChanged: boolean;
  rejectReasons: string | null;
  /** Transient; recent-updates feed. */
  changeSummary: string | null;
  severity: string | null;
}

export interface JiraTimelineEvent {
  when: string;
  author: string;
  kind: 'change' | 'comment' | 'worklog';
  summary: string;
}

export interface JiraComment {
  author: string;
  created: string;
  body: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  toStatus: string | null;
}

export interface JiraTransitionField {
  id: string;
  name: string;
  required: boolean;
  schemaType: string;
  itemType: string | null;
  allowedValues: string[];
  /** Current value on the issue (display string), used to prefill the dialog. */
  currentValue?: string | null;
}

export interface JiraIssueLink {
  key: string;
  summary: string;
  issueType: string;
  relationship: string;
}

export interface JiraIssueDetails {
  issue: JiraIssue;
  description: string;
  descriptionHtml: string | null;
  comments: JiraComment[];
  worklogs: JiraWorklog[];
  transitions: JiraTransition[];
  allFields: Array<{ key: string; value: string }>;
  browseUrl: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  parentFieldLabel: string | null;
  linkedIssues?: JiraIssueLink[];
  timeline: JiraTimelineEvent[];
}

// ---------------------------------------------------------------------------
// Users / worklogs
// ---------------------------------------------------------------------------

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  avatarUrl: string | null;
  active: boolean;
}

export interface JiraWorklog {
  id: string;
  issueKey: string;
  author: string;
  authorAccountId: string | null;
  started: string;
  /** Seconds. */
  timeSpent: number;
  comment: string | null;
}

// ---------------------------------------------------------------------------
// Boards / sprints
// ---------------------------------------------------------------------------

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  projectKey: string | null;
  projectName: string | null;
  filterId: number | null;
  filterName: string | null;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  originBoardId: number | null;
}

export interface JiraQuickFilter {
  id: number;
  name: string;
  query: string;
}

export interface PinnedBoard {
  id: string;
  profileId: string;
  boardId: number;
  name: string;
  filterId: number | null;
}

// ---------------------------------------------------------------------------
// Dashboards (Jira dashboards)
// ---------------------------------------------------------------------------

export interface JiraDashboardSummary {
  id: string;
  name: string;
  owner: string | null;
  viewUrl: string | null;
  isFavourite: boolean;
}

export interface JiraDashboardGadget {
  id: string;
  title: string;
  moduleKey: string;
  supported: boolean;
}

export interface JiraDashboardDetails {
  summary: JiraDashboardSummary;
  gadgets: JiraDashboardGadget[];
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type JiraFilterControlType =
  | 'quickButton'
  | 'dropdown'
  | 'multiSelectDropdown'
  | 'textSearch'
  | 'datePicker'
  | 'userPicker'
  | 'jqlOnly';

export interface JiraFilterDefinition {
  id: string;
  displayName: string;
  controlType: JiraFilterControlType;
  jiraFieldName: string | null;
  jiraFieldId: string | null;
  jqlTemplate: string | null;
  isQuickFilter: boolean;
  supportsMultiSelect: boolean;
  displayOrder: number;
  groupName: string | null;
}

export interface JiraFilterSelection {
  filterId: string;
  values: string[];
}

export interface SavedFilter {
  id: string;
  name: string;
  description: string | null;
  jql: string;
  isFavorite: boolean;
  created: string;
  lastUsed: string | null;
}

// ---------------------------------------------------------------------------
// Create issue
// ---------------------------------------------------------------------------

export interface JiraCreateFieldMeta {
  fieldId: string;
  displayName: string;
  required: boolean;
  schemaType: string;
  allowedValues: string[];
}

export interface JiraCreateIssueMeta {
  projectKey: string;
  issueType: string;
  fields: JiraCreateFieldMeta[];
}

// ---------------------------------------------------------------------------
// Paging / teams
// ---------------------------------------------------------------------------

export interface PagedResult<T> {
  items: T[];
  startAt: number;
  maxResults: number;
  total: number;
  hasMore: boolean;
}

export interface Team {
  /** Guid "N" form (32 hex chars, no hyphens). */
  id: string;
  name: string;
  /** Assignee display names. */
  members: string[];
}

// ---------------------------------------------------------------------------
// Reports / snapshots
// ---------------------------------------------------------------------------

export interface DailyLogEntry {
  day: string;
  issueKey: string;
  issueSummary: string;
  /** Seconds. */
  timeSpent: number;
}

export interface TimeLoggedReport {
  issues: JiraIssue[];
  /** Seconds. */
  total: number;
  fromUtc: string;
  toUtc: string;
  dailyByIssue: DailyLogEntry[];
  availableSprints: string[];
}

export interface DashboardSnapshot {
  openIssues: number;
  criticalIncidents: number;
  blocked: number;
  updatedToday: number;
  /** Seconds. */
  timeLoggedToday: number;
  /** Seconds. */
  timeLoggedThisWeek: number;
  recentlyUpdated: JiraIssue[];
  loadedAtUtc: string;
}

// ---------------------------------------------------------------------------
// App settings (storage-layer.md §3)
// ---------------------------------------------------------------------------

export interface RecentIssue {
  key: string;
  summary: string;
}

export interface SavedQuery {
  name: string;
  jql: string;
}

export interface AppSettings {
  autoRefreshEnabled: boolean;
  refreshIntervalSeconds: number;
  pauseWhenMinimized: boolean;
  theme: string;
  inAppNotifications: boolean;
  windowsToastNotifications: boolean;
  criticalOnly: boolean;
  muteAll: boolean;
  incidentDashboardUrl: string | null;
  incidentDashboardId: string | null;
  defaultProjectKey: string;
  defaultProfileId: string | null;
  /** Nested JSON string: map of filter id -> values. */
  incidentFiltersJson: string | null;
  incidentSummarySearch: string | null;
  windowLeft: number | null;
  windowTop: number | null;
  windowWidth: number | null;
  windowHeight: number | null;
  windowState: string | null;
  sidebarWidth: number | null;
  /** Mirror of recentIssues[].key. */
  recentIssueKeys: string[];
  /** Max 10, newest first; shell shows first 3. */
  recentIssues: RecentIssue[];
  starredIssueKeys: string[];
  accentColor: string | null;
  /** Key = kanban column title, value = max issues; empty = no cap. */
  kanbanWipLimits: Record<string, number>;
  dashboardWidgets: string[];
  aiEndpoint: string | null;
  aiModel: string | null;
  /** Consent to send prompts and retrieved work data to an external AI provider. */
  aiDataSharingEnabled: boolean;
  aiCredentialKey: string | null;
  useGhCopilotCli: boolean;
  useCopilotCliExe: boolean;
  mcpServerCommand: string | null;
  mcpServerArgs: string[];
  mcpServerEnv: Record<string, string>;
  mcpTransport: string;
  savedQueries: SavedQuery[];
  /** Empty/null => "All assignable users". */
  activeTeamId: string | null;
  lastConfluenceSpaceKey: string | null;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoRefreshEnabled: true,
  refreshIntervalSeconds: 120,
  pauseWhenMinimized: true,
  theme: 'Dark',
  inAppNotifications: true,
  windowsToastNotifications: false,
  criticalOnly: false,
  muteAll: false,
  incidentDashboardUrl: 'https://hp-jira.external.hp.com/secure/Dashboard.jspa?selectPageId=82606',
  incidentDashboardId: '82606',
  defaultProjectKey: 'ISW',
  defaultProfileId: null,
  incidentFiltersJson: null,
  incidentSummarySearch: null,
  windowLeft: null,
  windowTop: null,
  windowWidth: null,
  windowHeight: null,
  windowState: null,
  sidebarWidth: null,
  recentIssueKeys: [],
  recentIssues: [],
  starredIssueKeys: [],
  accentColor: null,
  kanbanWipLimits: {},
  dashboardWidgets: ['OpenIssues', 'Critical', 'OnHold', 'UpdatedToday', 'LoggedToday', 'LoggedThisWeek'],
  aiEndpoint: 'https://api.githubcopilot.com/chat/completions',
  aiModel: 'gpt-4o-mini',
  aiDataSharingEnabled: false,
  aiCredentialKey: null,
  useGhCopilotCli: true,
  useCopilotCliExe: false,
  mcpServerCommand: null,
  mcpServerArgs: [],
  mcpServerEnv: {},
  mcpTransport: 'stdio',
  savedQueries: [],
  activeTeamId: null,
  lastConfluenceSpaceKey: null,
};

/** Fresh deep copy of the defaults (safe to mutate). */
export function defaultAppSettings(): AppSettings {
  return structuredClone(DEFAULT_APP_SETTINGS);
}

// ---------------------------------------------------------------------------
// Auth (Task A7 route contract)
// ---------------------------------------------------------------------------

export type InstanceType = 'cloud' | 'datacenter';

export interface AuthProfile {
  email: string;
  jiraBaseUrl: string;
  instanceType: InstanceType;
  defaultProjectKey: string;
}

export interface AuthStatus {
  connected: boolean;
  user: JiraUser | null;
  profile: AuthProfile | null;
}

export interface LoginRequest {
  baseUrl: string;
  email: string;
  pat: string;
  instanceType: InstanceType;
}

// ---------------------------------------------------------------------------
// Confluence (Indigo spaces only)
// ---------------------------------------------------------------------------

export interface ConfluenceUser {
  userKey: string | null;
  username: string | null;
  displayName: string;
  email: string | null;
}

export interface ConfluenceStatus {
  configured: boolean;
  connected: boolean;
  baseUrl: string | null;
  user: ConfluenceUser | null;
}

export interface ConfluenceSpace {
  id: number | null;
  key: string;
  name: string;
  type: string;
  status: string;
  description: string;
  labels: string[];
}

export interface ConfluencePage {
  id: string;
  spaceKey: string;
  title: string;
  parentId: string | null;
  status: string;
  url: string | null;
  createdBy: string | null;
  createdAt: string | null;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
  excerpt: string | null;
}

export interface ConfluencePageContent extends ConfluencePage {
  storageBody: string;
  viewBody: string;
  version: number;
}

export interface ConfluenceSearchOptions {
  query?: string;
  title?: string;
  body?: string;
  creator?: string;
  contributor?: string;
  label?: string;
  spaceKey?: string;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  sort?: 'modified' | 'created' | 'title';
  limit?: number;
}

// ---------------------------------------------------------------------------
// Lumo
// ---------------------------------------------------------------------------

export interface LumoCard {
  source: string;
  title: string;
  summary: string;
  url: string | null;
  fields: Record<string, string>;
}

export interface LumoResult {
  summary: string;
  cards: LumoCard[];
}

export interface LumoTurn {
  role: 'user' | 'assistant';
  content: string;
}
