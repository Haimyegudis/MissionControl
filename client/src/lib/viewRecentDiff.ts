// Recent Updates change detection (ui-parity §6) — pure port of the WPF
// RecentUpdatesViewModel snapshot/diff logic. The caller owns the snapshot
// map (in-memory, survives reloads within the session).

import type { JiraIssue } from '../types';
import { fmtHours } from './viewFormat';

/** Snapshot of a JiraIssue's mutable fields from the previous poll. */
export interface IssueSnapshot {
  updated: string;
  status: string;
  assignee: string | null;
  priority: string;
  /** Seconds. */
  timeSpent: number | null;
}

export function snapshotOf(issue: JiraIssue): IssueSnapshot {
  return {
    updated: issue.updated,
    status: issue.status,
    assignee: issue.assignee,
    priority: issue.priority,
    timeSpent: issue.timeSpent,
  };
}

export interface ChangeResult {
  /** Joined `"; "` diff string, `"First seen"` for new keys, null when nothing changed. */
  changeSummary: string | null;
  /** True when Updated differs from the previous poll. */
  recentlyChanged: boolean;
}

/**
 * Diff one issue against its previous snapshot. Verbatim strings:
 * `Status: A → B` · `Assignee: A → B` (null → `—`) · `Priority: A → B` ·
 * `Worklog +{delta:0.##}h` · `Other field updated` · `First seen`.
 */
export function diffChange(prev: IssueSnapshot | undefined, cur: IssueSnapshot): ChangeResult {
  if (!prev) {
    return { changeSummary: 'First seen', recentlyChanged: false };
  }
  const recentlyChanged = prev.updated !== cur.updated;
  const diffs: string[] = [];
  if (prev.status !== cur.status) diffs.push(`Status: ${prev.status} → ${cur.status}`);
  if ((prev.assignee ?? '') !== (cur.assignee ?? '')) {
    diffs.push(`Assignee: ${prev.assignee ?? '—'} → ${cur.assignee ?? '—'}`);
  }
  if (prev.priority !== cur.priority) diffs.push(`Priority: ${prev.priority} → ${cur.priority}`);
  if ((prev.timeSpent ?? null) !== (cur.timeSpent ?? null)) {
    const deltaSeconds = (cur.timeSpent ?? 0) - (prev.timeSpent ?? 0);
    if (deltaSeconds !== 0) diffs.push(`Worklog +${fmtHours(deltaSeconds / 3600)}h`);
  }
  if (diffs.length === 0 && prev.updated !== cur.updated) diffs.push('Other field updated');
  return { changeSummary: diffs.length > 0 ? diffs.join('; ') : null, recentlyChanged };
}

/**
 * Run change detection over a freshly loaded feed: stamps `changeSummary` and
 * `recentlyChanged` on each issue and advances the snapshot map.
 */
export function applyChangeDetection(lastSeen: Map<string, IssueSnapshot>, issues: JiraIssue[]): JiraIssue[] {
  for (const issue of issues) {
    const cur = snapshotOf(issue);
    const result = diffChange(lastSeen.get(issue.key), cur);
    issue.changeSummary = result.changeSummary;
    if (result.recentlyChanged) issue.recentlyChanged = true;
    lastSeen.set(issue.key, cur);
  }
  return issues;
}

/**
 * Recent Updates JQL (§6, verbatim — NOT project-scoped, maxResults 50).
 * Empty user → "issues I've touched"; picked user → their assigned/reported.
 */
export function recentUpdatesJql(userFilter: string): string {
  let scope: string;
  if (!userFilter.trim()) {
    scope = '(assignee = currentUser() OR reporter = currentUser() OR worklogAuthor = currentUser())';
  } else {
    const quoted = `"${userFilter.replace(/"/g, '\\"')}"`;
    scope = `(assignee = ${quoted} OR reporter = ${quoted})`;
  }
  return `updated >= -7d AND ${scope} ORDER BY updated DESC`;
}
