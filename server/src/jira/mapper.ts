import type {
  JiraComment,
  JiraIssue,
  JiraTimelineEvent,
  JiraUser,
  JiraWorklog,
  SprintInfo,
} from '../types.js';

/**
 * Jira JSON → domain mapper (jira-rest-layer.md §4).
 * Port of JiraJsonMapper.cs — camelCase output per types.ts.
 */

// ---------------------------------------------------------------------------
// Mutable module-level field ids (set once by field discovery)
// ---------------------------------------------------------------------------

let severityFieldId: string | null = null;
let rejectReasonsFieldId: string | null = null;
let priorityFieldId: string | null = null;
let sprintFieldId: string | null = null;

export function setSeverityFieldId(id: string | null): void {
  severityFieldId = id;
}
export function setRejectReasonsFieldId(id: string | null): void {
  rejectReasonsFieldId = id;
}
export function setPriorityFieldId(id: string | null): void {
  priorityFieldId = id;
}
export function setSprintFieldId(id: string | null): void {
  sprintFieldId = id;
}
export function getSeverityFieldId(): string | null {
  return severityFieldId;
}
export function getRejectReasonsFieldId(): string | null {
  return rejectReasonsFieldId;
}
export function getPriorityFieldId(): string | null {
  return priorityFieldId;
}
export function getSprintFieldId(): string | null {
  return sprintFieldId;
}
export function resetFieldIds(): void {
  severityFieldId = null;
  rejectReasonsFieldId = null;
  priorityFieldId = null;
  sprintFieldId = null;
}

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

/** Jira emits offsets without colon (+0000). Normalize ±HHmm → ±HH:mm. */
export function normalizeJiraDate(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

// ---------------------------------------------------------------------------
// Generic value readers
// ---------------------------------------------------------------------------

/** First string-ish of displayName / name / value / key on an object. */
function readObjectDisplay(obj: Record<string, unknown>): string | null {
  for (const prop of ['displayName', 'name', 'value', 'key']) {
    const v = obj[prop];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return null;
}

/** String → itself; number/bool → raw; object → display prop; array → joined. */
function readDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((el) => readDisplayValue(el))
      .filter((v): v is string => v !== null && v.trim().length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (typeof value === 'object') return readObjectDisplay(value as Record<string, unknown>);
  return null;
}

function readSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNames(list: unknown, prop = 'name'): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const el of list) {
    if (typeof el === 'string') {
      if (el.length > 0) out.push(el);
    } else if (el !== null && typeof el === 'object') {
      const v = (el as Record<string, unknown>)[prop];
      if (typeof v === 'string' && v.length > 0) out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sprint extraction
// ---------------------------------------------------------------------------

const SPRINTISH_PROPS = ['boardId', 'state', 'startDate', 'goal'];

function sprintFromObject(el: Record<string, unknown>): SprintInfo | null {
  const name = typeof el.name === 'string' ? el.name : null;
  if (!name) return null;
  return {
    name,
    state: typeof el.state === 'string' ? el.state : '',
    startDate: normalizeJiraDate(typeof el.startDate === 'string' ? el.startDate : null),
    endDate: normalizeJiraDate(typeof el.endDate === 'string' ? el.endDate : null),
  };
}

/** Value for `key=` inside a Greenhopper sprint string, up to next `,` or `]`. */
function ghValue(s: string, key: string): string | null {
  const m = s.match(new RegExp(`${key}=([^,\\]]*)`));
  const v = m?.[1];
  if (!v || v === '<null>') return null;
  return v;
}

function sprintFromGreenhopperString(s: string): SprintInfo | null {
  if (!s.includes('Sprint')) return null;
  const name = ghValue(s, 'name');
  if (!name) return null;
  return {
    name,
    state: ghValue(s, 'state') ?? '',
    startDate: normalizeJiraDate(ghValue(s, 'startDate')),
    endDate: normalizeJiraDate(ghValue(s, 'endDate')),
  };
}

function isActiveState(state: string): boolean {
  return state.toUpperCase().startsWith('ACTIVE');
}

function collectSprints(fields: Record<string, unknown>): SprintInfo[] {
  const found: SprintInfo[] = [];

  // Top-level fields.sprint — object or array of objects with `name`.
  const top = fields.sprint;
  const topList = Array.isArray(top) ? top : top !== null && top !== undefined ? [top] : [];
  for (const el of topList) {
    if (el !== null && typeof el === 'object' && !Array.isArray(el)) {
      const sprint = sprintFromObject(el as Record<string, unknown>);
      if (sprint) found.push(sprint);
    }
  }

  // Every customfield_* array property.
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith('customfield_') || !Array.isArray(value)) continue;
    for (const el of value) {
      if (typeof el === 'string') {
        const sprint = sprintFromGreenhopperString(el);
        if (sprint) found.push(sprint);
      } else if (el !== null && typeof el === 'object' && !Array.isArray(el)) {
        const obj = el as Record<string, unknown>;
        // Guard against Components/FixVersions-shaped objects.
        if (!SPRINTISH_PROPS.some((p) => p in obj)) continue;
        const sprint = sprintFromObject(obj);
        if (sprint) found.push(sprint);
      }
    }
  }
  return found;
}

/**
 * Resolve the "current" sprint: prefer an active one, fall back to the first
 * non-active found. Null when the issue has no sprint data.
 */
export function tryFindSprint(fields: Record<string, unknown> | null | undefined): SprintInfo | null {
  if (!fields) return null;
  const sprints = collectSprints(fields);
  const active = sprints.find((s) => isActiveState(s.state));
  return active ?? sprints[0] ?? null;
}

/** All sprints on the issue, deduped by name (ci). */
export function extractAllSprints(fields: Record<string, unknown> | null | undefined): SprintInfo[] {
  if (!fields) return [];
  const out: SprintInfo[] = [];
  const seen = new Set<string>();
  for (const sprint of collectSprints(fields)) {
    const key = sprint.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sprint);
  }
  return out;
}

