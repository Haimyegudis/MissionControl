import { apiPrefix, jiraFetch } from './httpClient.js';
import type { JiraSession } from './session.js';
import type { JiraFetchFn, JqlFieldResolver } from './issueService.js';

/** Alias table for JQL field-reference resolution (§6, keys lowercased, verbatim). */
export const JQL_FIELD_ALIASES: Readonly<Record<string, string>> = {
  'wt group': 'WT',
  'program group': 'Program',
  'submitting team group': 'Submitting Team',
  'sw ee teams group': 'SW EE Team',
  'phase detected': 'Found in Project Phase',
  'defect status': 'Status',
  'priority&severity': 'Severity',
  'priority & severity': 'Severity',
  'bugs mapping': 'Labels',
  'automation statistics': 'Automation',
  'bug classification': 'Bug Resolution',
  'bug classification & reason': 'Bug Resolution',
  'regression vs feature': 'Regression Type',
};

/** Strip non-alphanumerics + lowercase, for tolerant field-name matching. */
function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Metadata service (jira-rest-layer.md §2.13 + §6 field resolution). */
export class JiraMetadataService implements JqlFieldResolver {
  /** Case-insensitive display-name → field-id map, loaded once per process. */
  private fieldMapPromise: Promise<Map<string, string>> | null = null;

  constructor(
    private readonly session: JiraSession,
    private readonly fetchFn: JiraFetchFn = jiraFetch,
  ) {}

  private get prefix(): string {
    return apiPrefix(this.session.profile?.instanceType ?? 'datacenter');
  }

  // -------------------------------------------------------------------------
  // Simple lists: distinct then ordinal sort
  // -------------------------------------------------------------------------

  private async fetchList(path: string, prop: string): Promise<string[]> {
    if (!this.session.isConnected) return [];
    const resp = await this.fetchFn(this.session, path);
    const arr: any[] = Array.isArray(resp) ? resp : [];
    const distinct = new Set<string>();
    for (const el of arr) {
      const v = el?.[prop];
      if (typeof v === 'string' && v.length > 0) distinct.add(v);
    }
    return [...distinct].sort();
  }

  getProjects(): Promise<string[]> {
    return this.fetchList(`${this.prefix}/project`, 'key');
  }

  getIssueTypes(): Promise<string[]> {
    return this.fetchList(`${this.prefix}/issuetype`, 'name');
  }

  getStatuses(): Promise<string[]> {
    return this.fetchList(`${this.prefix}/status`, 'name');
  }

  /** Status id → display name (Time-in-Status raw values carry ids only). */
  async getStatusMap(): Promise<Record<string, string>> {
    if (!this.session.isConnected) return {};
    const resp = await this.fetchFn(this.session, `${this.prefix}/status`);
    const map: Record<string, string> = {};
    for (const el of Array.isArray(resp) ? (resp as any[]) : []) {
      const id = el?.id;
      const name = el?.name;
      if ((typeof id === 'string' || typeof id === 'number') && typeof name === 'string') {
        map[String(id)] = name;
      }
    }
    return map;
  }

  getPriorities(): Promise<string[]> {
    return this.fetchList(`${this.prefix}/priority`, 'name');
  }

  getResolutions(): Promise<string[]> {
    return this.fetchList(`${this.prefix}/resolution`, 'name');
  }

