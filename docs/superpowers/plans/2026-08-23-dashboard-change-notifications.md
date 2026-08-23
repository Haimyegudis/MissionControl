# Dashboard Change Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the user — Windows toast, Android notification, in-app feed — whenever anything changes in the work shown on the Dashboard tab, and show the active sprint name in the "My Current Sprint" card.

**Architecture:** A pure snapshot differ in `@mc/core` compares the last stored state of the user's sprint issues against two fresh Jira queries and emits typed events. The desktop server drives it on a timer and raises WinRT toasts through the same PowerShell mechanism `server/src/reminders.ts` already uses; the Android build drives the same code from a WorkManager worker hosting an offscreen WebView. State and config live in the `lists` KV table, which both platforms already have.

**Tech Stack:** TypeScript, vitest, Express, React (no framework beyond it), Capacitor 8, Android WorkManager.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-dashboard-change-notifications-design.md`.
- **Deviation from spec, deliberate:** state is stored in the `lists` KV table (key `watch.state`) rather than a new `watch-state.json`. `lists` maps to `KvLists` in desktop SQLite (`server/src/storage/sqliteKv.ts:26`) and to the encrypted store on Android, so one repo serves both platforms and `EncryptedStorePlugin`'s table whitelist needs no change.
- Default poll interval 5 minutes. Allowed intervals: 5, 10, 15, 30.
- All seven event kinds default to enabled.
- Baseline rule: a cycle with no prior snapshot stores state and emits zero events.
- Delta query window = `intervalMinutes * 2`.
- `BASE_FIELDS` in `core/src/jira/issueService.ts` must not be modified — the watcher uses its own field list.
- Every core module is `.js`-suffixed in imports (NodeNext resolution).
- Tests: `npm run test --workspace core`, `--workspace server`, `--workspace client` (vitest).
- Commit after each task.

## File Structure

| File | Responsibility |
|---|---|
| `core/src/watch/types.ts` | `IssueSnapshot`, `WatchEvent`, `WatchEventKind`, `WatchConfig`, `WatchState`, `DEFAULT_WATCH_CONFIG` |
| `core/src/watch/differ.ts` | Pure `diffSnapshots(prev, next, config, at, delta)` |
| `core/src/watch/config.ts` | `sanitizeWatchConfig` |
| `core/src/watch/state.ts` | `KvWatchRepo` — state + config over the `lists` KV table |
| `core/src/watch/service.ts` | `WatchService` — builds the two queries, maps snapshots, runs a cycle |
| `core/src/dispatch.ts` | `case 'watch'` route group for the Android in-process API |
| `core/src/composition.ts` | `watch` member on `Core` |
| `server/src/watch.ts` | Desktop timer + toast script generation |
| `server/src/routes/watch.ts` | `/api/watch/{feed,ack,config,run}` |
| `client/src/api/client.ts` | `watch` API namespace |
| `client/src/stores/watch.ts` | Feed store, unread count, polling on scheduler ticks |
| `client/src/components/WatchBell.tsx` | Bell button + dropdown feed |
| `client/src/views/settings/NotificationsSection.tsx` | Desktop settings UI |
| `client/src/lib/viewDashboard.ts` | `resolveActiveSprint`, `formatSprintHeader` |
| `client/src/native/watchEntry.ts` | Android headless watch entry point |
| `android/.../WatchBridgePlugin.java` | Bridge from the headless WebView back to the worker |
| `android/.../WatchWorker.java` | Periodic worker: WebView + notification |

---

### Task 1: Core watch types, config sanitizer and differ

**Files:**
- Create: `core/src/watch/types.ts`, `core/src/watch/config.ts`, `core/src/watch/differ.ts`
- Test: `core/test/watchDiffer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IssueSnapshot`, `WatchEvent`, `WatchEventKind`, `WatchConfig`, `WatchState`, `DEFAULT_WATCH_CONFIG`, `WATCH_INTERVALS`, `sanitizeWatchConfig(raw: unknown): WatchConfig`, `diffSnapshots(args): WatchEvent[]`.

- [ ] **Step 1: Write the failing test** — `core/test/watchDiffer.test.ts`

```ts
// Watch differ tests — one case per event kind, the baseline rule, per-kind
// filtering and unassigned-reason derivation.

import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCH_CONFIG, diffSnapshots, sanitizeWatchConfig } from '../src/watch/differ.js';
import type { IssueSnapshot } from '../src/watch/types.js';

const AT = '2026-08-23T10:00:00.000Z';

function snap(over: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    key: 'ISW-1',
    summary: 'Fix the thing',
    status: 'To Do',
    statusCategory: 'new',
    sprintName: 'ISW Sprint 128',
    priority: 'Major',
    assignee: 'Haim',
    dueDate: null,
    commentCount: 0,
    updated: '2026-08-23T09:00:00.000Z',
    ...over,
  };
}

function mapOf(...items: IssueSnapshot[]): Record<string, IssueSnapshot> {
  return Object.fromEntries(items.map((i) => [i.key, i]));
}

function run(
  prev: Record<string, IssueSnapshot> | null,
  next: Record<string, IssueSnapshot>,
  delta: Record<string, IssueSnapshot> = {},
  config = DEFAULT_WATCH_CONFIG,
) {
  return diffSnapshots({ prev, next, delta, config, at: AT });
}

describe('diffSnapshots', () => {
  it('emits nothing when there is no prior snapshot', () => {
    expect(run(null, mapOf(snap(), snap({ key: 'ISW-2' })))).toEqual([]);
  });

  it('emits assigned for an issue that was not there before', () => {
    const events = run(mapOf(snap()), mapOf(snap(), snap({ key: 'ISW-2', summary: 'New work' })));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'assigned', key: 'ISW-2', summary: 'New work', to: 'To Do' });
  });

  it('emits unassigned with a reason read from the delta results', () => {
    const gone = snap({ assignee: 'Dana' });
    const events = run(mapOf(snap()), {}, mapOf(gone));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'unassigned', key: 'ISW-1', reason: 'reassigned' });
  });

  it('reports done and left-sprint reasons distinctly', () => {
    const done = run(mapOf(snap()), {}, mapOf(snap({ statusCategory: 'done', status: 'Closed' })));
    expect(done[0]).toMatchObject({ kind: 'unassigned', reason: 'done' });

    const left = run(mapOf(snap()), {}, mapOf(snap({ sprintName: null })));
    expect(left[0]).toMatchObject({ kind: 'unassigned', reason: 'left-sprint' });
  });

  it('omits the reason when the issue is not in the delta results', () => {
    const events = run(mapOf(snap()), {});
    expect(events[0].kind).toBe('unassigned');
    expect(events[0].reason).toBeUndefined();
  });

  it('emits one event per changed field on the same issue', () => {
    const events = run(
      mapOf(snap()),
      mapOf(snap({ status: 'In Progress', priority: 'Critical', dueDate: '2026-08-30', commentCount: 2 })),
    );
    expect(events.map((e) => e.kind).sort()).toEqual(['comment', 'dueDate', 'priority', 'status']);
    expect(events.find((e) => e.kind === 'status')).toMatchObject({ from: 'To Do', to: 'In Progress' });
    expect(events.find((e) => e.kind === 'dueDate')).toMatchObject({ from: null, to: '2026-08-30' });
    expect(events.find((e) => e.kind === 'comment')).toMatchObject({ to: '2' });
  });

  it('emits sprint when the active sprint name changes', () => {
    const events = run(mapOf(snap()), mapOf(snap({ sprintName: 'ISW Sprint 129' })));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'sprint', from: 'ISW Sprint 128', to: 'ISW Sprint 129' });
  });

  it('ignores a comment count that went down', () => {
    expect(run(mapOf(snap({ commentCount: 3 })), mapOf(snap({ commentCount: 1 })))).toEqual([]);
  });

  it('drops kinds disabled in the config', () => {
    const config = { ...DEFAULT_WATCH_CONFIG, kinds: { ...DEFAULT_WATCH_CONFIG.kinds, status: false } };
    const events = run(mapOf(snap()), mapOf(snap({ status: 'In Progress', priority: 'Critical' })), {}, config);
    expect(events.map((e) => e.kind)).toEqual(['priority']);
  });

  it('gives every event a stable, unique id', () => {
    const events = run(mapOf(snap()), mapOf(snap({ status: 'In Progress', priority: 'Critical' })));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events[0].id).toContain('ISW-1');
  });
});

