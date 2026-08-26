// Watch feed store: loads the feed, clears the unread count on ack, and keeps
// the last good feed when a poll fails.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const feedResponse = {
  events: [
    {
      id: 'ISW-1:status:2026-08-23T10:00:00.000Z',
      kind: 'status' as const,
      key: 'ISW-1',
      summary: 'Fix',
      from: 'To Do',
      to: 'In Progress',
      at: '2026-08-23T10:00:00.000Z',
    },
  ],
  unreadCount: 1,
  lastCycle: '2026-08-23T10:00:00.000Z',
};

vi.mock('../src/api/client', () => ({
  watch: {
    feed: vi.fn(async () => feedResponse),
    ack: vi.fn(async () => ({ ...feedResponse, unreadCount: 0 })),
    run: vi.fn(async () => ({ ...feedResponse, count: 1 })),
    clear: vi.fn(async () => ({ events: [], unreadCount: 0, lastCycle: feedResponse.lastCycle })),
  },
}));

vi.mock('../src/stores/scheduler', () => ({ onTick: vi.fn(() => () => {}) }));

import { watch } from '../src/api/client';
import { ackWatchFeed, clearWatchFeed, refreshWatchFeed, watchStore } from '../src/stores/watch';

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
    expect(watchStore.get().events).toHaveLength(1);
  });

  it('leaves the last good feed in place when the request fails', async () => {
    await refreshWatchFeed();
    (watch.feed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await refreshWatchFeed();
    expect(watchStore.get().events).toHaveLength(1);
  });

  it('still clears the badge when the ack request fails', async () => {
    await refreshWatchFeed();
    (watch.ack as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await ackWatchFeed();
    expect(watchStore.get().unreadCount).toBe(0);
  });

  it('empties the feed on clear all', async () => {
    await refreshWatchFeed();
    await clearWatchFeed();
    expect(watchStore.get().events).toEqual([]);
    expect(watchStore.get().unreadCount).toBe(0);
  });

  it('still empties the feed locally when the clear request fails', async () => {
    await refreshWatchFeed();
    (watch.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await clearWatchFeed();
    expect(watchStore.get().events).toEqual([]);
    expect(watchStore.get().unreadCount).toBe(0);
  });
});