// ---------------------------------------------------------------------------
// mapIssue
// ---------------------------------------------------------------------------

const EPIC_CUSTOM_FIELDS = [
  'customfield_10014',
  'customfield_10008',
  'customfield_10100',
  'customfield_10000',
  'customfield_10001',
  'customfield_10006',
];
const EPIC_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

function resolveEpic(fields: Record<string, unknown>): { epicKey: string | null; epicName: string | null } {
  // (1) fields.epic.key
  const epic = fields.epic;
  if (epic !== null && typeof epic === 'object' && !Array.isArray(epic)) {
    const obj = epic as Record<string, unknown>;
    if (typeof obj.key === 'string' && obj.key.length > 0) {
      const name =
        typeof obj.name === 'string' && obj.name.length > 0
          ? obj.name
          : typeof obj.summary === 'string' && obj.summary.length > 0
            ? obj.summary
            : null;
      return { epicKey: obj.key, epicName: name };
    }
  }

  // (2) fields.parent — only when parent issuetype is missing or "Epic".
  const parent = fields.parent;
  if (parent !== null && typeof parent === 'object' && !Array.isArray(parent)) {
    const obj = parent as Record<string, unknown>;
    if (typeof obj.key === 'string' && obj.key.length > 0) {
      const parentFields = (obj.fields ?? {}) as Record<string, unknown>;
      const issuetype = parentFields.issuetype as Record<string, unknown> | undefined;
      const typeName = typeof issuetype?.name === 'string' ? issuetype.name : null;
      if (typeName === null || typeName.toLowerCase() === 'epic') {
        const summary = typeof parentFields.summary === 'string' ? parentFields.summary : null;
        return { epicKey: obj.key, epicName: summary };
      }
    }
  }

  // (3) first key-shaped string among the known epic custom fields.
  for (const id of EPIC_CUSTOM_FIELDS) {
    const value = fields[id];
    if (typeof value === 'string' && EPIC_KEY_RE.test(value.trim())) {
      return { epicKey: value.trim(), epicName: null };
    }
  }
  return { epicKey: null, epicName: null };
}

