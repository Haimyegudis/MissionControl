// Dashboard KPI aggregator (jira-rest-layer.md §8 — DashboardAggregator).

import type { JiraSession } from './session.js';
import type { TimeLoggedPeriod } from './timeLogged.js';
import type { DashboardSnapshot, JiraIssue, PagedResult, TimeLoggedReport } from '../types.js';

/** Minimal issue-search dependency (JiraIssueService satisfies it). */
export interface SnapshotIssueSearcher {
  searchIssues(jql: string, startAt?: number, maxResults?: number): Promise<PagedResult<JiraIssue>>;
}

/** Minimal time-logged dependency (TimeLoggedService satisfies it). */
export interface SnapshotTimeLogged {
  buildReport(period: TimeLoggedPeriod): Promise<TimeLoggedReport>;
}

export class DashboardAggregator {
  constructor(
    private readonly session: JiraSession,
    private readonly issues: SnapshotIssueSearcher,
    private readonly timeLogged: SnapshotTimeLogged,
  ) {}

  /**
   * Five parallel searches (each startAt=0) + two time-logged totals (§8).
   * KPI counts read `total`; RecentlyUpdated reads `items` (maxResults 50).
   * Time-logged calls are try/caught → 0. Empty snapshot when disconnected.
   */
  async buildDashboardSnapshot(): Promise<DashboardSnapshot> {
    const loadedAtUtc = new Date().toISOString();
    if (!this.session.isConnected) {
      return {
        openIssues: 0,
        criticalIncidents: 0,
        blocked: 0,
        updatedToday: 0,
        timeLoggedToday: 0,
        timeLoggedThisWeek: 0,
        recentlyUpdated: [],
        loadedAtUtc,
      };
    }

    const project = this.session.profile?.defaultProjectKey?.trim() || 'ISW';
    const sprintScope = `project = ${project} AND assignee = currentUser() AND Sprint in openSprints()`;

    // ONE worklog fan-out: the this-week report covers today, so today's
    // total falls out of its per-day rows. The old today+thisWeek pair
    // fetched every issue's worklogs twice.
    const timeLoggedTotals = async (): Promise<{ today: number; week: number }> => {
      try {
        const report = await this.timeLogged.buildReport('thisWeek');
        const pad = (n: number) => String(n).padStart(2, '0');
        const now = new Date();
        const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const today = report.dailyByIssue
          .filter((e) => e.day === todayYmd)
          .reduce((sum, e) => sum + e.timeSpent, 0);
        return { today, week: report.total };
      } catch {
        return { today: 0, week: 0 };
      }
    };

    const [open, critical, blocked, updatedToday, recent, logged] = await Promise.all([
      this.issues.searchIssues(`${sprintScope} AND statusCategory != Done`, 0, 1),
      this.issues.searchIssues(
        `${sprintScope} AND issuetype in (Incident, Bug, Defect) AND priority in (Critical, Highest) AND statusCategory != Done`,
        0,
        1,
      ),
      this.issues.searchIssues(`${sprintScope} AND (status = Blocked OR labels = blocked)`, 0, 1),
      this.issues.searchIssues(`${sprintScope} AND updated >= startOfDay()`, 0, 1),
      this.issues.searchIssues(`${sprintScope} ORDER BY priority DESC, updated DESC`, 0, 50),
      timeLoggedTotals(),
    ]);
    const timeLoggedToday = logged.today;
    const timeLoggedThisWeek = logged.week;

    return {
      openIssues: open.total,
      criticalIncidents: critical.total,
      blocked: blocked.total,
      updatedToday: updatedToday.total,
      timeLoggedToday,
      timeLoggedThisWeek,
      recentlyUpdated: recent.items,
      loadedAtUtc,
    };
  }
}
