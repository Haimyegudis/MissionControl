// /api/watch route tests plus the poll timer, over real HTTP on an ephemeral
// port. Only deps.watch is exercised, so the rest of AppDeps is a bare cast.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WatchEvent } from '@mc/core';
import { createApp, type AppDeps } from '../src/app.js';
import { eventLine, startWatchTimer, toastScript } from '../src/watch.js';

const EVENT: WatchEvent = {
  id: 'ISW-1:status:2026-08-23T10:00:00.000Z',
  kind: 'status',
  key: 'ISW-1',
  summary: 'Fix the thing',
  from: 'To Do',
  to: 'In Progress',
  at: '2026-08-23T10:00:00.000Z',
};

const FEED = { events: [EVENT], unreadCount: 1, lastCycle: '2026-08-23T10:00:00.000Z' };

function makeWatch(over: Partial<AppDeps['watch']> = {}): AppDeps['watch'] {
  return {
    runCycle: vi.fn(async () => []),
    feed: vi.fn(() => FEED),
    ack: vi.fn(),
    getConfig: vi.fn(() => ({ enabled: true, intervalMinutes: 5, kinds: {} as never })),
    setConfig: vi.fn((raw: unknown) => ({ enabled: true, intervalMinutes: 5, kinds: {} as never, ...(raw as object) })),
    ...over,
  };
}

let server: Server | null = null;

async function start(watch: AppDeps['watch']): Promise<string> {
  const app = createApp({ watch } as unknown as AppDeps);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('/api/watch', () => {
  it('returns the feed', async () => {
    const base = await start(makeWatch());
    const res = await fetch(`${base}/api/watch/feed`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FEED);
  });

  it('acks the feed', async () => {
    const watch = makeWatch();
    const base = await start(watch);
    const res = await fetch(`${base}/api/watch/ack`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(watch.ack).toHaveBeenCalledOnce();
  });

  it('reads and writes the config', async () => {
    const watch = makeWatch({ setConfig: vi.fn(() => ({ enabled: true, intervalMinutes: 5, kinds: {} as never })) });
    const base = await start(watch);

    expect((await (await fetch(`${base}/api/watch/config`)).json()).intervalMinutes).toBe(5);

    const res = await fetch(`${base}/api/watch/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMinutes: 99 }),
    });
    expect(res.status).toBe(200);
    expect(watch.setConfig).toHaveBeenCalledWith({ intervalMinutes: 99 });
    expect((await res.json()).intervalMinutes).toBe(5);
  });

  it('runs a cycle on demand and reports the event count', async () => {
    const base = await start(makeWatch({ runCycle: vi.fn(async () => [EVENT]) }));
    const res = await fetch(`${base}/api/watch/run`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });

  it('surfaces a failed forced cycle rather than swallowing it', async () => {
    const base = await start(
      makeWatch({
        runCycle: vi.fn(async () => {
          throw new Error('Jira is unreachable');
        }),
      }),
    );
    const res = await fetch(`${base}/api/watch/run`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain('Jira is unreachable');
  });
});

describe('toast rendering', () => {
  it('reads one line per event kind', () => {
    expect(eventLine(EVENT)).toBe('ISW-1 To Do → In Progress');
    expect(eventLine({ ...EVENT, kind: 'assigned', from: null, to: 'To Do' })).toBe(
      'ISW-1 assigned to you — Fix the thing',
    );
    expect(eventLine({ ...EVENT, kind: 'unassigned', reason: 'done' })).toBe('ISW-1 closed');
    expect(eventLine({ ...EVENT, kind: 'unassigned', reason: 'reassigned' })).toBe('ISW-1 reassigned');
    expect(eventLine({ ...EVENT, kind: 'unassigned' })).toBe('ISW-1 left your sprint');
    expect(eventLine({ ...EVENT, kind: 'comment', from: '1', to: '4' })).toBe('ISW-1 — 3 new comment(s)');
    expect(eventLine({ ...EVENT, kind: 'dueDate', to: '2026-08-30' })).toBe('ISW-1 due 2026-08-30');
  });

  it('escapes XML in the generated script', () => {
    const script = toastScript([{ ...EVENT, summary: 'a & b', kind: 'assigned', to: '<x>' }]);
    expect(script).toContain('&amp;');
    expect(script).not.toContain('summary>a & b');
    expect(script).toContain('1 change on your dashboard');
  });
});

describe('startWatchTimer', () => {
  it('runs a catch-up cycle at once and notifies only when there are events', async () => {
    const notify = vi.fn();
    const runCycle = vi.fn(async () => [EVENT]);
    const stop = startWatchTimer({
      watch: { runCycle, getConfig: () => ({ enabled: true, intervalMinutes: 5 }) },
      notify,
    });
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledOnce());
    expect(notify).toHaveBeenCalledWith([EVENT]);
    stop();
  });

  it('stays silent when the cycle throws', async () => {
    const notify = vi.fn();
    const runCycle = vi.fn(async () => {
      throw new Error('offline');
    });
    const stop = startWatchTimer({
      watch: { runCycle, getConfig: () => ({ enabled: true, intervalMinutes: 5 }) },
      notify,
    });
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledOnce());
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it('skips the cycle entirely while disabled', async () => {
    const runCycle = vi.fn(async () => [EVENT]);
    const stop = startWatchTimer({
      watch: { runCycle, getConfig: () => ({ enabled: false, intervalMinutes: 5 }) },
      notify: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runCycle).not.toHaveBeenCalled();
    stop();
  });

  it('survives a config read that throws instead of taking the process down', async () => {
    const runCycle = vi.fn(async () => [EVENT]);
    const getConfig = vi.fn(() => {
      throw new Error('no such table: KvLists');
    });
    const stop = startWatchTimer({ watch: { runCycle, getConfig }, notify: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getConfig).toHaveBeenCalled();
    expect(runCycle).not.toHaveBeenCalled();
    stop();
  });
});
