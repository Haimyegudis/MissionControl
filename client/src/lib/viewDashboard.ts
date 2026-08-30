// Dashboard view pure logic (ui-parity-contract.md §1) — KPI widget catalog +
// legacy-id migration, sprint JQL, star sort, drag→transition matching and the
// needs-dialog heuristics. Pure — unit tested.

import type { JiraIssue, JiraTransition } from '../types';

// ---------------------------------------------------------------------------
// KPI widgets
// ---------------------------------------------------------------------------

export interface KpiDef {
  id: string;
  title: string;
  color: string;
}

/** KPI widget catalog, canonical order (§1 table). */
export const KPI_DEFS: KpiDef[] = [
  { id: 'OpenIssues', title: 'My Open Issues', color: '#1FE0E0' },
  { id: 'Critical', title: 'My Critical', color: '#EF4444' },
  { id: 'OnHold', title: 'On Hold', color: '#FFA13A' },
  { id: 'UpdatedToday', title: 'Updated Today', color: '#FFD23A' },
  { id: 'LoggedToday', title: 'Logged Today', color: '#22D38F' },
  { id: 'LoggedThisWeek', title: 'Logged This Week', color: '#7A5CFF' },
];

/**
 * Resolve settings.dashboardWidgets into ordered KPI defs.
 * Legacy id "Blocked" migrates to "OnHold" on read; unknown ids are dropped;
 * duplicates keep their first position.
 */
export function resolveDashboardWidgets(ids: readonly string[] | null | undefined): KpiDef[] {
  const seen = new Set<string>();
  const out: KpiDef[] = [];
  for (const raw of ids ?? []) {
    const id = raw === 'Blocked' ? 'OnHold' : raw;
    if (seen.has(id)) continue;
    const def = KPI_DEFS.find((d) => d.id === id);
    if (!def) continue;
    seen.add(id);
    out.push(def);
  }
  return out;
}

