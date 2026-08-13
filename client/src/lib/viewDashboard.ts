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
