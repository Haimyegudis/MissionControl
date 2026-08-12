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

    const timeLoggedTotal = async (period: TimeLoggedPeriod): Promise<number> => {
      try {
        return (await this.timeLogged.buildReport(period)).total;
      } catch {
        return 0;
      }
    };

    const [open, critical, blocked, updatedToday, recent, timeLoggedToday, timeLoggedThisWeek] =
      await Promise.all([
        this.issues.searchIssues(`${sprintScope} AND statusCategory != Done`, 0, 1),
        this.issues.searchIssues(
          `${sprintScope} AND issuetype in (Incident, Bug, Defect) AND priority in (Critical, Highest) AND statusCategory != Done`,
          0,
          1,
        ),
        this.issues.searchIssues(`${sprintScope} AND (status = Blocked OR labels = blocked)`, 0, 1),
        this.issues.searchIssues(`${sprintScope} AND updated >= startOfDay()`, 0, 1),
        this.issues.searchIssues(`${sprintScope} ORDER BY priority DESC, updated DESC`, 0, 50),
        timeLoggedTotal('today'),
        timeLoggedTotal('thisWeek'),
      ]);

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
