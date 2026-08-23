// Dashboard watch — shared types. The differ and the service are platform
// free; the desktop server and the Android worker both drive them.

/** Every kind of change the watcher reports. */
export const WATCH_EVENT_KINDS = [
  'assigned',
  'unassigned',
  'status',
  'sprint',
  'priority',
  'dueDate',
  'comment',
] as const;

export type WatchEventKind = (typeof WATCH_EVENT_KINDS)[number];

/** Why an issue left the watched set, when the delta results can tell us. */
export type WatchLeaveReason = 'reassigned' | 'done' | 'left-sprint';

/** The fields of an issue the watcher compares between cycles. */
export interface IssueSnapshot {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  sprintName: string | null;
  priority: string;
  assignee: string | null;
  /** "YYYY-MM-DD" or null. */
  dueDate: string | null;
  commentCount: number;
  /** ISO timestamp of the issue's last update. */
  updated: string;
}

export interface WatchEvent {
  /** `${key}:${kind}:${at}` — stable across renders, unique within a cycle. */
  id: string;
  kind: WatchEventKind;
  key: string;
  summary: string;
  from: string | null;
  to: string | null;
  /** ISO timestamp of the cycle that produced the event. */
  at: string;
  reason?: WatchLeaveReason;
}

export interface WatchConfig {
  enabled: boolean;
  intervalMinutes: number;
  kinds: Record<WatchEventKind, boolean>;
}

export interface WatchState {
  snapshot: Record<string, IssueSnapshot>;
  /** ISO timestamp of the last completed cycle, or null before the first. */
  lastCycle: string | null;
  /** Newest first, capped at FEED_CAP. */
  feed: WatchEvent[];
  /** ISO timestamp the feed was last marked read. */
  ackedAt: string | null;
}

export const WATCH_INTERVALS: readonly number[] = [5, 10, 15, 30];

export const FEED_CAP = 200;

export const DEFAULT_WATCH_CONFIG: WatchConfig = {
  enabled: true,
  intervalMinutes: 5,
  kinds: {
    assigned: true,
    unassigned: true,
    status: true,
    sprint: true,
    priority: true,
    dueDate: true,
    comment: true,
  },
};

export const EMPTY_WATCH_STATE: WatchState = {
  snapshot: {},
  lastCycle: null,
  feed: [],
  ackedAt: null,
};