describe('sanitizeWatchConfig', () => {
  it('falls back to the defaults for junk', () => {
    expect(sanitizeWatchConfig(null)).toEqual(DEFAULT_WATCH_CONFIG);
    expect(sanitizeWatchConfig({ intervalMinutes: 7 }).intervalMinutes).toBe(5);
  });

  it('keeps allowed intervals and known kinds only', () => {
    const config = sanitizeWatchConfig({
      enabled: false,
      intervalMinutes: 30,
      kinds: { status: false, bogus: true },
    });
    expect(config.enabled).toBe(false);
    expect(config.intervalMinutes).toBe(30);
    expect(config.kinds.status).toBe(false);
    expect(config.kinds.comment).toBe(true);
    expect('bogus' in config.kinds).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test --workspace core -- watchDiffer`
Expected: FAIL — cannot resolve `../src/watch/differ.js`.

- [ ] **Step 3: Write `core/src/watch/types.ts`**

```ts
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
```

- [ ] **Step 4: Write `core/src/watch/config.ts`**

```ts
// WatchConfig sanitization — unknown kinds dropped, interval clamped to the
// allowed set, in the style of server/src/reminders.ts sanitize().

import {
  DEFAULT_WATCH_CONFIG,
  WATCH_EVENT_KINDS,
  WATCH_INTERVALS,
  type WatchConfig,
  type WatchEventKind,
} from './types.js';

export function sanitizeWatchConfig(raw: unknown): WatchConfig {
  const src = (raw ?? {}) as Partial<WatchConfig>;
  const rawKinds = (src.kinds ?? {}) as Record<string, unknown>;
  const kinds = {} as Record<WatchEventKind, boolean>;
  for (const kind of WATCH_EVENT_KINDS) {
    kinds[kind] = rawKinds[kind] === undefined ? DEFAULT_WATCH_CONFIG.kinds[kind] : rawKinds[kind] === true;
  }
  const interval = Number(src.intervalMinutes);
  return {
    enabled: src.enabled === undefined ? DEFAULT_WATCH_CONFIG.enabled : src.enabled === true,
    intervalMinutes: WATCH_INTERVALS.includes(interval) ? interval : DEFAULT_WATCH_CONFIG.intervalMinutes,
    kinds,
  };
}
```

- [ ] **Step 5: Write `core/src/watch/differ.ts`**

```ts
// Snapshot differ — pure. Two maps of IssueSnapshot in, sorted events out.
//
// This is a state diff, not a changelog replay: an issue that moved To Do →
// In Progress → Done between cycles yields one status event reading
// To Do → Done, and several new comments yield one comment event carrying the
// count. That is the documented trade-off of polling (spec §"Catch-up on
// start") and it keeps a cycle to two Jira queries.

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
function leaveReason(before: IssueSnapshot, after: IssueSnapshot | undefined): WatchLeaveReason | undefined {
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
```

- [ ] **Step 6: Run the tests**

Run: `npm run test --workspace core -- watchDiffer`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add core/src/watch core/test/watchDiffer.test.ts
git commit -m "feat(watch): snapshot differ and config sanitizer for dashboard change events"
```

---

### Task 2: WatchService — queries, snapshot mapping, cycle

**Files:**
- Create: `core/src/watch/state.ts`, `core/src/watch/service.ts`
- Modify: `core/src/index.ts` (export the watch surface), `core/src/composition.ts` (add `watch` to `Core`)
- Test: `core/test/watchService.test.ts`

**Interfaces:**
- Consumes: `diffSnapshots`, `sanitizeWatchConfig`, `WatchState`, `EMPTY_WATCH_STATE`, `FEED_CAP` (Task 1); `JiraSession`, `jiraFetch`, `apiPrefix` (`core/src/jira/httpClient.ts`); `sprintFieldId()` (`core/src/jira/mapper.ts:47`); `KvStore` (`core/src/storage/kv.js`).
- Produces:
  - `class KvWatchRepo { getState(): WatchState; setState(s: WatchState): void; getConfig(): WatchConfig; setConfig(c: WatchConfig): void }`
  - `class WatchService { constructor(session, repo, projectKey: () => string, fetchFn?, now?); runCycle(): Promise<WatchEvent[]>; feed(): { events: WatchEvent[]; unreadCount: number; lastCycle: string | null }; ack(): void; getConfig(): WatchConfig; setConfig(raw: unknown): WatchConfig }`

`core/src/jira/mapper.ts:47` currently exposes the resolved sprint field id through a module-level getter; confirm its exported name before writing `service.ts` and use it rather than re-resolving the field.

- [ ] **Step 1: Write the failing test** — `core/test/watchService.test.ts`

```ts
// WatchService cycle tests against a stubbed fetch: both queries issued with
// the watcher's own field list, comment totals read, state persisted, and a
// failed query leaving the stored snapshot untouched.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraSession } from '../src/jira/session.js';
import { MemoryKvStore } from '../src/storage/kv.js';
import { KvWatchRepo, WatchService } from '../src/watch/service.js';

function session(): JiraSession {
  const s = new JiraSession();
  s.activate(
    {
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'token',
      authMode: 'token',
      defaultProjectKey: 'ISW',
    } as never,
    null,
  );
  return s;
}

function issue(over: Record<string, unknown> = {}) {
  return {
    key: 'ISW-1',
    fields: {
      summary: 'Fix the thing',
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'Major' },
      assignee: { displayName: 'Haim' },
      updated: '2026-08-23T09:00:00.000+0300',
      duedate: null,
      comment: { total: 1 },
      customfield_10100: ['com.x.Sprint@1[name=ISW Sprint 128,state=ACTIVE]'],
      ...over,
    },
  };
}

describe('WatchService', () => {
  let kv: MemoryKvStore;

  beforeEach(() => {
    kv = new MemoryKvStore();
  });

  function make(fetchFn: ReturnType<typeof vi.fn>) {
    const repo = new KvWatchRepo(kv);
    const service = new WatchService(session(), repo, () => 'ISW', fetchFn as never, () => new Date('2026-08-23T10:00:00Z'));
    return { repo, service };
  }

  it('issues a membership and a delta query and stores the baseline silently', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [issue()], total: 1 }));
    const { repo, service } = make(fetchFn);

    expect(await service.runCycle()).toEqual([]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [, , membership] = fetchFn.mock.calls[0];
    expect(membership.body.jql).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = currentUser()',
    );
    expect(membership.body.fields).toContain('duedate');
    expect(membership.body.fields).toContain('comment');
    const [, , deltaCall] = fetchFn.mock.calls[1];
    expect(deltaCall.body.jql).toBe('project = ISW AND assignee = currentUser() AND updated >= -10m');

    expect(repo.getState().snapshot['ISW-1']).toMatchObject({
      status: 'To Do',
      sprintName: 'ISW Sprint 128',
      commentCount: 1,
    });
    expect(repo.getState().lastCycle).toBe('2026-08-23T10:00:00.000Z');
  });

  it('reports changes on the second cycle and appends them to the feed', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [issue()], total: 1 }));
    const { repo, service } = make(fetchFn);
    await service.runCycle();

    fetchFn.mockImplementation(async () => ({
      issues: [issue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } })],
      total: 1,
    }));
    const events = await service.runCycle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'status', from: 'To Do', to: 'In Progress' });
    expect(repo.getState().feed).toHaveLength(1);
    expect(service.feed().unreadCount).toBe(1);
    service.ack();
    expect(service.feed().unreadCount).toBe(0);
  });

  it('leaves the stored snapshot untouched when a query fails', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [issue()], total: 1 }));
    const { repo, service } = make(fetchFn);
    await service.runCycle();

    fetchFn.mockRejectedValue(new Error('network is down'));
    await expect(service.runCycle()).rejects.toThrow('network is down');
    expect(repo.getState().snapshot['ISW-1'].status).toBe('To Do');
  });

  it('returns no events and touches nothing when disconnected', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [], total: 0 }));
    const repo = new KvWatchRepo(kv);
    const service = new WatchService(new JiraSession(), repo, () => 'ISW', fetchFn as never);
    expect(await service.runCycle()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sanitizes config through the repo', () => {
    const { service } = make(vi.fn());
    expect(service.setConfig({ intervalMinutes: 99 }).intervalMinutes).toBe(5);
    expect(service.setConfig({ intervalMinutes: 15 }).intervalMinutes).toBe(15);
    expect(service.getConfig().intervalMinutes).toBe(15);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test --workspace core -- watchService`
Expected: FAIL — cannot resolve `../src/watch/service.js`.

- [ ] **Step 3: Write `core/src/watch/state.ts`**

```ts
// Watch state + config persistence. Both ride the `lists` KV table, which the
// desktop maps to KvLists in SQLite and the Android build maps to the
// encrypted store — so no new table (and no EncryptedStorePlugin whitelist
// change) is needed for either platform.

import type { KvStore } from '../storage/kv.js';
import { sanitizeWatchConfig } from './config.js';
import { EMPTY_WATCH_STATE, type WatchConfig, type WatchState } from './types.js';

const STATE_KEY = 'watch.state';
const CONFIG_KEY = 'watch.config';

export class KvWatchRepo {
  constructor(private readonly kv: KvStore) {}

  getState(): WatchState {
    const row = this.kv.get('lists', STATE_KEY);
    if (!row?.json) return { ...EMPTY_WATCH_STATE };
    try {
      const parsed = JSON.parse(row.json) as Partial<WatchState>;
      return {
        snapshot: parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : {},
        lastCycle: typeof parsed.lastCycle === 'string' ? parsed.lastCycle : null,
        feed: Array.isArray(parsed.feed) ? parsed.feed : [],
        ackedAt: typeof parsed.ackedAt === 'string' ? parsed.ackedAt : null,
      };
    } catch {
      // A corrupt payload is treated as no state: the baseline rule then
      // applies and the user gets silence rather than a flood.
      return { ...EMPTY_WATCH_STATE };
    }
  }

  setState(state: WatchState): void {
    this.kv.set('lists', STATE_KEY, JSON.stringify(state));
  }

  /** Null state means "never ran" — the differ's baseline signal. */
  hasBaseline(): boolean {
    const row = this.kv.get('lists', STATE_KEY);
    return Boolean(row?.json);
  }

  getConfig(): WatchConfig {
    const row = this.kv.get('lists', CONFIG_KEY);
    if (!row?.json) return sanitizeWatchConfig({});
    try {
      return sanitizeWatchConfig(JSON.parse(row.json));
    } catch {
      return sanitizeWatchConfig({});
    }
  }

  setConfig(raw: unknown): WatchConfig {
    const config = sanitizeWatchConfig(raw);
    this.kv.set('lists', CONFIG_KEY, JSON.stringify(config));
    return config;
  }
}
```

- [ ] **Step 4: Write `core/src/watch/service.ts`**

```ts
// Dashboard watcher. One cycle = two searches, a diff against the stored
// snapshot, and a state write.
//
// The searches use their own field list rather than BASE_FIELDS: no view in
// the app needs `duedate` or `comment`, and adding them to BASE_FIELDS would
// make every search in the product pay for comment bodies.

import { apiPrefix, jiraFetch } from '../jira/httpClient.js';
import type { JiraSession } from '../jira/session.js';
import { sprintFieldId } from '../jira/mapper.js';
import { diffSnapshots } from './differ.js';
import { KvWatchRepo } from './state.js';
import { FEED_CAP, type IssueSnapshot, type WatchConfig, type WatchEvent } from './types.js';

export { KvWatchRepo } from './state.js';

type FetchFn = typeof jiraFetch;

/** Fields the watcher compares; deliberately separate from BASE_FIELDS. */
const WATCH_FIELDS = ['summary', 'status', 'priority', 'assignee', 'updated', 'duedate', 'comment'];

/** One page is enough: a sprint's worth of one person's issues. */
const MAX_RESULTS = 200;

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `[... name=ISW Sprint 128,state=ACTIVE ...]` or `{ name, state }` shapes. */
function activeSprintName(raw: unknown): string | null {
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const state = readString(obj.state).toLowerCase();
      if (state === 'active') return readString(obj.name) || null;
      continue;
    }
    const text = readString(entry);
    if (!/state=ACTIVE/i.test(text)) continue;
    const match = text.match(/name=([^,\]]+)/);
    if (match) return match[1];
  }
  return null;
}

export function mapSnapshot(raw: unknown): IssueSnapshot | null {
  const issue = (raw ?? {}) as Record<string, unknown>;
  const key = readString(issue.key);
  if (!key) return null;
  const fields = (issue.fields ?? {}) as Record<string, unknown>;
  const status = (fields.status ?? {}) as Record<string, unknown>;
  const category = (status.statusCategory ?? {}) as Record<string, unknown>;
  const comment = (fields.comment ?? {}) as Record<string, unknown>;
  const sprintField = sprintFieldId();
  return {
    key,
    summary: readString(fields.summary),
    status: readString(status.name),
    statusCategory: readString(category.key),
    sprintName: activeSprintName(sprintField ? fields[sprintField] : null),
    priority: readString((fields.priority as Record<string, unknown> | null)?.name),
    assignee: readString((fields.assignee as Record<string, unknown> | null)?.displayName) || null,
    dueDate: readString(fields.duedate) || null,
    commentCount: typeof comment.total === 'number' ? comment.total : 0,
    updated: readString(fields.updated),
  };
}

function toMap(issues: unknown): Record<string, IssueSnapshot> {
  const list = Array.isArray(issues) ? issues : [];
  const out: Record<string, IssueSnapshot> = {};
  for (const raw of list) {
    const snapshot = mapSnapshot(raw);
    if (snapshot) out[snapshot.key] = snapshot;
  }
  return out;
}

export class WatchService {
  constructor(
    private readonly session: JiraSession,
    private readonly repo: KvWatchRepo,
    private readonly projectKey: () => string,
    private readonly fetchFn: FetchFn = jiraFetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getConfig(): WatchConfig {
    return this.repo.getConfig();
  }

  setConfig(raw: unknown): WatchConfig {
    return this.repo.setConfig(raw);
  }

  feed(): { events: WatchEvent[]; unreadCount: number; lastCycle: string | null } {
    const state = this.repo.getState();
    const acked = state.ackedAt ? Date.parse(state.ackedAt) : 0;
    return {
      events: state.feed,
      unreadCount: state.feed.filter((e) => Date.parse(e.at) > acked).length,
      lastCycle: state.lastCycle,
    };
  }

  ack(): void {
    this.repo.setState({ ...this.repo.getState(), ackedAt: this.now().toISOString() });
  }

  private search(jql: string): Promise<unknown> {
    const prefix = apiPrefix(this.session.profile?.instanceType ?? 'datacenter');
    const fields = [...WATCH_FIELDS];
    const sprintField = sprintFieldId();
    if (sprintField && !fields.includes(sprintField)) fields.push(sprintField);
    return this.fetchFn(this.session, `${prefix}/search`, {
      method: 'POST',
      body: { jql, startAt: 0, maxResults: MAX_RESULTS, fields },
    });
  }

  /**
   * Run one cycle. Throws if Jira does — the caller decides whether that is
   * worth surfacing, and the stored snapshot is left alone so the next
   * successful cycle still reports everything that changed meanwhile.
   */
  async runCycle(): Promise<WatchEvent[]> {
    if (!this.session.isConnected) return [];

    const config = this.repo.getConfig();
    const project = this.projectKey();
    const windowMinutes = config.intervalMinutes * 2;

    const membershipResp = await this.search(
      `project = ${project} AND sprint in openSprints() AND assignee = currentUser()`,
    );
    const deltaResp = await this.search(
      `project = ${project} AND assignee = currentUser() AND updated >= -${windowMinutes}m`,
    );

    const next = toMap((membershipResp as Record<string, unknown>)?.issues);
    const delta = toMap((deltaResp as Record<string, unknown>)?.issues);
    const at = this.now().toISOString();

    const state = this.repo.getState();
    const events = diffSnapshots({
      prev: this.repo.hasBaseline() ? state.snapshot : null,
      next,
      delta,
      config,
      at,
    });

    this.repo.setState({
      snapshot: next,
      lastCycle: at,
      feed: [...events, ...state.feed].slice(0, FEED_CAP),
      ackedAt: state.ackedAt,
    });

    return events;
  }
}
```

- [ ] **Step 5: Confirm the sprint-field getter's real name**

Run: `grep -n "sprintFieldId" core/src/jira/mapper.ts`
`core/src/jira/mapper.ts:47` returns the module-level id. If the exported
function is not literally `sprintFieldId`, update the import in `service.ts` to
the real name — do not add a second resolver.

- [ ] **Step 6: Export the watch surface from `core/src/index.ts`**

Add after the Jira block:

```ts
// --- watch -------------------------------------------------------------------
export {
  DEFAULT_WATCH_CONFIG,
  WATCH_EVENT_KINDS,
  WATCH_INTERVALS,
  diffSnapshots,
  sanitizeWatchConfig,
  type IssueSnapshot,
  type WatchConfig,
  type WatchEvent,
  type WatchEventKind,
  type WatchState,
} from './watch/differ.js';
export { KvWatchRepo, WatchService } from './watch/service.js';
```

- [ ] **Step 7: Add `watch` to the composition root**

In `core/src/composition.ts`: import `WatchService` and `KvWatchRepo`, add
`watch: WatchService;` to the `Core` interface, and construct it alongside the
aggregator. The project-key resolver mirrors `dispatch.ts:323`:

```ts
const watch = new WatchService(session, new KvWatchRepo(ports.kv), () => {
  const fromSession = session.profile?.defaultProjectKey?.trim();
  if (fromSession) return fromSession;
  try {
    const fromSettings = settings.get().defaultProjectKey?.trim();
    if (fromSettings) return fromSettings;
  } catch {
    // settings failures must not break project resolution
  }
  return 'ISW';
});
```

`settings` is the `AppSettingsRepo` already built in `createCore`; hoist its
construction above this line if it currently sits inside the returned object
literal. Add `watch` to the returned object.

- [ ] **Step 8: Run the tests**

Run: `npm run test --workspace core`
Expected: PASS — the new file plus every existing core test.

- [ ] **Step 9: Commit**

```bash
git add core/src/watch core/src/index.ts core/src/composition.ts core/test/watchService.test.ts
git commit -m "feat(watch): WatchService cycle over its own Jira field list"
```

---

### Task 3: Server routes, timer and toast

**Files:**
- Create: `server/src/watch.ts`, `server/src/routes/watch.ts`
- Modify: `server/src/routes/deps.ts` (add `WatchDep`), `server/src/app.ts` (mount), `server/src/main.ts` (construct + start)
- Test: `server/test/watchRoutes.test.ts`

**Interfaces:**
- Consumes: `WatchService`, `KvWatchRepo` (Task 2); `dataDir` (`server/src/config/appPaths.ts`); the `h`/`HttpError`/`AppDeps` helpers in `server/src/routes/deps.ts`.
- Produces: `watchRoutes(deps: AppDeps): Router`; `startWatchTimer(deps): () => void`; `AppDeps.watch: WatchDep`.

- [ ] **Step 1: Write the failing test** — `server/test/watchRoutes.test.ts`

Follow the existing harness in `server/test/routes.test.ts` (read it first and
reuse its app-building helper and mock-deps shape rather than inventing a
second one). The cases:

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';

// Replace `makeApp` with whatever routes.test.ts already uses to build an app
// around partial deps.

const FEED = {
  events: [
    { id: 'ISW-1:status:2026-08-23T10:00:00.000Z', kind: 'status', key: 'ISW-1', summary: 'Fix', from: 'To Do', to: 'In Progress', at: '2026-08-23T10:00:00.000Z' },
  ],
  unreadCount: 1,
  lastCycle: '2026-08-23T10:00:00.000Z',
};

describe('/api/watch', () => {
  it('returns the feed', async () => {
    const watch = { feed: () => FEED, ack: () => {}, getConfig: () => ({}), setConfig: (r: unknown) => r, runCycle: async () => [] };
    const res = await request(makeApp({ watch })).get('/api/watch/feed');
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(1);
  });

  it('acks the feed', async () => {
    let acked = false;
    const watch = { feed: () => FEED, ack: () => { acked = true; }, getConfig: () => ({}), setConfig: (r: unknown) => r, runCycle: async () => [] };
    const res = await request(makeApp({ watch })).post('/api/watch/ack').send({});
    expect(res.status).toBe(200);
    expect(acked).toBe(true);
  });

  it('sanitizes the config it stores', async () => {
    const stored: unknown[] = [];
    const watch = {
      feed: () => FEED,
      ack: () => {},
      getConfig: () => ({ enabled: true, intervalMinutes: 5, kinds: {} }),
      setConfig: (raw: unknown) => { stored.push(raw); return { enabled: true, intervalMinutes: 5, kinds: {} }; },
      runCycle: async () => [],
    };
    const res = await request(makeApp({ watch })).put('/api/watch/config').send({ intervalMinutes: 99 });
    expect(res.status).toBe(200);
    expect(res.body.intervalMinutes).toBe(5);
  });

  it('runs a cycle on demand and reports the event count', async () => {
    const watch = { feed: () => FEED, ack: () => {}, getConfig: () => ({}), setConfig: (r: unknown) => r, runCycle: async () => [FEED.events[0]] };
    const res = await request(makeApp({ watch })).post('/api/watch/run').send({});
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace server -- watchRoutes`
Expected: FAIL — 404 from every route.

- [ ] **Step 3: Add the dep interface**

In `server/src/routes/deps.ts`, beside `AggregatorDep`:

```ts
export interface WatchDep {
  runCycle(): Promise<WatchEvent[]>;
  feed(): { events: WatchEvent[]; unreadCount: number; lastCycle: string | null };
  ack(): void;
  getConfig(): WatchConfig;
  setConfig(raw: unknown): WatchConfig;
}
```

Import `WatchConfig` and `WatchEvent` from `@mc/core` in the type import block,
and add `watch: WatchDep;` to `AppDeps`.

- [ ] **Step 4: Write `server/src/routes/watch.ts`**

```ts
// /api/watch — dashboard change feed. GET the feed, POST an ack, GET/PUT the
// config, POST a forced cycle. Config sanitization happens in @mc/core so the
// Android dispatcher applies the identical rules.

import { Router } from 'express';
import { h, type AppDeps } from './deps.js';

export function watchRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get('/feed', (_req, res) => {
    res.json(deps.watch.feed());
  });

  router.post('/ack', (_req, res) => {
    deps.watch.ack();
    res.json(deps.watch.feed());
  });

  router.get('/config', (_req, res) => {
    res.json(deps.watch.getConfig());
  });

  router.put('/config', (req, res) => {
    res.json(deps.watch.setConfig(req.body ?? {}));
  });

  // Forced cycle. A Jira failure here is the user's answer to "check now", so
  // unlike the timer it is reported rather than swallowed.
  router.post(
    '/run',
    h(async (_req, res) => {
      const events = await deps.watch.runCycle();
      res.json({ count: events.length, ...deps.watch.feed() });
    }),
  );

  return router;
}
```

- [ ] **Step 5: Mount it in `server/src/app.ts`**

Beside the reminders mount (`app.ts:82`):

```ts
import { watchRoutes } from './routes/watch.js';
// ...
api.use('/watch', watchRoutes(deps));
```

- [ ] **Step 6: Write `server/src/watch.ts` (timer + toast)**

```ts
// Desktop side of the dashboard watcher: a timer while the server runs, and
// one WinRT toast per batch of changes.
//
// Unlike reminders.ts this is not a Windows Scheduled Task — the poll needs the
// live Jira session this process holds, so it only runs while Mission Control
// is up. The first cycle fires immediately on start so changes made while the
// app was closed are reported at launch rather than one interval later.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WatchEvent } from '@mc/core';
import { dataDir } from './config/appPaths.js';

export interface WatchTimerDeps {
  watch: {
    runCycle(): Promise<WatchEvent[]>;
    getConfig(): { enabled: boolean; intervalMinutes: number };
  };
  /** Injected in tests so no PowerShell is spawned. */
  notify?: (events: WatchEvent[]) => void;
}

/** One line per event, in the toast body. */
export function eventLine(event: WatchEvent): string {
  const summary = event.summary.length > 48 ? `${event.summary.slice(0, 45)}...` : event.summary;
  switch (event.kind) {
    case 'assigned':
      return `${event.key} assigned to you — ${summary}`;
    case 'unassigned':
      return `${event.key} ${event.reason === 'done' ? 'closed' : event.reason === 'reassigned' ? 'reassigned' : 'left your sprint'}`;
    case 'comment':
      return `${event.key} — ${Number(event.to) - Number(event.from)} new comment(s)`;
    case 'dueDate':
      return `${event.key} due ${event.to ?? 'date cleared'}`;
    default:
      return `${event.key} ${event.from ?? '—'} → ${event.to ?? '—'}`;
  }
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toastScript(events: WatchEvent[]): string {
  const title = `${events.length} change${events.length === 1 ? '' : 's'} on your dashboard`;
  const body = events.slice(0, 3).map(eventLine).join('&#10;');
  return `# Mission Control — dashboard watch toast (generated; do not edit)
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
$xml = @'
<toast activationType="protocol" launch="http://127.0.0.1:5643/#/dashboard">
  <visual><binding template="ToastGeneric">
    <text>Mission Control</text>
    <text>${xmlEscape(title)}</text>
    <text>${xmlEscape(body)}</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Default" />
</toast>
'@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mission Control').Show($toast)
`;
}

function showToast(events: WatchEvent[]): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    const script = path.join(dataDir(), 'watch-toast.ps1');
    writeFileSync(script, toastScript(events), 'utf8');
    spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
      windowsHide: true,
    }).on('error', () => {
      // A failed toast still leaves the events in the in-app feed.
    });
  } catch {
    // Same reasoning: never let a notification failure break the cycle.
  }
}

/** Start the poll loop. Returns a stop function. */
export function startWatchTimer(deps: WatchTimerDeps): () => void {
  const notify = deps.notify ?? showToast;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    const config = deps.watch.getConfig();
    if (config.enabled) {
      try {
        const events = await deps.watch.runCycle();
        if (events.length > 0) notify(events);
      } catch {
        // A failed cycle is silent: 401s are already surfaced by the session
        // machinery, and a VPN blip must not produce a toast.
      }
    }
    if (stopped) return;
    timer = setTimeout(() => void tick(), Math.max(1, config.intervalMinutes) * 60_000);
  };

  void tick(); // catch-up cycle at start

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
```

- [ ] **Step 7: Wire it in `server/src/main.ts`**

After the `aggregator` line:

```ts
const watch = new WatchService(session, new KvWatchRepo(kv), () => defaultProjectKeyForWatch());
```

where `defaultProjectKeyForWatch` mirrors `deps.ts:268` using `session` and
`appSettings`. Add `watch,` to the `createApp({...})` argument, and after the
server starts listening call:

```ts
startWatchTimer({ watch });
```

- [ ] **Step 8: Run the tests**

Run: `npm run test --workspace server`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/watch.ts server/src/routes/watch.ts server/src/routes/deps.ts server/src/app.ts server/src/main.ts server/test/watchRoutes.test.ts
git commit -m "feat(watch): desktop poll timer, toast and /api/watch routes"
```

---

### Task 4: Android dispatcher routes

**Files:**
- Modify: `core/src/dispatch.ts`
- Test: `core/test/dispatch.test.ts`

**Interfaces:**
- Consumes: `core.watch` (Task 2).
- Produces: `/api/watch/{feed,ack,config,run}` answered in-process with the same
  status codes and payloads as Task 3's Express routes.

- [ ] **Step 1: Add the failing test** to `core/test/dispatch.test.ts`

```ts
it('answers the watch routes natively', async () => {
  const feed = await dispatch('GET', '/api/watch/feed');
  expect(feed.status).toBe(200);
  expect(feed.body).toMatchObject({ unreadCount: 0 });

  const config = await dispatch('PUT', '/api/watch/config', { intervalMinutes: 99 });
  expect(config.status).toBe(200);
  expect((config.body as { intervalMinutes: number }).intervalMinutes).toBe(5);

  expect((await dispatch('POST', '/api/watch/ack', {})).status).toBe(200);
  expect((await dispatch('DELETE', '/api/watch/feed')).status).toBe(404);
});
```

Match the existing `dispatch` helper in that file — read the top of
`core/test/dispatch.test.ts` and reuse its core-building fixture.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace core -- dispatch`
Expected: FAIL — 404 for `/api/watch/feed`.

- [ ] **Step 3: Add the route group in `core/src/dispatch.ts`**

Beside the other group handlers:

```ts
  async function watchRoute(method: string, rest: string[], body: Record<string, unknown>): Promise<DispatchResponse> {
    const [sub] = rest;
    if (method === 'GET' && sub === 'feed') return ok(core.watch.feed());
    if (method === 'GET' && sub === 'config') return ok(core.watch.getConfig());
    if (method === 'PUT' && sub === 'config') return ok(core.watch.setConfig(body));
    if (method === 'POST' && sub === 'ack') {
      core.watch.ack();
      return ok(core.watch.feed());
    }
    if (method === 'POST' && sub === 'run') {
      const events = await core.watch.runCycle();
      return ok({ count: events.length, ...core.watch.feed() });
    }
    return NOT_FOUND;
  }
```

and in `route()`'s switch:

```ts
      case 'watch':
        return watchRoute(method, rest, b);
```

- [ ] **Step 4: Run the tests**

Run: `npm run test --workspace core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/dispatch.ts core/test/dispatch.test.ts
git commit -m "feat(watch): answer /api/watch natively in the Android dispatcher"
```

---

### Task 5: Client API, store and bell UI

**Files:**
- Modify: `client/src/api/client.ts`, `client/src/components/PageHeader.tsx`
- Create: `client/src/stores/watch.ts`, `client/src/components/WatchBell.tsx`
- Test: `client/test/watchStore.test.ts`

**Interfaces:**
- Consumes: `/api/watch/*` (Tasks 3–4); `createStore` (`client/src/stores/store.ts`); `onTick` (`client/src/stores/scheduler.ts`).
- Produces: `watch` API namespace; `watchStore` (`{ events, unreadCount, lastCycle }`); `refreshWatchFeed()`; `ackWatchFeed()`; `<WatchBell />`.

- [ ] **Step 1: Write the failing test** — `client/test/watchStore.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feedResponse = {
  events: [
    { id: 'ISW-1:status:2026-08-23T10:00:00.000Z', kind: 'status', key: 'ISW-1', summary: 'Fix', from: 'To Do', to: 'In Progress', at: '2026-08-23T10:00:00.000Z' },
  ],
  unreadCount: 1,
  lastCycle: '2026-08-23T10:00:00.000Z',
};

vi.mock('../src/api/client', () => ({
  watch: {
    feed: vi.fn(async () => feedResponse),
    ack: vi.fn(async () => ({ ...feedResponse, unreadCount: 0 })),
  },
}));

import { watch } from '../src/api/client';
import { ackWatchFeed, refreshWatchFeed, watchStore } from '../src/stores/watch';

describe('watch store', () => {
  beforeEach(() => {
    watchStore.set({ events: [], unreadCount: 0, lastCycle: null });
    vi.clearAllMocks();
  });

  it('loads the feed', async () => {
    await refreshWatchFeed();
    expect(watchStore.get().unreadCount).toBe(1);
    expect(watchStore.get().events).toHaveLength(1);
  });

  it('clears the unread count on ack', async () => {
    await refreshWatchFeed();
    await ackWatchFeed();
    expect(watchStore.get().unreadCount).toBe(0);
  });

  it('leaves the last good feed in place when the request fails', async () => {
    await refreshWatchFeed();
    (watch.feed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await refreshWatchFeed();
    expect(watchStore.get().events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace client -- watchStore`
Expected: FAIL — cannot resolve `../src/stores/watch`.

- [ ] **Step 3: Add the API namespace** in `client/src/api/client.ts`

Beside `dashboard`:

```ts
export const watch = {
  feed: () => api.get<WatchFeed>('/api/watch/feed'),
  ack: () => api.post<WatchFeed>('/api/watch/ack', {}),
  run: () => api.post<WatchFeed & { count: number }>('/api/watch/run', {}),
  getConfig: () => api.get<WatchConfig>('/api/watch/config'),
  setConfig: (config: WatchConfig) => api.put<WatchConfig>('/api/watch/config', config),
};
```

Add `WatchConfig`, `WatchEvent` and `WatchFeed` to `client/src/types.ts`,
mirroring the core types exactly (`WatchFeed = { events: WatchEvent[];
unreadCount: number; lastCycle: string | null }`). Match the existing helper
names in this file — if it exposes `api.put` under a different name, use that.

- [ ] **Step 4: Write `client/src/stores/watch.ts`**

```ts
// Dashboard change feed store. Polls /api/watch/feed on scheduler ticks; the
// cycle itself runs server-side (desktop) or in the worker (Android), so this
// only ever reads.

import { watch } from '../api/client';
import type { WatchFeed } from '../types';
import { createStore } from './store';
import { onTick } from './scheduler';

export const watchStore = createStore<WatchFeed>({ events: [], unreadCount: 0, lastCycle: null });

export async function refreshWatchFeed(): Promise<void> {
  try {
    watchStore.set(await watch.feed());
  } catch {
    // Keep the last good feed: a blip must not blank the bell.
  }
}

export async function ackWatchFeed(): Promise<void> {
  try {
    watchStore.set(await watch.ack());
  } catch {
    watchStore.set({ ...watchStore.get(), unreadCount: 0 });
  }
}

/** Wire the feed to scheduler ticks. Call once on boot. */
export function initWatchFeed(): void {
  void refreshWatchFeed();
  onTick(() => void refreshWatchFeed());
}
```

Call `initWatchFeed()` where `initScheduler()` is called in
`client/src/main.tsx`.

- [ ] **Step 5: Write `client/src/components/WatchBell.tsx`**

A button showing 🔔 plus the unread count when non-zero, and a dropdown listing
`watchStore.get().events` newest first — each row `KIND · KEY — summary`, with
`from → to` in muted text and a relative timestamp. Clicking the bell calls
`ackWatchFeed()`. Use `useStore(watchStore)` and follow the styling of the
existing header controls (inline styles, `className="muted"` for secondary
text) rather than introducing a new pattern. Render it inside `PageHeader`'s
`right` cluster on the Dashboard view.

- [ ] **Step 6: Run the tests**

Run: `npm run test --workspace client`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/api/client.ts client/src/types.ts client/src/stores/watch.ts client/src/components/WatchBell.tsx client/src/main.tsx client/test/watchStore.test.ts
git commit -m "feat(watch): in-app change feed with unread bell"
```

---

### Task 6: Settings section

**Files:**
- Create: `client/src/views/settings/NotificationsSection.tsx`
- Modify: `client/src/views/SettingsView.tsx`, `client/src/mobile/screens/MobileSettings.tsx`

**Interfaces:**
- Consumes: `watch.getConfig` / `watch.setConfig` / `watch.run` (Task 5).
- Produces: no new exports beyond the section component.

- [ ] **Step 1: Read `client/src/views/settings/DashboardSection.tsx`**

Match its props, layout and save semantics exactly — this section is its sibling
and must not invent a second settings idiom.

- [ ] **Step 2: Write the section**

Controls: master enable checkbox; seven per-kind checkboxes labelled
"Assigned to me", "No longer mine", "Status changed", "Sprint changed",
"Priority changed", "Due date changed", "New comments"; an interval `<select>`
with 5 / 10 / 15 / 30; a "Check now" button calling `watch.run()` then
`refreshWatchFeed()`; the last-cycle timestamp via `formatDateTime`; and this
line in muted text:

> Desktop alerts are raised while Mission Control is running. On Android, background checks run about every 15 minutes and every 5 minutes while the app is open.

- [ ] **Step 3: Mount it in both settings views**

Desktop: add to `SettingsView.tsx` beside the dashboard section.
Mobile: add the same controls to `MobileSettings.tsx` following that file's row
idiom.

- [ ] **Step 4: Verify the build**

Run: `npm run build --workspace client`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/views/settings/NotificationsSection.tsx client/src/views/SettingsView.tsx client/src/mobile/screens/MobileSettings.tsx
git commit -m "feat(watch): notification settings on desktop and mobile"
```

---

### Task 7: Active sprint in the Dashboard header

**Files:**
- Modify: `client/src/lib/viewDashboard.ts`, `client/src/views/DashboardView.tsx:332`, `client/src/mobile/screens/MobileDashboard.tsx`
- Test: `client/test/viewDashboardSprint.test.ts`

**Interfaces:**
- Consumes: `JiraIssue.sprint`, `JiraIssue.allSprints` (`core/src/types.ts:39-73`, `SprintInfo = { name, state, startDate, endDate }`).
- Produces: `resolveActiveSprint(issues, now): ActiveSprint | null` where
  `ActiveSprint = { name: string; endDate: string | null; daysLeft: number | null }`,
  and `formatSprintHeader(sprint): string`.

- [ ] **Step 1: Write the failing test** — `client/test/viewDashboardSprint.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { formatSprintHeader, resolveActiveSprint } from '../src/lib/viewDashboard';
import type { JiraIssue } from '../src/types';

const NOW = new Date('2026-08-23T09:00:00Z');

function issue(sprint: string | null, endDate: string | null = '2026-08-26T00:00:00Z'): JiraIssue {
  return {
    key: 'ISW-1',
    sprint,
    allSprints: sprint ? [{ name: sprint, state: 'ACTIVE', startDate: '2026-08-12T00:00:00Z', endDate }] : [],
  } as unknown as JiraIssue;
}

describe('resolveActiveSprint', () => {
  it('returns null when no issue carries a sprint', () => {
    expect(resolveActiveSprint([issue(null)], NOW)).toBeNull();
    expect(resolveActiveSprint([], NOW)).toBeNull();
  });

  it('picks the most common sprint name across the issues', () => {
    const issues = [issue('Sprint 128'), issue('Sprint 128'), issue('Sprint 129')];
    expect(resolveActiveSprint(issues, NOW)?.name).toBe('Sprint 128');
  });

  it('computes whole days left from the end date', () => {
    expect(resolveActiveSprint([issue('Sprint 128')], NOW)?.daysLeft).toBe(3);
  });

  it('never reports a negative day count', () => {
    const past = resolveActiveSprint([issue('Sprint 128', '2026-08-20T00:00:00Z')], NOW);
    expect(past?.daysLeft).toBe(0);
  });

  it('tolerates a sprint with no end date', () => {
    const open = resolveActiveSprint([issue('Sprint 128', null)], NOW);
    expect(open).toMatchObject({ name: 'Sprint 128', daysLeft: null });
  });
});

describe('formatSprintHeader', () => {
  it('reads as one line with the countdown', () => {
    expect(formatSprintHeader({ name: 'ISW Sprint 128', endDate: '2026-08-26T00:00:00Z', daysLeft: 3 }))
      .toBe('My Current Sprint — ISW Sprint 128 · 3 days left (ends 26 Aug)');
  });

  it('says ends today rather than 0 days left', () => {
    expect(formatSprintHeader({ name: 'ISW Sprint 128', endDate: '2026-08-23T00:00:00Z', daysLeft: 0 }))
      .toBe('My Current Sprint — ISW Sprint 128 · ends today');
  });

  it('drops the countdown when there is no end date', () => {
    expect(formatSprintHeader({ name: 'ISW Sprint 128', endDate: null, daysLeft: null }))
      .toBe('My Current Sprint — ISW Sprint 128');
  });

  it('falls back to the plain title with no sprint', () => {
    expect(formatSprintHeader(null)).toBe('My Current Sprint');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace client -- viewDashboardSprint`
Expected: FAIL — `resolveActiveSprint is not a function`.

- [ ] **Step 3: Implement in `client/src/lib/viewDashboard.ts`**

Append to the "Sprint data" section:

```ts
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
  const endDate = info?.endDate ?? null;
  const parsed = endDate ? Date.parse(endDate) : Number.NaN;
  const daysLeft = Number.isNaN(parsed) ? null : Math.max(0, Math.ceil((parsed - now.getTime()) / DAY_MS));

  return { name, endDate: Number.isNaN(parsed) ? null : endDate, daysLeft };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Card title line: name, countdown and end date when they are known. */
export function formatSprintHeader(sprint: ActiveSprint | null): string {
  if (!sprint) return 'My Current Sprint';
  const base = `My Current Sprint — ${sprint.name}`;
  if (sprint.daysLeft === null || sprint.endDate === null) return base;
  if (sprint.daysLeft === 0) return `${base} · ends today`;
  const end = new Date(sprint.endDate);
  const ends = `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
  return `${base} · ${sprint.daysLeft} day${sprint.daysLeft === 1 ? '' : 's'} left (ends ${ends})`;
}
```

- [ ] **Step 4: Use it in the view**

In `client/src/views/DashboardView.tsx`, replace the literal at line 332:

```tsx
<div style={{ fontSize: 15, fontWeight: 700 }}>
  {formatSprintHeader(resolveActiveSprint(sprintIssues))}
</div>
```

adding both names to the existing import from `../lib/viewDashboard`. Apply the
same change to the sprint card header in `MobileDashboard.tsx`.

- [ ] **Step 5: Add the board fallback**

When `resolveActiveSprint` returns null and a pinned board exists, fetch
`boards.sprints(boardId)` (already in `client/src/api/client.ts:239`), take the
entry whose `state` is `active`, and feed it through `formatSprintHeader` as
`{ name, endDate, daysLeft }` computed the same way. Hold it in a
`useState<ActiveSprint | null>` loaded in the existing sprint-load effect — do
not add a second effect.

- [ ] **Step 6: Run the tests**

Run: `npm run test --workspace client`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/viewDashboard.ts client/src/views/DashboardView.tsx client/src/mobile/screens/MobileDashboard.tsx client/test/viewDashboardSprint.test.ts
git commit -m "feat(dashboard): show the active sprint and its countdown"
```

---

### Task 8: Android background worker

**Files:**
- Create: `client/src/native/watchEntry.ts`, `android/app/src/main/java/com/hp/missioncontrol/WatchBridgePlugin.java`, `android/app/src/main/java/com/hp/missioncontrol/WatchWorker.java`
- Modify: `client/src/main.tsx` (route `#/__watch` to the headless entry before React mounts), `android/app/src/main/java/com/hp/missioncontrol/MainActivity.java` (register the plugin, schedule the work, request the permission), `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle` (WorkManager dependency)

**Interfaces:**
- Consumes: `core.watch.runCycle` through the native dispatcher (Task 4); the
  existing native bootstrap in `client/src/native/bootstrap.ts`.
- Produces: `WatchBridge.report({ events })` callable from JavaScript;
  `WatchWorker` scheduled as unique periodic work named `mc-watch`.

- [ ] **Step 1: Add the WorkManager dependency**

In `android/app/build.gradle` dependencies:

```gradle
    implementation "androidx.work:work-runtime:2.9.1"
```

Run: `cd android && ./gradlew :app:dependencies --configuration implementation | grep work-runtime`
Expected: the artifact resolves.

- [ ] **Step 2: Write the headless entry** — `client/src/native/watchEntry.ts`

```ts
// Headless watch entry. WatchWorker loads the app at #/__watch in an offscreen
// WebView; main.tsx hands control here instead of mounting React. One cycle
// runs through the same in-process dispatcher the UI uses, the events go back
// to the worker over WatchBridge, and the WebView is destroyed.

import { registerPlugin } from '@capacitor/core';
import { bootstrapNative } from './bootstrap';
import { api } from '../api/client';
import type { WatchEvent } from '../types';

interface WatchBridgePlugin {
  report(options: { events: WatchEvent[] }): Promise<void>;
  fail(options: { message: string }): Promise<void>;
}

const WatchBridge = registerPlugin<WatchBridgePlugin>('WatchBridge');

export async function runHeadlessWatch(): Promise<void> {
  try {
    await bootstrapNative();
    const result = await api.post<{ count: number; events: WatchEvent[] }>('/api/watch/run', {});
    await WatchBridge.report({ events: result.events.slice(0, result.count) });
  } catch (err) {
    await WatchBridge.fail({ message: err instanceof Error ? err.message : String(err) });
  }
}
```

Confirm the real bootstrap export name in `client/src/native/bootstrap.ts` and
use it; do not add a second bootstrap path.

- [ ] **Step 3: Branch in `client/src/main.tsx`**

Before the React mount:

```tsx
if (window.location.hash.startsWith('#/__watch')) {
  void import('./native/watchEntry').then((m) => m.runHeadlessWatch());
} else {
  // existing mount
}
```

- [ ] **Step 4: Write `WatchBridgePlugin.java`**

```java
package com.hp.missioncontrol;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Carries one headless watch cycle's result back to WatchWorker. */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridgePlugin extends Plugin {
    /** Set by WatchWorker for the lifetime of one headless cycle. */
    static volatile Listener listener;

    interface Listener {
        void onEvents(JSObject payload);
        void onFailure(String message);
    }

    @PluginMethod
    public void report(PluginCall call) {
        Listener current = listener;
        if (current != null) current.onEvents(call.getData());
        call.resolve();
    }

    @PluginMethod
    public void fail(PluginCall call) {
        Listener current = listener;
        String message = call.getString("message");
        if (current != null) current.onFailure(message == null ? "watch cycle failed" : message);
        call.resolve();
    }
}
```

- [ ] **Step 5: Write `WatchWorker.java`**

A `Worker` (or `ListenableWorker`) that:
1. creates the notification channel `mc_jira_changes` if missing;
2. on the main looper, builds a `WebView`, enables JavaScript and DOM storage,
   loads `file:///android_asset/public/index.html#/__watch`;
3. registers itself as `WatchBridgePlugin.listener`;
4. blocks on a `CountDownLatch` with a 60-second timeout — timeout means
   `Result.retry()`;
5. on `onEvents`, parses `events`, and if non-empty posts one
   `NotificationCompat.Builder(context, "mc_jira_changes")` notification titled
   `N changes on your dashboard`, body = the first three event lines, content
   intent = `MainActivity` with `Intent.setData(Uri.parse("mcapp://dashboard"))`;
6. always destroys the WebView and clears the listener in a `finally`.

Reuse the event-line wording from `server/src/watch.ts:eventLine` so desktop and
phone read identically.

- [ ] **Step 6: Manifest and MainActivity**

Manifest — add beside the existing permissions:

```xml
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

`MainActivity.onCreate` — register the plugin next to the others, and after
`super.onCreate`:

```java
        registerPlugin(WatchBridgePlugin.class);
        // ...
        PeriodicWorkRequest watch = new PeriodicWorkRequest.Builder(WatchWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(this)
            .enqueueUniquePeriodicWork("mc-watch", ExistingPeriodicWorkPolicy.KEEP, watch);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
        }
```

- [ ] **Step 7: Build and install**

Run: `npm run android:sync && cd android && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 8: Verify on device**

Install, sign in, then force a cycle:

```bash
adb shell cmd jobscheduler run -f com.hp.missioncontrol 999
adb logcat -s WatchWorker:V
```

Expected: the worker logs a completed cycle. Change an issue's status in Jira
from another machine, force another run, and confirm the notification appears.

- [ ] **Step 9: Commit**

```bash
git add client/src/native/watchEntry.ts client/src/main.tsx android/
git commit -m "feat(watch): Android background watch worker and notifications"
```

---

## Self-Review

**Spec coverage:** event model → Task 1; queries and dedicated field list →
Task 2; state → Task 2 (with the documented `lists` deviation); desktop
delivery → Task 3; native dispatcher parity → Task 4; in-app feed → Task 5;
settings → Task 6; active sprint header → Task 7; Android → Task 8; error
handling → the `catch` blocks specified in Tasks 2, 3 and 5; testing → the test
files in Tasks 1, 2, 3, 4, 5 and 7.

**Known soft spots, deliberately left to the implementer:** Task 5's bell markup
and Task 8's `WatchWorker` body are described rather than transcribed, because
both must match surrounding code (header control styling, the project's Java
idiom) that is better read at the point of editing than guessed here. Every
signature they depend on is fixed above.