  /** All visible Jira field display names, including custom fields. */
  async getFields(): Promise<string[]> {
    if (!this.session.isConnected) return [];
    try {
      const resp = await this.fetchFn(this.session, `${this.prefix}/field`);
      const distinct = new Set<string>();
      for (const el of Array.isArray(resp) ? (resp as any[]) : []) {
        if (typeof el?.name === 'string' && el.name.trim().length > 0) {
          distinct.add(el.name.trim());
        }
      }
      return [...distinct].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Versions / components: distinct, ci sort, [] on any failure
  // -------------------------------------------------------------------------

  private async fetchProjectList(path: string): Promise<string[]> {
    if (!this.session.isConnected) return [];
    try {
      const resp = await this.fetchFn(this.session, path);
      const arr: any[] = Array.isArray(resp) ? resp : [];
      const distinct = new Set<string>();
      for (const el of arr) {
        if (typeof el?.name === 'string' && el.name.length > 0) distinct.add(el.name);
      }
      return [...distinct].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    } catch {
      return [];
    }
  }

  getVersions(projectKey: string): Promise<string[]> {
    return this.fetchProjectList(`${this.prefix}/project/${encodeURIComponent(projectKey)}/versions`);
  }

  getComponents(projectKey: string): Promise<string[]> {
    return this.fetchProjectList(
      `${this.prefix}/project/${encodeURIComponent(projectKey)}/components`,
    );
  }

  // -------------------------------------------------------------------------
  // Assignable users: page 50, cap 1000, max 25 iterations, 10 s timeout
  // -------------------------------------------------------------------------

  async getAssignableUsers(projectKey: string): Promise<string[]> {
    if (!this.session.isConnected) return [];
    const distinct = new Set<string>();
    let startAt = 0;
    try {
      for (let i = 0; i < 25; i++) {
        if (distinct.size >= 1000) break;
        const resp = await this.fetchFn(this.session, `${this.prefix}/user/assignable/search`, {
          // username=. sent defensively for DC builds that reject a missing username
          query: { project: projectKey, username: '.', startAt, maxResults: 50 },
          timeoutMs: 10_000,
        });
        const arr: any[] = Array.isArray(resp) ? resp : [];
        for (const el of arr) {
          if (typeof el?.displayName === 'string' && el.displayName.length > 0) {
            distinct.add(el.displayName);
          }
        }
        startAt += arr.length;
        if (arr.length === 0 || arr.length < 50) break;
      }
    } catch {
      // return whatever was collected so far
    }
    return [...distinct].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  // -------------------------------------------------------------------------
  // Field suggestions: distinct, no sort
  // -------------------------------------------------------------------------

  async getFieldSuggestions(fieldName: string, query?: string | null): Promise<string[]> {
    if (!this.session.isConnected) return [];
    const params: Record<string, string> = { fieldName };
    if (query && query.trim().length > 0) params.fieldValue = query;
    const defaultProject = this.session.profile?.defaultProjectKey?.trim();
    if (defaultProject) {
      params.predicateName = 'project';
      params.predicateValue = defaultProject;
    }
    try {
      const resp = await this.fetchFn(
        this.session,
        `${this.prefix}/jql/autocompletedata/suggestions`,
        { query: params },
      );
      const results: any[] = Array.isArray(resp?.results) ? resp.results : [];
      const distinct = new Set<string>();
      for (const el of results) {
        if (typeof el?.value === 'string' && el.value.length > 0) distinct.add(el.value);
      }
      return [...distinct];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Field-id map + JQL field-reference resolution (§6)
  // -------------------------------------------------------------------------

  private loadFieldMap(): Promise<Map<string, string>> {
    if (!this.fieldMapPromise) {
      this.fieldMapPromise = (async () => {
        const resp = await this.fetchFn(this.session, `${this.prefix}/field`);
        const map = new Map<string, string>();
        for (const el of Array.isArray(resp) ? (resp as any[]) : []) {
          if (typeof el?.name !== 'string' || typeof el?.id !== 'string') continue;
          const key = el.name.toLowerCase();
          if (!map.has(key)) map.set(key, el.id);
        }
        return map;
      })().catch((err) => {
        this.fieldMapPromise = null; // failed loads are retried
        throw err;
      });
    }
    return this.fieldMapPromise;
  }

  private static findInMap(map: Map<string, string>, displayName: string): string | null {
    const lower = displayName.trim().toLowerCase();
    const exact = map.get(lower);
    if (exact) return exact;
    const norm = normalizeFieldName(displayName);
    if (norm.length > 0) {
      for (const [name, id] of map) {
        if (normalizeFieldName(name) === norm) return id;
      }
    }
    return null;
  }

  /** Exact map hit → normalized match → alias table → null. */
  async resolveFieldId(displayName: string): Promise<string | null> {
    let map: Map<string, string>;
    try {
      map = await this.loadFieldMap();
    } catch {
      return null;
    }
    const direct = JiraMetadataService.findInMap(map, displayName);
    if (direct) return direct;
    const alias = JQL_FIELD_ALIASES[displayName.trim().toLowerCase()];
    if (alias) return JiraMetadataService.findInMap(map, alias);
    return null;
  }

  /**
   * Display name → JQL reference: unknown → quoted name; custom field →
   * `cf[NNNN]` (never `customfield_NNNN`, which 400s in JQL); else the id.
   */
  async resolveJqlField(displayName: string): Promise<string> {
    const id = await this.resolveFieldId(displayName);
    if (id === null) return `"${displayName}"`;
    if (id.startsWith('customfield_')) return `cf[${id.slice('customfield_'.length)}]`;
    return id;
  }
}
