// Dashboard change feed store. Polls /api/watch/feed on scheduler ticks; the
// cycle itself runs server-side (desktop) or in the Android worker, so this
// only ever reads.

import { watch } from '../api/client';
import type { WatchFeed } from '../types';
import { createStore } from './store';
import { onTick } from './scheduler';

const EMPTY: WatchFeed = { events: [], unreadCount: 0, lastCycle: null };

export const watchStore = createStore<WatchFeed>(EMPTY);

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
    // The badge is the user's own read state — clear it locally even if the
    // write failed, rather than leaving a count they just dismissed.
    watchStore.set({ ...watchStore.get(), unreadCount: 0 });
  }
}

/** Force a cycle now ("Check now" in Settings), then repaint the feed. */
export async function runWatchCycleNow(): Promise<number> {
  const result = await watch.run();
  watchStore.set({ events: result.events, unreadCount: result.unreadCount, lastCycle: result.lastCycle });
  return result.count;
}

export function resetWatchFeed(): void {
  watchStore.set(EMPTY);
}

/** Wire the feed to scheduler ticks. Call once the session is connected. */
export function initWatchFeed(): void {
  void refreshWatchFeed();
  onTick(() => void refreshWatchFeed());
}
