import { apiPrefix, jiraFetch } from './httpClient.js';
import type { JiraSession } from './session.js';
import type { JiraFetchFn } from './issueService.js';
import type {
  JiraDashboardDetails,
  JiraDashboardGadget,
  JiraDashboardSummary,
} from '../types.js';

function mapSummary(el: any): JiraDashboardSummary {
  return {
    id: el?.id !== null && el?.id !== undefined ? String(el.id) : '',
    name: typeof el?.name === 'string' ? el.name : '',
    owner: typeof el?.owner?.displayName === 'string' ? el.owner.displayName : null,
    viewUrl: typeof el?.view === 'string' ? el.view : null,
    isFavourite: el?.isFavourite === true,
  };
}

/** Dashboard service (jira-rest-layer.md §2.11). */
export class JiraDashboardService {
  constructor(
    private readonly session: JiraSession,
    private readonly fetchFn: JiraFetchFn = jiraFetch,
  ) {}

  private get prefix(): string {
    return apiPrefix(this.session.profile?.instanceType ?? 'datacenter');
  }

  /** Page 50; loops until an empty batch or startAt >= total; breaks on any error. */
  async getDashboards(): Promise<JiraDashboardSummary[]> {
    if (!this.session.isConnected) return [];
    const out: JiraDashboardSummary[] = [];
    let startAt = 0;
    for (;;) {
      let resp: any;
      try {
        resp = await this.fetchFn(this.session, `${this.prefix}/dashboard`, {
          query: { startAt, maxResults: 50 },
        });
      } catch {
        break; // non-2xx stops pagination, keeps what we have
      }
      const batch: any[] = Array.isArray(resp?.dashboards) ? resp.dashboards : [];
      if (batch.length === 0) break;
      out.push(...batch.map(mapSummary));
      startAt += batch.length;
      const total = typeof resp?.total === 'number' ? resp.total : startAt;
      if (startAt >= total) break;
    }
    return out;
  }

  /** Details + gadgets; gadget failures are skipped (empty list). */
  async getDashboardDetails(id: string): Promise<JiraDashboardDetails> {
    const resp = await this.fetchFn(
      this.session,
      `${this.prefix}/dashboard/${encodeURIComponent(id)}`,
    );
    const summary = mapSummary(resp);

    let gadgets: JiraDashboardGadget[] = [];
    try {
      const gadgetResp = await this.fetchFn(
        this.session,
        `${this.prefix}/dashboard/${encodeURIComponent(id)}/gadget`,
      );
      const list: any[] = Array.isArray(gadgetResp?.gadgets) ? gadgetResp.gadgets : [];
      gadgets = list.map((el) => ({
        // Raw JSON text: numeric ids unquoted, string ids quoted (§10.7).
        id: el?.id === undefined ? '' : JSON.stringify(el.id),
        title: typeof el?.title === 'string' ? el.title : '',
        moduleKey: typeof el?.moduleKey === 'string' ? el.moduleKey : '',
        supported: false, // hardcoded false, per the WPF source
      }));
    } catch {
      // gadget endpoint unavailable → skipped
    }

    return { summary, gadgets };
  }
}