export function mapIssue(el: any): JiraIssue {
  const key: string = typeof el?.key === 'string' ? el.key : '';
  const fields: Record<string, unknown> = (el?.fields ?? {}) as Record<string, unknown>;

  const status = (fields.status ?? {}) as Record<string, unknown>;
  const statusName = typeof status.name === 'string' ? status.name : '';
  const statusCategory = (status.statusCategory ?? {}) as Record<string, unknown>;

  const priorityObj = fields.priority as Record<string, unknown> | null | undefined;
  let priority = typeof priorityObj?.name === 'string' ? priorityObj.name : '';
  if (!priority && priorityFieldId) {
    priority = readDisplayValue(fields[priorityFieldId]) ?? '';
  }

  const labels = readNames(fields.labels);
  const { epicKey, epicName } = resolveEpic(fields);

  const rejectReasons =
    readDisplayValue(fields['Reject Reasons']) ??
    (rejectReasonsFieldId ? readDisplayValue(fields[rejectReasonsFieldId]) : null);
  const severity =
    readDisplayValue(fields['Severity']) ??
    (severityFieldId ? readDisplayValue(fields[severityFieldId]) : null);

  const projectObj = fields.project as Record<string, unknown> | null | undefined;
  const projectKey =
    typeof projectObj?.key === 'string' && projectObj.key.length > 0
      ? projectObj.key
      : key.includes('-')
        ? key.slice(0, key.indexOf('-'))
        : '';

  const isBlocked =
    statusName.toLowerCase() === 'blocked' || labels.some((l) => l.toLowerCase() === 'blocked');
  const priorityLower = priority.toLowerCase();
  const isCritical = priorityLower === 'critical' || priorityLower === 'highest';

  return {
    originalOrder: 0,
    isStarred: false,
    key,
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    issueType: readDisplayValue((fields.issuetype as Record<string, unknown>)?.name) ?? '',
    status: statusName,
    statusCategory: typeof statusCategory.key === 'string' ? statusCategory.key : '',
    priority,
    assignee: readDisplayValue((fields.assignee as Record<string, unknown> | null)?.displayName) ?? null,
    reporter: readDisplayValue((fields.reporter as Record<string, unknown> | null)?.displayName) ?? null,
    projectKey,
    sprint: tryFindSprint(fields)?.name ?? null,
    created: normalizeJiraDate(typeof fields.created === 'string' ? fields.created : null) ?? '',
    updated: normalizeJiraDate(typeof fields.updated === 'string' ? fields.updated : null) ?? '',
    timeSpent: readSeconds(fields.timespent),
    remainingEstimate: readSeconds(fields.timeestimate),
    originalEstimate: readSeconds(fields.timeoriginalestimate),
    epicKey,
    epicName,
    allSprints: extractAllSprints(fields),
    workLoggedForPeriod: null,
    labels,
    components: readNames(fields.components),
    fixVersions: readNames(fields.fixVersions),
    boardNames: [],
    boardIds: [],
    isBlocked,
    isCritical,
    recentlyChanged: false,
    rejectReasons,
    changeSummary: null,
    severity,
  };
}

// ---------------------------------------------------------------------------
// mapUser / mapWorklog
// ---------------------------------------------------------------------------

export function mapUser(el: any): JiraUser {
  const accountId =
    (typeof el?.accountId === 'string' && el.accountId) ||
    (typeof el?.key === 'string' && el.key) ||
    (typeof el?.name === 'string' && el.name) ||
    '';
  return {
    accountId,
    displayName: typeof el?.displayName === 'string' ? el.displayName : '',
    emailAddress: typeof el?.emailAddress === 'string' ? el.emailAddress : null,
    avatarUrl: typeof el?.avatarUrls?.['48x48'] === 'string' ? el.avatarUrls['48x48'] : null,
    active: el?.active !== false,
  };
}

/** Collect plain text out of an ADF node tree (paragraph breaks → newlines). */
function adfToText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).filter((t) => t.length > 0).join('\n');
  if (typeof node !== 'object') return '';
  const obj = node as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  if (Array.isArray(obj.content)) {
    const joiner = obj.type === 'doc' ? '\n' : '';
    return obj.content.map(adfToText).filter((t) => t.length > 0).join(joiner);
  }
  return '';
}

function readCommentText(comment: unknown): string | null {
  if (comment === null || comment === undefined) return null;
  if (typeof comment === 'string') return comment.length > 0 ? comment : null;
  if (typeof comment === 'object') {
    const text = adfToText(comment);
    return text.length > 0 ? text : null;
  }
  return null;
}