/** `{h}h {mm}m` for the Logged Today / Logged This Week KPI values. */
export function formatHoursMinutes(seconds: number | null | undefined): string {
  const totalMinutes = Math.max(0, Math.floor((seconds ?? 0) / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** On Hold KPI = count of sprint issues whose status contains "hold" (ci). */
export function countOnHold(issues: readonly Pick<JiraIssue, 'status'>[]): number {
  return issues.filter((i) => (i.status ?? '').toLowerCase().includes('hold')).length;
}

/** Sprint issues whose status contains "hold" (ci) — On Hold drill-down rows. */
export function filterOnHold<T extends Pick<JiraIssue, 'status'>>(issues: readonly T[]): T[] {
  return issues.filter((i) => (i.status ?? '').toLowerCase().includes('hold'));
}

/**
 * Drill-down JQL for the issue-list KPI cards, mirroring the server snapshot
 * scopes (DashboardAggregator) so drill rows always match the card's count.
 * Null for KPIs that don't drill through a JQL search (OnHold = client filter
 * of the sprint issues; Logged* = time-logged report).
 */
export function kpiDrillJql(id: string, project: string): string | null {
  const scope = `project = ${project} AND assignee = currentUser() AND Sprint in openSprints()`;
  switch (id) {
    case 'OpenIssues':
      return `${scope} AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    case 'Critical':
      return (
        `${scope} AND issuetype in (Incident, Bug, Defect) AND priority in (Critical, Highest)` +
        ' AND statusCategory != Done ORDER BY priority DESC, updated DESC'
      );
    case 'UpdatedToday':
      return `${scope} AND updated >= startOfDay() ORDER BY updated DESC`;
    default:
      return null;
  }
}

/** Human explanation line shown under the drill-down dialog title. */
export function kpiDrillSubtitle(id: string): string {
  switch (id) {
    case 'OpenIssues':
      return 'Your active-sprint issues that are not Done.';
    case 'Critical':
      return 'Your critical/highest incidents, bugs and defects still open in the sprint.';
    case 'OnHold':
      return 'Your sprint issues currently in an On Hold status.';
    case 'UpdatedToday':
      return 'Your sprint issues updated since midnight — sorted by most recent update.';
    case 'LoggedToday':
      return 'Work you logged today, broken down per issue.';
    case 'LoggedThisWeek':
      return 'Work you logged this week, per issue and per day.';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Sprint data
// ---------------------------------------------------------------------------

/** Current sprint scoped to me or the picked user, including completed issues. */
export function dashboardSprintJql(project: string, userFilter: string): string {
  const user = userFilter.trim();
  const who = user ? `assignee = "${user}"` : 'assignee = currentUser()';
  return (
    `project = ${project} AND sprint in openSprints() AND ${who}` +
    ' ORDER BY priority DESC, updated DESC'
  );
}

export interface ActiveSprint {
  name: string;
  endDate: string | null;
  /** Whole days from now to endDate, floored at 0. Null when open-ended. */
  daysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The sprint the loaded issues belong to. Derived from the issues rather than
 * a hardcoded board so it stays correct for whatever board the user works on;
 * the caller falls back to the board API when this returns null.
 */
export function resolveActiveSprint(
  issues: readonly Pick<JiraIssue, 'sprint' | 'allSprints'>[],
  now: Date = new Date(),
): ActiveSprint | null {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const name = issue.sprint?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let name = '';
  let best = -1;
  for (const [candidate, count] of counts) {
    if (count > best) {
      best = count;
      name = candidate;
    }
  }

  const info = issues
    .flatMap((issue) => issue.allSprints ?? [])
    .find((sprint) => sprint.name === name && sprint.state.toLowerCase() === 'active');
  const parsed = info?.endDate ? Date.parse(info.endDate) : Number.NaN;
  if (Number.isNaN(parsed)) return { name, endDate: null, daysLeft: null };

  return {
    name,
    endDate: info?.endDate ?? null,
    daysLeft: Math.max(0, Math.ceil((parsed - now.getTime()) / DAY_MS)),
  };
}

/** Issues belonging to the resolved active sprint (by sprint name). */
export function sprintIssuesOf<T extends Pick<JiraIssue, 'sprint'>>(
  issues: readonly T[],
  sprint: ActiveSprint | null,
): T[] {
  if (!sprint) return [];
  return issues.filter((issue) => issue.sprint?.trim() === sprint.name);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Sprint name plus countdown, with no card title — the phone shows this bare. */
export function formatSprintLine(sprint: ActiveSprint | null): string | null {
  if (!sprint) return null;
  if (sprint.daysLeft === null || sprint.endDate === null) return sprint.name;
  if (sprint.daysLeft === 0) return `${sprint.name} · ends today`;
  const end = new Date(sprint.endDate);
  const ends = `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
  return `${sprint.name} · ${sprint.daysLeft} day${sprint.daysLeft === 1 ? '' : 's'} left (ends ${ends})`;
}

/** Card title line: name, countdown and end date when they are known. */
export function formatSprintHeader(sprint: ActiveSprint | null): string {
  const line = formatSprintLine(sprint);
  return line === null ? 'My Current Sprint' : `My Current Sprint — ${line}`;
}

/** Sort: IsStarred DESC, then OriginalOrder (stable float-to-top). */
export function sortSprintIssues<T extends Pick<JiraIssue, 'isStarred' | 'originalOrder'>>(issues: readonly T[]): T[] {
  return [...issues].sort(
    (a, b) => Number(b.isStarred) - Number(a.isStarred) || a.originalOrder - b.originalOrder,
  );
}

/**
 * Stamp load-order on freshly fetched issues (server serves originalOrder 0).
 * Mutates in place and returns the same array.
 */
export function stampOriginalOrder<T extends { originalOrder: number }>(issues: T[]): T[] {
  issues.forEach((issue, index) => {
    issue.originalOrder = index;
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Drag → transition flow (§1 Actions)
// ---------------------------------------------------------------------------

/**
 * Transition match order for a card dropped on `columnTitle`:
 * 1. ToStatus == title, 2. ToStatus contains title, 3. Name contains title.
 * All comparisons case-insensitive. Null when nothing matches.
 */
export function pickTransition(
  transitions: readonly JiraTransition[],
  columnTitle: string,
): JiraTransition | null {
  const title = columnTitle.toLowerCase();
  return (
    transitions.find((t) => (t.toStatus ?? '').toLowerCase() === title) ??
    transitions.find((t) => (t.toStatus ?? '').toLowerCase().includes(title)) ??
    transitions.find((t) => (t.name ?? '').toLowerCase().includes(title)) ??
    null
  );
}

const CLOSE_TITLE_HINTS = ['done', 'closed', 'resolved', 'reopen'];
const CLOSE_NAME_HINTS = ['close', 'resolve', 'reopen', 'reassign', 'fix'];

/**
 * NeedsCloseDialog heuristic (§1): the target column title contains
 * done/closed/resolved/reopen, or the transition name contains
 * close/resolve/reopen/reassign/fix.
 */
export function needsCloseDialog(columnTitle: string, transitionName: string): boolean {
  const title = (columnTitle ?? '').toLowerCase();
  const name = (transitionName ?? '').toLowerCase();
  return (
    CLOSE_TITLE_HINTS.some((h) => title.includes(h)) ||
    CLOSE_NAME_HINTS.some((h) => name.includes(h))
  );
}
