// RefreshScheduler (ui-parity §12.11) — interval timer, min 5s, allowed UI
// intervals 15/30/60/300. Pauses while document.hidden when
// settings.pauseWhenMinimized. Tick event bus + triggerNow + lastRefresh.

import { createEmitter, createStore } from './store';
import { settingsStore } from './settings';

export const ALLOWED_INTERVALS_SECONDS = [15, 30, 60, 300] as const;
export const MIN_INTERVAL_SECONDS = 5;

const tickBus = createEmitter<void>();

export const lastRefreshStore = createStore<Date | null>(null);

let timer: ReturnType<typeof setInterval> | null = null;
let currentIntervalSeconds = 0;
let running = false;
let pausedByVisibility = false;

function fireTick(): void {
  lastRefreshStore.set(new Date());
  tickBus.emit();
}

function clearTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function armTimer(): void {
  clearTimer();
  if (!running || pausedByVisibility) return;
  timer = setInterval(fireTick, currentIntervalSeconds * 1000);
}

/** Subscribe to scheduler ticks. Returns an unsubscribe fn. */
export function onTick(cb: () => void): () => void {
  return tickBus.on(cb);
}

/** Start (or restart) the scheduler. Interval clamps to a 5s minimum. */
export function start(intervalSeconds: number): void {
  currentIntervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Math.floor(intervalSeconds) || MIN_INTERVAL_SECONDS);
  running = true;
  armTimer();
}

export function stop(): void {
  running = false;
  clearTimer();
}

export function pause(): void {
  pausedByVisibility = true;
  clearTimer();
}

export function resume(): void {
  pausedByVisibility = false;
  armTimer();
}

/** Fire a tick immediately and restart the interval from now. */
export function triggerNow(): void {
  fireTick();
  armTimer();
}

export function isRunning(): boolean {
  return running && !pausedByVisibility;
}

export function getLastRefresh(): Date | null {
  return lastRefreshStore.get();
}

/** Apply current AppSettings to the scheduler (start/stop + interval). */
export function syncFromSettings(): void {
  const s = settingsStore.get();
  if (s.autoRefreshEnabled) {
    if (!running || currentIntervalSeconds !== Math.max(MIN_INTERVAL_SECONDS, s.refreshIntervalSeconds)) {
      start(s.refreshIntervalSeconds);
    }
  } else {
    stop();
  }
}

/** Wire visibility pause + settings reactions. Call once on boot. */
export function initScheduler(): void {
  settingsStore.subscribe(() => syncFromSettings());
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      const s = settingsStore.get();
      if (document.hidden && s.pauseWhenMinimized) pause();
      else if (!document.hidden && pausedByVisibility) resume();
    });
  }
  syncFromSettings();
}
