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
