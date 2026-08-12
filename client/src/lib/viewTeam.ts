// Team Dashboard pure logic (ui-parity §9) — fuzzy member matching, status
// counters, hour sums, and a small async concurrency gate for the member
// detail worklog fetch. Ported verbatim from WPF TeamDashboardViewModel.

import type { JiraIssue } from '../types';

/**
 * Loose-match normalization: local part before `@`, strip non-alphanumerics,
 * lowercase. "Adir Takiar" ≡ "adir.takiar" ≡ "adir.takiar@hp.com" → "adirtakiar".
 */
export function normalizeMember(s: string | null | undefined): string {
  if (!s) return '';
  const local = s.includes('@') ? s.split('@')[0] : s;
  let out = '';
  for (const c of local) {
    if (/[\p{L}\p{N}]/u.test(c)) out += c.toLowerCase();
  }
  return out;
}

/** True when a worklog author / assignee resolves to the same person. */
export function matchesMember(author: string | null | undefined, member: string): boolean {
  if (!author) return false;
  const a = normalizeMember(author);
  return a.length > 0 && a === normalizeMember(member);
}

export interface TeamMemberRow {
  member: string;
  issues: JiraIssue[];
  openCount: number;
  doneCount: number;
  onHold: number;
  inProgress: number;
  inReview: number;
  estimatedHours: number;
  remainingHours: number;
  loggedHours: number;
}

function hours(seconds: number | null): number {
  return (seconds ?? 0) / 3600;
}

/**
 * Group sprint issues by canonical team member (fuzzy assignee match), compute
 * the §9 counters and hour sums, and sort OpenCount DESC. Every member gets a
 * row even with zero issues.
 */
export function computeTeamRows(members: string[], issues: JiraIssue[]): TeamMemberRow[] {
  const memberByNorm = new Map<string, string>();
  for (const m of members) {
    const k = normalizeMember(m);
    if (k) memberByNorm.set(k, m);
  }

  const byMember = new Map<string, JiraIssue[]>();
  for (const issue of issues) {
    const canonical = memberByNorm.get(normalizeMember(issue.assignee ?? ''));
    if (!canonical) continue;
    const list = byMember.get(canonical);
    if (list) list.push(issue);
    else byMember.set(canonical, [issue]);
  }

  const rows: TeamMemberRow[] = members.map((member) => {
    const items = byMember.get(member) ?? [];
    const has = (i: JiraIssue, sub: string) => i.status.toLowerCase().includes(sub);
    const isDone = (i: JiraIssue) => has(i, 'done') || has(i, 'closed');
    return {
      member,
      issues: items,
      openCount: items.filter((i) => !isDone(i)).length,
      doneCount: items.filter(isDone).length,
      onHold: items.filter((i) => has(i, 'hold')).length,
      inProgress: items.filter((i) => has(i, 'in progress')).length,
      inReview: items.filter((i) => has(i, 'review')).length,
      estimatedHours: items.reduce((s, i) => s + hours(i.originalEstimate), 0),
      remainingHours: items.reduce((s, i) => s + hours(i.remainingEstimate), 0),
      loggedHours: items.reduce((s, i) => s + hours(i.timeSpent), 0),
    };
  });

  // Stable sort — ties keep team-member order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.openCount - a.r.openCount || a.i - b.i)
    .map((x) => x.r);
}

/** Workload chart "Other" segment: `max(0, Open − IP − IR − OH)` (§9). */
export function otherCount(row: TeamMemberRow): number {
  return Math.max(0, row.openCount - row.inProgress - row.inReview - row.onHold);
}

/**
 * Map with a concurrency gate (member-detail worklog fetch, §9.2 gate 8).
 * Preserves input order in the result; individual failures surface as the
 * worker's own catch (the worker should not throw).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}
