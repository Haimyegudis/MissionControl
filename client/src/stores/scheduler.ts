// RefreshScheduler (ui-parity §12.11) — interval timer, min 5s, allowed UI
// intervals 15/30/60/120/300. Pauses while the page is hidden when
// settings.pauseWhenMinimized, and fires a catch-up tick the moment it comes
// back. Tick event bus + triggerNow + lastRefresh.

import { createEmitter, createStore } from './store';
import { settingsStore } from './settings';

export const ALLOWED_INTERVALS_SECONDS = [15, 30, 60, 120, 300] as const;
export const MIN_INTERVAL_SECONDS = 5;

const tickBus = createEmitter<void>();

export const lastRefreshStore = createStore<Date | null>(null);

/** What the header's live indicator reports. */
export type SchedulerState = 'running' | 'paused' | 'off';

export const schedulerStateStore = createStore<SchedulerState>('off');

let timer: ReturnType<typeof setInterval> | null = null;
let currentIntervalSeconds = 0;
let running = false;
let pausedByVisibility = false;
let wired = false;

function publishState(): void {
  schedulerStateStore.set(!running ? 'off' : pausedByVisibility ? 'paused' : 'running');
}

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
  publishState();
}

export function stop(): void {
  running = false;
  clearTimer();
  publishState();
}

export function pause(): void {
  if (pausedByVisibility) return;
  pausedByVisibility = true;
  clearTimer();
  publishState();
}

/**
 * Leave the paused state. The elapsed hidden time is unbounded, so whatever is
 * on screen is by definition stale: catch up immediately rather than making the
 * user stare at old data for another full interval (the bug this fixes).
 */
export function resume(): void {
  if (!pausedByVisibility) return;
  pausedByVisibility = false;
  publishState();
  if (!running) return;
  fireTick();
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

/**
 * Page-visibility reaction, split out so it is testable without a DOM.
 *
 * `hidden` is true for any non-foreground tab, not just a minimized window —
 * the setting is named after the WPF app it was ported from. Honouring it is
 * still correct (a tab nobody is looking at should not poll Jira), but only
 * because resume() catches up on the way back.
 */
export function applyVisibility(hidden: boolean): void {
  if (hidden && settingsStore.get().pauseWhenMinimized) pause();
  else if (!hidden) resume();
}

/** Wire visibility pause + settings reactions. Safe to call more than once. */
export function initScheduler(): void {
  if (!wired) {
    wired = true;
    settingsStore.subscribe(() => syncFromSettings());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => applyVisibility(document.hidden));
    }
  }
  syncFromSettings();
  // A tab restored from the session, or opened in the background, never emits a
  // visibilitychange — seed from the current state instead of assuming visible.
  if (typeof document !== 'undefined' && document.hidden) applyVisibility(true);
}

/** Test seam: drop all timers and wiring. */
export function resetSchedulerForTests(): void {
  clearTimer();
  running = false;
  pausedByVisibility = false;
  currentIntervalSeconds = 0;
  wired = false;
  lastRefreshStore.set(null);
  publishState();
}
