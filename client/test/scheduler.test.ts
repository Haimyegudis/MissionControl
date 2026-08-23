// RefreshScheduler behaviour. Regression cover for the "app never refreshes
// while it is open" bug: a hidden tab paused the interval and coming back
// re-armed it without ever firing, so the view stayed stale indefinitely.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings } from '../src/types';
import { settingsStore } from '../src/stores/settings';
import {
  ALLOWED_INTERVALS_SECONDS,
  applyVisibility,
  initScheduler,
  isRunning,
  onTick,
  pause,
  resetSchedulerForTests,
  resume,
  schedulerStateStore,
  start,
  stop,
} from '../src/stores/scheduler';

function setSettings(partial: Partial<ReturnType<typeof defaultAppSettings>>): void {
  settingsStore.set({ ...defaultAppSettings(), ...partial });
}

describe('RefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSchedulerForTests();
    setSettings({});
  });

  afterEach(() => {
    resetSchedulerForTests();
    vi.useRealTimers();
  });

  it('fires on the interval', () => {
    const ticks = vi.fn();
    const off = onTick(ticks);
    start(15);
    vi.advanceTimersByTime(45_000);
    expect(ticks).toHaveBeenCalledTimes(3);
    off();
  });

  it('stops ticking while paused', () => {
    const ticks = vi.fn();
    const off = onTick(ticks);
    start(15);
    pause();
    vi.advanceTimersByTime(60_000);
    expect(ticks).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
    off();
  });

  it('fires a catch-up tick the moment it resumes', () => {
    const ticks = vi.fn();
    const off = onTick(ticks);
    start(15);
    pause();
    vi.advanceTimersByTime(10 * 60_000);
    expect(ticks).not.toHaveBeenCalled();

    resume();
    expect(ticks).toHaveBeenCalledTimes(1); // no waiting out another interval
    vi.advanceTimersByTime(15_000);
    expect(ticks).toHaveBeenCalledTimes(2); // and the interval is armed again
    off();
  });

  it('does not restart the interval when resume is a no-op', () => {
    const ticks = vi.fn();
    const off = onTick(ticks);
    start(15);
    vi.advanceTimersByTime(10_000);
    resume(); // never paused — must not fire, must not re-arm from zero
    expect(ticks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(ticks).toHaveBeenCalledTimes(1);
    off();
  });

  it('honours pauseWhenMinimized, and ignores it when switched off', () => {
    start(15);
    applyVisibility(true);
    expect(isRunning()).toBe(false);
    applyVisibility(false);
    expect(isRunning()).toBe(true);

    setSettings({ pauseWhenMinimized: false });
    applyVisibility(true);
    expect(isRunning()).toBe(true);
  });

  it('resuming while auto-refresh is off does not start polling', () => {
    const ticks = vi.fn();
    const off = onTick(ticks);
    pause();
    resume();
    vi.advanceTimersByTime(60_000);
    expect(ticks).not.toHaveBeenCalled();
    off();
  });

  it('reports its state for the header indicator', () => {
    expect(schedulerStateStore.get()).toBe('off');
    start(15);
    expect(schedulerStateStore.get()).toBe('running');
    pause();
    expect(schedulerStateStore.get()).toBe('paused');
    resume();
    expect(schedulerStateStore.get()).toBe('running');
    stop();
    expect(schedulerStateStore.get()).toBe('off');
  });

  it('initScheduler is idempotent and starts from settings', () => {
    initScheduler();
    initScheduler();
    const ticks = vi.fn();
    const off = onTick(ticks);
    vi.advanceTimersByTime(defaultAppSettings().refreshIntervalSeconds * 1000);
    expect(ticks).toHaveBeenCalledTimes(1); // not twice from a doubled wiring
    off();
  });

  it('offers the default interval as a selectable option', () => {
    expect(ALLOWED_INTERVALS_SECONDS).toContain(defaultAppSettings().refreshIntervalSeconds);
  });
});
