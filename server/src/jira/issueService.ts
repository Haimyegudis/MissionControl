import sanitizeHtml from 'sanitize-html';
import { apiPrefix, jiraFetch, type JiraFetchOptions } from './httpClient.js';
import type { JiraSession } from './session.js';

/** Jira-rendered HTML → safe subset (keeps formatting, tables, images). */
function sanitizeDescriptionHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'span', 'del', 'ins', 'u']),
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'data'],
    disallowedTagsMode: 'discard',
  });
}
import {
  buildTimeline,
  extractAllFields,
  extractParent,
  mapIssue,
  mapUser,
  mapWorklog,
  normalizeJiraDate,
  adfParagraph,
  resetFieldIds,
  setPriorityFieldId,
  setRejectReasonsFieldId,
  setSeverityFieldId,
  setSprintFieldId,
} from './mapper.js';
import type {
  JiraComment,
  JiraIssue,
  JiraIssueDetails,
  JiraTransition,
  JiraTransitionField,
  JiraUser,
  PagedResult,
} from '../types.js';

/** Injectable jiraFetch-shaped function (tests substitute a mock). */
export type JiraFetchFn = (
  session: JiraSession,
  path: string,
  opts?: JiraFetchOptions,
) => Promise<any>;

/**
 * JQL field resolver contract (implemented by JiraMetadataService).
 * Passed as a parameter to getDistinctIssueField to avoid a module cycle.
 */
export interface JqlFieldResolver {
  /** Display name → JQL-safe reference (cf[NNNN] / id / quoted name). */
  resolveJqlField(displayName: string): Promise<string>;
  /** Display name → raw field id, or null when unknown. */
  resolveFieldId(displayName: string): Promise<string | null>;
}

/** Search field list (jira-rest-layer.md §2.2, verbatim). */
export const BASE_FIELDS: readonly string[] = [
  'summary',
  'issuetype',
  'status',
  'priority',
  'assignee',
  'reporter',
  'project',
  'created',
  'updated',
  'timespent',
  'timeestimate',
  'timeoriginalestimate',
  'parent',
  'epic',
  'customfield_10014',
  'customfield_10008',
  'customfield_10100',
  'customfield_10000',
  'customfield_10001',
  'customfield_10006',
  'labels',
  'components',
  'fixVersions',
  'Reject Reasons',
  'Severity',
];

// ---------------------------------------------------------------------------
// Epic name enrichment (§2.5): module-level LRU cap 500, concurrency 8.
// ---------------------------------------------------------------------------

const EPIC_NAME_CACHE_CAP = 500;
const EPIC_CONCURRENCY = 8;

/** Insertion-ordered Map used as an LRU (most recently used at the end). */
const epicNameCache = new Map<string, string>();

function epicCacheGet(key: string): string | null {
  if (!epicNameCache.has(key)) return null;
  const value = epicNameCache.get(key)!;
  // move-to-front (most recently used)
  epicNameCache.delete(key);
  epicNameCache.set(key, value);
  return value;
}

function epicCachePut(key: string, value: string): void {
  if (epicNameCache.has(key)) epicNameCache.delete(key);
  epicNameCache.set(key, value);
  while (epicNameCache.size > EPIC_NAME_CACHE_CAP) {
    const oldest = epicNameCache.keys().next().value as string;
    epicNameCache.delete(oldest);
  }
}

/** Test hook: clear the module-level epic-name LRU. */
export function resetEpicNameCache(): void {
  epicNameCache.clear();
}

/**
 * Issue field value → display string for transition-screen prefill.
 * Handles strings, numbers, option/named objects ({value}/{name}/{displayName})
 * and arrays (first element). Unknown shapes → null.
 */
export function extractCurrentFieldValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    for (const el of v) {
      const s = extractCurrentFieldValue(el);
      if (s !== null) return s;
    }
    return null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const key of ['value', 'name', 'displayName']) {
      if (typeof o[key] === 'string' && (o[key] as string).length > 0) return o[key] as string;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ADF → plain text (comment bodies on Cloud)
// ---------------------------------------------------------------------------

function adfToText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    return node
      .map(adfToText)
      .filter((t) => t.length > 0)
      .join('\n');
  }
  if (typeof node !== 'object') return '';
  const obj = node as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  if (Array.isArray(obj.content)) {
    const joiner = obj.type === 'doc' ? '\n' : '';
    return obj.content
      .map(adfToText)
      .filter((t) => t.length > 0)
      .join(joiner);
  }
  return '';
}

function commentBodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body !== null && typeof body === 'object') return adfToText(body);
  return '';
}

function mapComment(el: any): JiraComment {
  return {
    author: typeof el?.author?.displayName === 'string' ? el.author.displayName : '',
    created: normalizeJiraDate(typeof el?.created === 'string' ? el.created : null) ?? '',
    body: commentBodyText(el?.body),
  };
}

// ---------------------------------------------------------------------------
// Distinct-field value extraction (§6)
// ---------------------------------------------------------------------------

function collectDistinctValues(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    out.push(String(value).replace(/\.0$/, ''));
    return;
  }
  if (typeof value === 'string') {
    if (value.includes('name=')) {
      const m = value.match(/name=([^,\]]*)/);
      if (m && m[1]) out.push(m[1]);
    } else {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const el of value) collectDistinctValues(el, out);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, any>;
    // Jira user objects commonly expose both `name` (login/email) and
    // `displayName` (human-readable name). Prefer the latter consistently.
    const direct = [obj.displayName, obj.value, obj.name].find(
      (v) => typeof v === 'string' && v.length > 0,
    );
    if (direct) {
      out.push(direct as string);
      return;
    }
    if (typeof obj.fields?.summary === 'string' && obj.fields.summary.length > 0) {
      out.push(obj.fields.summary);
      return;
    }
    if (typeof obj.key === 'string' && obj.key.length > 0) out.push(obj.key);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class JiraIssueService {
  private cachedFields: string[] | null = null;
  private fieldDiscovery: Promise<string[]> | null = null;

  constructor(
    private readonly session: JiraSession,
    private readonly fetchFn: JiraFetchFn = jiraFetch,
  ) {}

  private get prefix(): string {
    return apiPrefix(this.session.profile?.instanceType ?? 'datacenter');
  }

  private get isCloud(): boolean {
    return this.session.profile?.instanceType === 'cloud';
  }

  /** Clear the discovered-field cache (and mapper field ids). */
  resetFieldCache(): void {
    this.cachedFields = null;
    this.fieldDiscovery = null;
    resetFieldIds();
  }

  // -------------------------------------------------------------------------
  // Dynamic field discovery (§2.3)
  // -------------------------------------------------------------------------

  private async getSearchFields(): Promise<string[]> {
    if (this.cachedFields) return this.cachedFields;
    if (!this.fieldDiscovery) {
      this.fieldDiscovery = this.discoverFields().finally(() => {
        this.fieldDiscovery = null;
      });
    }
    return this.fieldDiscovery;
  }

  private async discoverFields(): Promise<string[]> {
    let list: any;
    try {
      list = await this.fetchFn(this.session, `${this.prefix}/field`);
    } catch {
      return [...BASE_FIELDS]; // not cached — retried on next search
    }
    const arr: any[] = Array.isArray(list) ? list : [];

    let sprintId: string | null = null;
    let severityId: string | null = null;
    let rejectReasonsId: string | null = null;
    let priorityId: string | null = null;
    for (const el of arr) {
      const id = typeof el?.id === 'string' ? el.id : null;
      const name = typeof el?.name === 'string' ? el.name.toLowerCase() : null;
      if (!id || !name) continue;
      if (name === 'sprint' && sprintId === null) sprintId = id;
      else if (name === 'severity' && severityId === null) severityId = id;
      else if (name === 'reject reasons' && rejectReasonsId === null) rejectReasonsId = id;
      else if (name === 'priority' && priorityId === null && id.startsWith('customfield_'))
        priorityId = id;
    }

    setSprintFieldId(sprintId);
    setSeverityFieldId(severityId);
    setRejectReasonsFieldId(rejectReasonsId);
    setPriorityFieldId(priorityId);

    const fields = [...BASE_FIELDS];
    for (const id of [sprintId, severityId, rejectReasonsId, priorityId]) {
      if (id && !fields.includes(id)) fields.push(id);
    }
    this.cachedFields = fields;
    return fields;
  }

  // -------------------------------------------------------------------------
  // Search (§2.2)
  // -------------------------------------------------------------------------

  async searchIssues(jql: string, startAt = 0, maxResults = 50): Promise<PagedResult<JiraIssue>> {
    if (!this.session.isConnected) {
      return { items: [], startAt, maxResults, total: 0, hasMore: false };
    }
    const fields = await this.getSearchFields();
    const resp = await this.fetchFn(this.session, `${this.prefix}/search`, {
      method: 'POST',
      body: { jql, startAt, maxResults, fields },
    });
    const issues: any[] = Array.isArray(resp?.issues) ? resp.issues : [];
    const items = issues.map(mapIssue);
    const respStartAt = typeof resp?.startAt === 'number' ? resp.startAt : startAt;
    const respMax = typeof resp?.maxResults === 'number' ? resp.maxResults : maxResults;
    const total = typeof resp?.total === 'number' ? resp.total : items.length;
    return {
      items,
      startAt: respStartAt,
      maxResults: respMax,
      total,
      hasMore: respStartAt + items.length < total,
    };
  }

  /** Page size 100. Page 1 lands first (it carries `total`); the remaining
   *  pages up to the cap are fetched in PARALLEL instead of serially. */
  async searchAll(jql: string, hardCap: number, pageSize = 100): Promise<JiraIssue[]> {
    const first = await this.searchIssues(jql, 0, pageSize);
    const all: JiraIssue[] = [...first.items];
    if (!first.hasMore || first.items.length === 0 || all.length >= hardCap) {
      return all.slice(0, hardCap);
    }
    const target = Math.min(hardCap, first.total > 0 ? first.total : hardCap);
    const starts: number[] = [];
    for (let s = first.items.length; s < target; s += pageSize) starts.push(s);
    const pages = await Promise.all(starts.map((s) => this.searchIssues(jql, s, pageSize)));
    for (const page of pages) all.push(...page.items);
    return all.slice(0, hardCap);
  }

  // -------------------------------------------------------------------------
  // Issue details (§2.4) + epic name enrichment (§2.5)
  // -------------------------------------------------------------------------

  async getIssueDetails(issueKey: string): Promise<JiraIssueDetails> {
    const resp = await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}`,
      { query: { fields: '*all', expand: 'renderedFields,names,changelog' } },
    );
    const fields: Record<string, unknown> = (resp?.fields ?? {}) as Record<string, unknown>;
    const names: Record<string, string> = (resp?.names ?? {}) as Record<string, string>;

    const issue = mapIssue(resp);
    await this.enrichEpicNames([issue]);

    const rawComments: any[] = Array.isArray((fields.comment as any)?.comments)
      ? (fields.comment as any).comments
      : [];
    const comments = rawComments.map(mapComment);
    const rawWorklogs: any[] = Array.isArray((fields.worklog as any)?.worklogs)
      ? (fields.worklog as any).worklogs
      : [];
    const worklogs = rawWorklogs.map((el) => mapWorklog(issueKey, el));

    let transitions: JiraTransition[] = [];
    try {
      transitions = await this.getTransitions(issueKey);
    } catch {
      // transitions are best-effort in the details view
    }

    const parent = extractParent(fields, names);
    const description =
      typeof fields.description === 'string'
        ? fields.description
        : fields.description !== null && fields.description !== undefined
          ? JSON.stringify(fields.description)
          : '';
    const renderedDescription = resp?.renderedFields?.description;

    const baseUrl = (this.session.profile?.jiraBaseUrl ?? '').trim().replace(/\/+$/, '');
    const histories: unknown[] = Array.isArray(resp?.changelog?.histories)
      ? resp.changelog.histories
      : [];

    return {
      issue,
      description,
      // Server-side sanitize — the client denylist stays as defense-in-depth.
      descriptionHtml:
        typeof renderedDescription === 'string' ? sanitizeDescriptionHtml(renderedDescription) : null,
      comments,
      worklogs,
      transitions,
      allFields: extractAllFields(fields, names),
      browseUrl: baseUrl.length > 0 ? `${baseUrl}/browse/${issueKey}` : null,
      parentKey: parent.parentKey,
      parentSummary: parent.parentSummary,
      parentFieldLabel: parent.parentFieldLabel,
      timeline: buildTimeline({ histories, comments, worklogs }),
    };
  }

  /**
   * Fill missing epicName from `GET issue/{epicKey}?fields=summary`.
   * Concurrency cap 8; module LRU cap 500; failures silently ignored.
   */
  async enrichEpicNames(issues: JiraIssue[]): Promise<void> {
    const pending = new Map<string, JiraIssue[]>();
    for (const issue of issues) {
      if (!issue.epicKey || issue.epicName) continue;
      const cached = epicCacheGet(issue.epicKey);
      if (cached !== null) {
        issue.epicName = cached;
        continue;
      }
      const list = pending.get(issue.epicKey) ?? [];
      list.push(issue);
      pending.set(issue.epicKey, list);
    }
    if (pending.size === 0) return;

    const keys = [...pending.keys()];
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= keys.length) return;
        const epicKey = keys[i];
        try {
          const resp = await this.fetchFn(
            this.session,
            `${this.prefix}/issue/${encodeURIComponent(epicKey)}`,
            { query: { fields: 'summary' } },
          );
          const summary = resp?.fields?.summary;
          if (typeof summary === 'string' && summary.length > 0) {
            epicCachePut(epicKey, summary);
            for (const issue of pending.get(epicKey) ?? []) issue.epicName = summary;
          }
        } catch {
          // enrichment failures are silently ignored
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(EPIC_CONCURRENCY, keys.length) }, () => worker()),
    );
  }

  // -------------------------------------------------------------------------
  // Current user (§2.1)
  // -------------------------------------------------------------------------

  async getCurrentUser(): Promise<JiraUser> {
    const resp = await this.fetchFn(this.session, `${this.prefix}/myself`);
    return mapUser(resp);
  }

  // -------------------------------------------------------------------------
  // Transitions (§2.6)
  // -------------------------------------------------------------------------

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    if (!this.session.isConnected) return [];
    const resp = await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
    const list: any[] = Array.isArray(resp?.transitions) ? resp.transitions : [];
    return list.map((t) => ({
      id: t?.id !== null && t?.id !== undefined ? String(t.id) : '',
      name: typeof t?.name === 'string' ? t.name : '',
      toStatus: typeof t?.to?.name === 'string' ? t.to.name : null,
    }));
  }

  async getTransitionScreen(issueKey: string, transitionId: string): Promise<JiraTransitionField[]> {
    if (!this.session.isConnected) return [];
    const resp = await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}/transitions`,
      { query: { expand: 'transitions.fields' } },
    );
    const list: any[] = Array.isArray(resp?.transitions) ? resp.transitions : [];
    const match = list.find((t) => String(t?.id) === String(transitionId));
    const fieldsObj = match?.fields;
    if (!fieldsObj || typeof fieldsObj !== 'object') return [];
    const out: JiraTransitionField[] = [];
    for (const [fieldId, def] of Object.entries(fieldsObj as Record<string, any>)) {
      const allowed: string[] = [];
      for (const el of Array.isArray(def?.allowedValues) ? def.allowedValues : []) {
        const v = typeof el?.value === 'string' && el.value.length > 0 ? el.value : el?.name;
        if (typeof v === 'string' && v.length > 0) allowed.push(v);
      }
      out.push({
        id: fieldId,
        name: typeof def?.name === 'string' && def.name.length > 0 ? def.name : fieldId,
        required: def?.required === true,
        schemaType: typeof def?.schema?.type === 'string' ? def.schema.type : '',
        itemType: typeof def?.schema?.items === 'string' ? def.schema.items : null,
        allowedValues: allowed,
        currentValue: null,
      });
    }

    // Prefill: read the issue's current values for the screen fields so the
    // dialog keeps them (e.g. Task Type on close) instead of forcing a re-pick.
    if (out.length > 0) {
      try {
        const issue = await this.fetchFn(
          this.session,
          `${this.prefix}/issue/${encodeURIComponent(issueKey)}`,
          { query: { fields: out.map((f) => f.id).join(',') } },
        );
        const current = issue?.fields && typeof issue.fields === 'object' ? issue.fields : {};
        for (const f of out) f.currentValue = extractCurrentFieldValue(current[f.id]);
      } catch {
        // best-effort — the dialog just starts empty
      }
    }
    return out;
  }

  async performTransition(issueKey: string, transitionId: string): Promise<void> {
    await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}/transitions`,
      { method: 'POST', body: { transition: { id: transitionId } } },
    );
  }

  /**
   * Transition with screen data. Payload shaping per §2.6:
   * - `worklog` is deleted from `fields` (Jira rejects it there);
   * - assignee → `fields.assignee = { name }` (DC-style username);
   * - comment → `update.comment = [{ add }]` — ADF on Cloud, `{ body }` on DC;
   * - timeSpent → `update.worklog = [{ add: { timeSpent } }]`;
   * - `update` omitted entirely when both comment and timeSpent are absent.
   */
  async performTransitionWithData(
    issueKey: string,
    transitionId: string,
    fields: Record<string, unknown>,
    comment?: string | null,
    assignee?: string | null,
    timeSpent?: string | null,
  ): Promise<void> {
    const shapedFields: Record<string, unknown> = { ...fields };
    delete shapedFields.worklog;
    if (assignee && assignee.trim().length > 0) {
      shapedFields.assignee = { name: assignee };
    }

    const update: Record<string, unknown> = {};
    if (comment && comment.trim().length > 0) {
      update.comment = [{ add: this.isCloud ? adfParagraph(comment) : { body: comment } }];
    }
    if (timeSpent && timeSpent.trim().length > 0) {
      update.worklog = [{ add: { timeSpent } }];
    }

    const body: Record<string, unknown> = {
      transition: { id: transitionId },
      fields: shapedFields,
    };
    if (Object.keys(update).length > 0) body.update = update;

    await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}/transitions`,
      { method: 'POST', body },
    );
  }

  // -------------------------------------------------------------------------
  // Comments & labels (§2.7)
  // -------------------------------------------------------------------------

  async addComment(issueKey: string, body: string): Promise<void> {
    if (!body || body.trim().length === 0) return; // no-op on empty input
    const payload = this.isCloud ? { body: adfParagraph(body) } : { body };
    await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}/comment`,
      { method: 'POST', body: payload },
    );
  }

  async addLabel(issueKey: string, label: string): Promise<void> {
    if (!label || label.trim().length === 0) return; // no-op on empty input
    await this.fetchFn(this.session, `${this.prefix}/issue/${encodeURIComponent(issueKey)}`, {
      method: 'PUT',
      body: { update: { labels: [{ add: label }] } },
    });
  }

  /** Assign an issue; DC takes {name}, Cloud {accountId}. */
  async setAssignee(issueKey: string, assignee: string): Promise<void> {
    if (!assignee || assignee.trim().length === 0) return;
    const body = this.isCloud ? { accountId: assignee } : { name: assignee };
    await this.fetchFn(this.session, `${this.prefix}/issue/${encodeURIComponent(issueKey)}/assignee`, {
      method: 'PUT',
      body,
    });
  }

  // -------------------------------------------------------------------------
  // Distinct field values (§6)
  // -------------------------------------------------------------------------

  /**
   * `project = {key} AND {jqlField} is not EMPTY`, page 200, 45 s timeout,
   * hardCap = max(maxIssues, 200). Values ci-distinct, ci-sorted.
   */
  async getDistinctIssueField(
    projectKey: string,
    fieldName: string,
    maxIssues: number,
    resolver: JqlFieldResolver,
  ): Promise<string[]> {
    if (!this.session.isConnected) return [];
    const jqlField = await resolver.resolveJqlField(fieldName);
    const fieldId = await resolver.resolveFieldId(fieldName);
    const requestField = fieldId ?? fieldName;
    const jql = `project = ${projectKey} AND ${jqlField} is not EMPTY`;
    const hardCap = Math.max(maxIssues, 200);

    const distinct = new Map<string, string>(); // lower → original
    let startAt = 0;
    for (;;) {
      const resp = await this.fetchFn(this.session, `${this.prefix}/search`, {
        method: 'POST',
        body: { jql, startAt, maxResults: 200, fields: [requestField] },
        timeoutMs: 45_000,
      });
      const issues: any[] = Array.isArray(resp?.issues) ? resp.issues : [];
      for (const issue of issues) {
        const collected: string[] = [];
        collectDistinctValues(issue?.fields?.[requestField], collected);
        for (const raw of collected) {
          const value = raw.trim();
          if (value.length === 0) continue;
          const lower = value.toLowerCase();
          if (!distinct.has(lower)) distinct.set(lower, value);
        }
      }
      startAt += issues.length;
      const total = typeof resp?.total === 'number' ? resp.total : startAt;
      if (issues.length < 200 || startAt >= total || startAt >= hardCap) break;
    }

    return [...distinct.values()].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }
}