export function mapWorklog(issueKey: string, el: any): JiraWorklog {
  return {
    id: el?.id !== null && el?.id !== undefined ? String(el.id) : '',
    issueKey,
    author: typeof el?.author?.displayName === 'string' ? el.author.displayName : '',
    authorAccountId: typeof el?.author?.accountId === 'string' ? el.author.accountId : null,
    started: normalizeJiraDate(typeof el?.started === 'string' ? el.started : null) ?? '',
    timeSpent: readSeconds(el?.timeSpentSeconds) ?? 0,
    comment: readCommentText(el?.comment),
  };
}

// ---------------------------------------------------------------------------
// AllFields extraction (details view)
// ---------------------------------------------------------------------------

const ALL_FIELDS_SKIP = new Set([
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'project',
  'created',
  'updated',
  'labels',
  'components',
  'fixVersions',
  'comment',
  'worklog',
  'description',
  'watches',
  'votes',
  'progress',
  'aggregateprogress',
  'timetracking',
  'parent',
]);

const HIDDEN_LABEL_SUBSTRINGS = ['development', 'tasks checklist', 'to do list proxy', 'validation list'];

function isJavaBean(value: string): boolean {
  return (
    value.includes('com.atlassian') ||
    value.includes('summaryBean=') ||
    (value.startsWith('[') && value.includes('@') && value.includes('='))
  );
}

/**
 * Flatten every remaining field into {key: label, value: text}, skipping the
 * well-known list, hidden labels, blanks and Java-bean strings. Sorted by
 * label, case-insensitively.
 */
export function extractAllFields(
  fields: Record<string, unknown> | null | undefined,
  names: Record<string, string> | null | undefined,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [fieldId, raw] of Object.entries(fields ?? {})) {
    if (ALL_FIELDS_SKIP.has(fieldId)) continue;
    const label = names?.[fieldId] ?? fieldId;
    const labelLower = label.toLowerCase();
    if (labelLower === 'epic link') continue;
    if (HIDDEN_LABEL_SUBSTRINGS.some((h) => labelLower.includes(h))) continue;
    const value = readDisplayValue(raw);
    if (value === null || value.trim().length === 0) continue;
    if (isJavaBean(value)) continue;
    out.push({ key: label, value });
  }
  out.sort((a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()));
  return out;
}

// ---------------------------------------------------------------------------
// Parent extraction
// ---------------------------------------------------------------------------

const PARENT_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * Accepts: object with `key`; plain key-shaped string; object with `value`
 * (recursed); array (first successful element).
 */
export function tryReadIssueRef(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return PARENT_KEY_RE.test(trimmed) ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      const ref = tryReadIssueRef(el);
      if (ref) return ref;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.key === 'string' && obj.key.length > 0) return obj.key;
    if ('value' in obj) return tryReadIssueRef(obj.value);
  }
  return null;
}

export interface ParentInfo {
  parentKey: string | null;
  parentSummary: string | null;
  parentFieldLabel: string | null;
}

