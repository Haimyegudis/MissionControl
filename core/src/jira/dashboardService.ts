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

  /** Hard cap — HP's instance has thousands of dashboards; the serial 50-per
   *  -page walk took minutes and read as "loading forever". */
  private static readonly DASHBOARD_CAP = 600;

  /** Favourites first, then the first pages of everything (parallel, capped). */
  async getDashboards(): Promise<JiraDashboardSummary[]> {
    if (!this.session.isConnected) return [];

    const fetchPage = async (startAt: number, filter?: string): Promise<{ items: JiraDashboardSummary[]; total: number }> => {
      try {
        const resp: any = await this.fetchFn(this.session, `${this.prefix}/dashboard`, {
          query: { startAt, maxResults: 50, ...(filter ? { filter } : {}) },
        });
        const batch: any[] = Array.isArray(resp?.dashboards) ? resp.dashboards : [];
        return { items: batch.map(mapSummary), total: typeof resp?.total === 'number' ? resp.total : batch.length };
      } catch {
        return { items: [], total: 0 };
      }
    };

    // Favourites (small, most relevant) + page 1 of all, in parallel.
    const [fav, first] = await Promise.all([fetchPage(0, 'favourite'), fetchPage(0)]);
    const cap = JiraDashboardService.DASHBOARD_CAP;
    const target = Math.min(first.total, cap);
    const starts: number[] = [];
    for (let s = 50; s < target; s += 50) starts.push(s);
    const rest = await Promise.all(starts.map((s) => fetchPage(s)));

    const seen = new Set<string>();
    const out: JiraDashboardSummary[] = [];
    for (const d of [...fav.items, ...first.items, ...rest.flatMap((r) => r.items)]) {
      if (d.id && !seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
      }
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
