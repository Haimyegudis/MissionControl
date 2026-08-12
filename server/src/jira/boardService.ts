import { agilePrefix, jiraFetch, JiraError } from './httpClient.js';
import type { JiraSession } from './session.js';
import { mapIssue, normalizeJiraDate } from './mapper.js';
import type { JiraFetchFn } from './issueService.js';
import type {
  BoardLoadResult,
  JiraBoard,
  JiraIssue,
  JiraQuickFilter,
  JiraSprint,
} from '../types.js';

const GREENHOPPER = 'rest/greenhopper/1.0';

/** Quick-filter probe chain (§2.10), in order. */
const QUICK_FILTER_PROBES: readonly ((rapidViewId: number) => string)[] = [
  (id) => `${GREENHOPPER}/rapidviewconfig/quickfilters?rapidViewId=${id}`,
  (id) => `${GREENHOPPER}/rapidview/${id}`,
  () => `${GREENHOPPER}/rapidviews/list`,
  (id) => `${GREENHOPPER}/xboard/config.json?rapidViewId=${id}`,
  (id) => `${GREENHOPPER}/rapidviewconfig/editmodel?rapidViewId=${id}`,
];

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function errorText(scope: 'greenhopper' | 'agile', err: unknown): string {
  if (err instanceof JiraError) return `${scope} ${err.status}`;
  return `${scope}: ${err instanceof Error ? err.message : String(err)}`;
}

/** Walk the whole JSON tree; collect any (ci) `quickFilters` array property. */
function scanQuickFilters(node: unknown, out: JiraQuickFilter[]): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const el of node) scanQuickFilters(el, out);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.toLowerCase() === 'quickfilters' && Array.isArray(value)) {
      for (const el of value) {
        if (el === null || typeof el !== 'object' || Array.isArray(el)) continue;
        const obj = el as Record<string, unknown>;
        if (typeof obj.name !== 'string' || obj.name.length === 0) continue;
        out.push({
          id: toNumber(obj.id) ?? 0,
          name: obj.name,
          query: typeof obj.query === 'string' ? obj.query : '',
        });
      }
    } else {
      scanQuickFilters(value, out);
    }
  }
}

/** Board service (jira-rest-layer.md §2.9–§2.10). */
export class JiraBoardService {
  constructor(
    private readonly session: JiraSession,
    private readonly fetchFn: JiraFetchFn = jiraFetch,
  ) {}

  /**
   * Merge greenhopper rapidviews/list with paged agile /board results into a
   * Map keyed by board id — greenhopper wins on collision — sorted by name ci.
   */
  async getBoards(): Promise<BoardLoadResult> {
    if (!this.session.isConnected) {
      return { boards: [], fromGreenhopper: 0, fromAgile: 0, greenhopperError: null, agileError: null };
    }

    const merged = new Map<number, JiraBoard>();
    let fromGreenhopper = 0;
    let fromAgile = 0;
    let greenhopperError: string | null = null;
    let agileError: string | null = null;

    // Agile first so greenhopper overwrites on collision.
    try {
      const agileBoards = await this.fetchAgileBoards();
      fromAgile = agileBoards.length;
      for (const board of agileBoards) merged.set(board.id, board);
    } catch (err) {
      agileError = errorText('agile', err);
    }

    try {
      const ghBoards = await this.fetchGreenhopperBoards();
      fromGreenhopper = ghBoards.length;
      for (const board of ghBoards) merged.set(board.id, board);
    } catch (err) {
      greenhopperError = errorText('greenhopper', err);
    }

    const boards = [...merged.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    return { boards, fromGreenhopper, fromAgile, greenhopperError, agileError };
  }

  private async fetchGreenhopperBoards(): Promise<JiraBoard[]> {
    const resp = await this.fetchFn(this.session, `${GREENHOPPER}/rapidviews/list`);
    if (!Array.isArray(resp?.views)) {
      throw new Error('no views array');
    }
    const out: JiraBoard[] = [];
    for (const view of resp.views as any[]) {
      const id = toNumber(view?.id);
      if (id === null) continue;
      out.push({
        id,
        name: typeof view?.name === 'string' ? view.name : '',
        type: view?.sprintSupportEnabled === true ? 'scrum' : 'kanban',
        projectKey: null,
        projectName: null,
        filterId: toNumber(view?.filter?.id) ?? toNumber(view?.savedFilterId),
        filterName: typeof view?.filter?.name === 'string' ? view.filter.name : null,
      });
    }
    return out;
  }

  private async fetchAgileBoards(): Promise<JiraBoard[]> {
    const out: JiraBoard[] = [];
    let startAt = 0;
    for (;;) {
      const resp = await this.fetchFn(this.session, `${agilePrefix()}/board`, {
        query: { startAt, maxResults: 50 },
      });
      if (!Array.isArray(resp?.values)) break;
      const batch: any[] = resp.values;
      if (batch.length === 0) break;
      for (const el of batch) {
        const id = toNumber(el?.id);
        if (id === null) continue;
        out.push({
          id,
          name: typeof el?.name === 'string' ? el.name : '',
          type: typeof el?.type === 'string' ? el.type : '',
          projectKey: typeof el?.location?.projectKey === 'string' ? el.location.projectKey : null,
          projectName:
            typeof el?.location?.projectName === 'string' ? el.location.projectName : null,
          filterId: toNumber(el?.filter?.id),
          filterName: typeof el?.filter?.name === 'string' ? el.filter.name : null,
        });
      }
      startAt += batch.length;
      if (resp?.isLast === true || batch.length < 50) break;
    }
    return out;
  }

  async getActiveSprints(boardId: number): Promise<JiraSprint[]> {
    if (!this.session.isConnected) return [];
    const resp = await this.fetchFn(this.session, `${agilePrefix()}/board/${boardId}/sprint`, {
      query: { state: 'active' },
    });
    const values: any[] = Array.isArray(resp?.values) ? resp.values : [];
    return values.map((el) => ({
      id: toNumber(el?.id) ?? 0,
      name: typeof el?.name === 'string' ? el.name : '',
      state: typeof el?.state === 'string' ? el.state : '',
      startDate: normalizeJiraDate(typeof el?.startDate === 'string' ? el.startDate : null),
      endDate: normalizeJiraDate(typeof el?.endDate === 'string' ? el.endDate : null),
      originBoardId: toNumber(el?.originBoardId),
    }));
  }

  /** Returns [] on any failure (different error contract from search — §10.3). */
  async getBoardIssues(boardId: number, jql?: string): Promise<JiraIssue[]> {
    if (!this.session.isConnected) return [];
    const query: Record<string, string | number> = { maxResults: 100 };
    if (jql && jql.trim().length > 0) query.jql = jql;
    try {
      const resp = await this.fetchFn(this.session, `${agilePrefix()}/board/${boardId}/issue`, {
        query,
      });
      const issues: any[] = Array.isArray(resp?.issues) ? resp.issues : [];
      return issues.map(mapIssue);
    } catch {
      return [];
    }
  }

  /** 5-endpoint greenhopper probe chain; first non-empty quickFilters wins. */
  async getQuickFilters(rapidViewId: number): Promise<JiraQuickFilter[]> {
    if (!this.session.isConnected) return [];
    for (const probe of QUICK_FILTER_PROBES) {
      let resp: unknown;
      try {
        resp = await this.fetchFn(this.session, probe(rapidViewId));
      } catch {
        continue;
      }
      const found: JiraQuickFilter[] = [];
      scanQuickFilters(resp, found);
      if (found.length > 0) return found;
    }
    return [];
  }
}