/** Parent lookup, in order: fields.parent → "parent" custom fields → issuelinks → epic fields. */
export function extractParent(
  fields: Record<string, unknown> | null | undefined,
  names: Record<string, string> | null | undefined,
): ParentInfo {
  const f = fields ?? {};

  // 1. fields.parent.key
  const parent = f.parent;
  if (parent !== null && typeof parent === 'object' && !Array.isArray(parent)) {
    const obj = parent as Record<string, unknown>;
    if (typeof obj.key === 'string' && obj.key.length > 0) {
      const parentFields = (obj.fields ?? {}) as Record<string, unknown>;
      return {
        parentKey: obj.key,
        parentSummary: typeof parentFields.summary === 'string' ? parentFields.summary : null,
        parentFieldLabel: 'Parent',
      };
    }
  }

  // 2. Any custom field whose display label contains "parent" (ci).
  for (const [fieldId, value] of Object.entries(f)) {
    if (!fieldId.startsWith('customfield_')) continue;
    const label = names?.[fieldId];
    if (!label || !label.toLowerCase().includes('parent')) continue;
    const ref = tryReadIssueRef(value);
    if (ref) return { parentKey: ref, parentSummary: null, parentFieldLabel: label };
  }

  // 3. issuelinks with a parent-ish link type.
  const links = f.issuelinks;
  if (Array.isArray(links)) {
    for (const link of links) {
      if (link === null || typeof link !== 'object') continue;
      const l = link as Record<string, unknown>;
      const type = (l.type ?? {}) as Record<string, unknown>;
      const blob = [type.name, type.inward, type.outward]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      if (!blob.includes('parent')) continue;
      const inward = l.inwardIssue as Record<string, unknown> | undefined;
      if (typeof inward?.key === 'string' && inward.key.length > 0) {
        const inwardFields = (inward.fields ?? {}) as Record<string, unknown>;
        return {
          parentKey: inward.key,
          parentSummary: typeof inwardFields.summary === 'string' ? inwardFields.summary : null,
          parentFieldLabel: typeof type.inward === 'string' ? type.inward : 'Parent',
        };
      }
      const outward = l.outwardIssue as Record<string, unknown> | undefined;
      if (typeof outward?.key === 'string' && outward.key.length > 0) {
        const outwardFields = (outward.fields ?? {}) as Record<string, unknown>;
        return {
          parentKey: outward.key,
          parentSummary: typeof outwardFields.summary === 'string' ? outwardFields.summary : null,
          parentFieldLabel: typeof type.outward === 'string' ? type.outward : 'Parent',
        };
      }
    }
  }

  // 4. Known epic custom fields as plain key-shaped strings…
  for (const fieldId of ['customfield_10006', 'customfield_10008', 'customfield_10014']) {
    const value = f[fieldId];
    if (typeof value === 'string' && PARENT_KEY_RE.test(value.trim())) {
      return {
        parentKey: value.trim(),
        parentSummary: null,
        parentFieldLabel: names?.[fieldId] ?? fieldId,
      };
    }
  }
  // …then any custom field whose label contains "epic" (ci).
  for (const [fieldId, value] of Object.entries(f)) {
    if (!fieldId.startsWith('customfield_')) continue;
    const label = names?.[fieldId];
    if (!label || !label.toLowerCase().includes('epic')) continue;
    const ref = tryReadIssueRef(value);
    if (ref) return { parentKey: ref, parentSummary: null, parentFieldLabel: label };
  }

  return { parentKey: null, parentSummary: null, parentFieldLabel: null };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineSource {
  /** Raw changelog.histories[] elements. */
  histories?: unknown[];
  comments?: JiraComment[];
  worklogs?: JiraWorklog[];
}

function formatHours(seconds: number): string {
  const hours = Math.round((seconds / 3600) * 100) / 100;
  return String(hours);
}

/** Merge change/comment/worklog events, sorted ascending by time. */
export function buildTimeline(src: TimelineSource): JiraTimelineEvent[] {
  const events: JiraTimelineEvent[] = [];

  for (const history of src.histories ?? []) {
    if (history === null || typeof history !== 'object') continue;
    const h = history as Record<string, unknown>;
    const when = normalizeJiraDate(typeof h.created === 'string' ? h.created : null) ?? '';
    const author =
      typeof (h.author as Record<string, unknown> | undefined)?.displayName === 'string'
        ? ((h.author as Record<string, unknown>).displayName as string)
        : '';
    const items = Array.isArray(h.items) ? h.items : [];
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const field = typeof it.field === 'string' ? it.field : '';
      const from = typeof it.fromString === 'string' && it.fromString.length > 0 ? it.fromString : '—';
      const to = typeof it.toString === 'string' && it.toString.length > 0 ? it.toString : '—';
      events.push({ when, author, kind: 'change', summary: `${field}: ${from} → ${to}` });
    }
  }

  for (const comment of src.comments ?? []) {
    const body = comment.body ?? '';
    const summary = body.length > 280 ? `${body.slice(0, 280)}…` : body;
    events.push({ when: comment.created, author: comment.author, kind: 'comment', summary });
  }

  for (const worklog of src.worklogs ?? []) {
    const hours = formatHours(worklog.timeSpent);
    const summary = `+${hours}h${worklog.comment ? ` — ${worklog.comment}` : ''}`;
    events.push({ when: worklog.started, author: worklog.author, kind: 'worklog', summary });
  }

  events.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  return events;
}

// ---------------------------------------------------------------------------
// ADF helper (Cloud comment bodies)
// ---------------------------------------------------------------------------

/** Single-paragraph Atlassian Document Format body. */
export function adfParagraph(text: string): object {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}
