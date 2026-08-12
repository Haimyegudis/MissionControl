import { apiPrefix, jiraFetch, JiraError } from './httpClient.js';
import type { JiraSession } from './session.js';
import { adfParagraph, mapWorklog } from './mapper.js';
import type { JiraFetchFn } from './issueService.js';
import type { JiraWorklog } from '../types.js';

export type AdjustEstimate = 'auto' | 'leave' | 'new' | 'manual';

/**
 * Format a worklog `started` value per §2.8:
 * `yyyy-MM-ddTHH:mm:ss.fffzzz` with the offset colon stripped, in local time —
 * e.g. `2026-05-04T08:23:45.123+0300`.
 */
export function formatWorklogStarted(started: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const offsetMinutes = -started.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}` +
    `T${pad(started.getHours())}:${pad(started.getMinutes())}:${pad(started.getSeconds())}` +
    `.${pad(started.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

/** Worklog service (jira-rest-layer.md §2.8). */
export class JiraWorklogService {
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

  async getWorklogs(issueKey: string): Promise<JiraWorklog[]> {
    if (!this.session.isConnected) return [];
    const resp = await this.fetchFn(
      this.session,
      `${this.prefix}/issue/${encodeURIComponent(issueKey)}/worklog`,
    );
    const list: any[] = Array.isArray(resp?.worklogs) ? resp.worklogs : [];
    return list.map((el) => mapWorklog(issueKey, el));
  }

  /**
   * POST a worklog. Throws when the rounded duration is under 60 seconds.
   * adjustEstimate: auto → no query; leave → `adjustEstimate=leave`;
   * new → `adjustEstimate=new&newEstimate=`; manual → `adjustEstimate=manual&reduceBy=`
   * (both throw when adjustValue is missing).
   * 401/403 → "You do not have permission to log work on this issue."
   */
  async addWorklog(
    issueKey: string,
    totalSeconds: number,
    startedIso: string,
    comment?: string | null,
    adjust: AdjustEstimate = 'auto',
    adjustValue?: string | null,
  ): Promise<JiraWorklog> {
    const timeSpentSeconds = Math.round(totalSeconds);
    if (timeSpentSeconds < 60) {
      throw new Error('Worklog duration must be at least 60 seconds.');
    }

    const query: Record<string, string> = {};
    if (adjust === 'leave') {
      query.adjustEstimate = 'leave';
    } else if (adjust === 'new') {
      if (!adjustValue || adjustValue.trim().length === 0) {
        throw new Error('adjustEstimate=new requires a new estimate value.');
      }
      query.adjustEstimate = 'new';
      query.newEstimate = adjustValue;
    } else if (adjust === 'manual') {
      if (!adjustValue || adjustValue.trim().length === 0) {
        throw new Error('adjustEstimate=manual requires a reduceBy value.');
      }
      query.adjustEstimate = 'manual';
      query.reduceBy = adjustValue;
    }

    const hasComment = typeof comment === 'string' && comment.trim().length > 0;
    const body = {
      timeSpentSeconds,
      comment: hasComment ? (this.isCloud ? adfParagraph(comment!) : comment) : null,
      started: formatWorklogStarted(new Date(startedIso)),
    };

    let resp: any;
    try {
      resp = await this.fetchFn(
        this.session,
        `${this.prefix}/issue/${encodeURIComponent(issueKey)}/worklog`,
        { method: 'POST', body, query },
      );
    } catch (err) {
      if (err instanceof JiraError && (err.status === 401 || err.status === 403)) {
        throw new Error('You do not have permission to log work on this issue.');
      }
      throw err;
    }
    return mapWorklog(issueKey, resp);
  }
}
