// Snapshot differ — pure. Two maps of IssueSnapshot in, sorted events out.
//
// This is a state diff, not a changelog replay: an issue that moved To Do →
// In Progress → Done between cycles yields one status event reading
// To Do → Done, and several new comments yield one comment event carrying the
// count. That is the documented trade-off of polling and it keeps a cycle to
// two Jira queries.

import type {
  IssueSnapshot,
  WatchConfig,
  WatchEvent,
  WatchEventKind,
  WatchLeaveReason,
} from './types.js';

export { DEFAULT_WATCH_CONFIG, WATCH_EVENT_KINDS, WATCH_INTERVALS } from './types.js';
export { sanitizeWatchConfig } from './config.js';
export type { IssueSnapshot, WatchConfig, WatchEvent, WatchEventKind } from './types.js';

export interface DiffArgs {
  /** Null on the very first cycle — the baseline rule then suppresses output. */
  prev: Record<string, IssueSnapshot> | null;
  /** The current watched set (membership query). */
  next: Record<string, IssueSnapshot>;
  /** Recently updated issues, watched or not (delta query). */
  delta: Record<string, IssueSnapshot>;
  config: WatchConfig;
  /** ISO timestamp stamped on every event. */
  at: string;
}

/** Field comparisons that produce a single event each. */
const FIELD_EVENTS: ReadonlyArray<{
  kind: WatchEventKind;
  read: (s: IssueSnapshot) => string | null;
}> = [
  { kind: 'status', read: (s) => s.status },
  { kind: 'sprint', read: (s) => s.sprintName },
  { kind: 'priority', read: (s) => s.priority },
  { kind: 'dueDate', read: (s) => s.dueDate },
];

/**
 * Why an issue left the watched set, read from the delta copy. Order matters:
 * a reassigned issue is no longer ours whatever its status says.
 */
function leaveReason(
  before: IssueSnapshot,
  after: IssueSnapshot | undefined,
): WatchLeaveReason | undefined {
  if (!after) return undefined;
  if (after.assignee !== before.assignee) return 'reassigned';
  if (after.statusCategory === 'done') return 'done';
  if (after.sprintName !== before.sprintName) return 'left-sprint';
  return undefined;
}

export function diffSnapshots({ prev, next, delta, config, at }: DiffArgs): WatchEvent[] {
  if (prev === null) return []; // baseline: record state, say nothing

  const events: WatchEvent[] = [];
  const push = (
    kind: WatchEventKind,
    snapshot: IssueSnapshot,
    from: string | null,
    to: string | null,
    reason?: WatchLeaveReason,
  ): void => {
    if (!config.kinds[kind]) return;
    events.push({
      id: `${snapshot.key}:${kind}:${at}`,
      kind,
      key: snapshot.key,
      summary: snapshot.summary,
      from,
      to,
      at,
      ...(reason ? { reason } : {}),
    });
  };

  for (const [key, after] of Object.entries(next)) {
    const before = prev[key];
    if (!before) {
      push('assigned', after, null, after.status);
      continue;
    }
    for (const field of FIELD_EVENTS) {
      const from = field.read(before);
      const to = field.read(after);
      if (from !== to) push(field.kind, after, from, to);
    }
    if (after.commentCount > before.commentCount) {
      push('comment', after, String(before.commentCount), String(after.commentCount));
    }
  }

  for (const [key, before] of Object.entries(prev)) {
    if (next[key]) continue;
    push('unassigned', before, before.status, null, leaveReason(before, delta[key]));
  }

  return events.sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
}
