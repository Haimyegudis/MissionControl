// Domain models for JiraWeb — camelCase on the wire.
// TimeSpans are seconds (number | null); dates are ISO-8601 strings.
// Source of truth: docs/reference/jira-rest-layer.md §3, docs/reference/storage-layer.md §3.

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
  /** Populated by callers, not the mapper. */
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
  /** Current value on the issue (display string), for dialog prefill. */
  currentValue: string | null;
}

export interface JiraIssueLink {
  key: string;
  summary: string;
  issueType: string;
  relationship: string;
}

export interface JiraIssueDetails {
  issue: JiraIssue;
  /** fields.description (string, or JSON stringified if ADF). */
  description: string;
  /** renderedFields.description */
  descriptionHtml: string | null;
  comments: JiraComment[];
  worklogs: JiraWorklog[];
  transitions: JiraTransition[];
  allFields: Array<{ key: string; value: string }>;
  /** `${baseUrl w/o trailing /}/browse/${key}` */
  browseUrl: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  /** e.g. "Parent", "IM: Parent Issue" */
  parentFieldLabel: string | null;
  /** Jira issue links, including their direction-specific relationship. */
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

export interface BoardLoadResult {
  boards: JiraBoard[];
  fromGreenhopper: number;
  fromAgile: number;
  greenhopperError: string | null;
  agileError: string | null;
}

export interface PinnedBoard {
  id: string;
  profileId: string;
  boardId: number;
  name: string;
  filterId: number | null;
}

export interface BoardWorkspace {
  id: string;
  profileId: string;
  name: string;
  boardIds: number[];
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface JiraDashboardSummary {
  id: string;
  name: string;
  owner: string | null;
  viewUrl: string | null;
  isFavourite: boolean;
}

export interface JiraDashboardGadget {
  /** Raw JSON text of the gadget id (numeric ids unquoted, string ids quoted). */
  id: string;
  title: string;
  moduleKey: string;
  /** Hardcoded false in the WPF source. */
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
  /** startAt + items.length < total */
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
// App settings (storage-layer.md §3) — camelCase on the wire.
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
  /** Key into the secrets store, never the token itself. */
  aiCredentialKey: string | null;
  useGhCopilotCli: boolean;
  useCopilotCliExe: boolean;
  mcpServerCommand: string | null;
  mcpServerArgs: string[];
  mcpServerEnv: Record<string, string>;
  /** "stdio" or "sse" (URL then in mcpServerCommand). */
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
  aiModel: 'claude-sonnet-5',
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
