// Pomodoro (ui-parity §13.7) — Idle / Running on {key} / Paused on {key}.
// 1s elapsed tick; pause accumulates; stop ≥60s posts a worklog (failures
// logged, not thrown). Stop returns elapsed seconds for confirmation.

import { issues } from '../api/client';
import { createStore } from './store';

export type PomodoroPhase = 'idle' | 'running' | 'paused';

export interface PomodoroState {
  phase: PomodoroPhase;
  issueKey: string | null;
  /** Whole seconds elapsed (accumulated across pauses). */
  elapsedSeconds: number;
}

export const pomodoroStore = createStore<PomodoroState>({
  phase: 'idle',
  issueKey: null,
  elapsedSeconds: 0,
});

let timer: ReturnType<typeof setInterval> | null = null;
/** Seconds accumulated before the current running segment. */
let accumulated = 0;
/** Wall-clock start of the current running segment (ms). */
let segmentStartMs = 0;

function currentElapsedSeconds(): number {
  const state = pomodoroStore.get();
  if (state.phase === 'running') {
    return accumulated + Math.floor((Date.now() - segmentStartMs) / 1000);
  }
  return accumulated;
}

function clearTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function tick(): void {
  pomodoroStore.set((prev) => ({ ...prev, elapsedSeconds: currentElapsedSeconds() }));
}

export function statusText(state: PomodoroState = pomodoroStore.get()): string {
  switch (state.phase) {
    case 'running':
      return `Running on ${state.issueKey}`;
    case 'paused':
      return `Paused on ${state.issueKey}`;
    default:
      return 'Idle';
  }
}

export function startPomodoro(issueKey: string): void {
  clearTimer();
  accumulated = 0;
  segmentStartMs = Date.now();
  pomodoroStore.set({ phase: 'running', issueKey, elapsedSeconds: 0 });
  timer = setInterval(tick, 1000);
}

export function pausePomodoro(): void {
  const state = pomodoroStore.get();
  if (state.phase !== 'running') return;
  accumulated = currentElapsedSeconds();
  clearTimer();
  pomodoroStore.set({ ...state, phase: 'paused', elapsedSeconds: accumulated });
}

export function resumePomodoro(): void {
  const state = pomodoroStore.get();
  if (state.phase !== 'paused') return;
  segmentStartMs = Date.now();
  pomodoroStore.set({ ...state, phase: 'running' });
  timer = setInterval(tick, 1000);
}

/**
 * Stop the pomodoro. If elapsed ≥ 60s, posts a worklog for the tracked issue
 * (started = now − elapsed). Worklog failures are logged, never thrown.
 * Returns elapsed seconds.
 */
export async function stopPomodoro(comment?: string): Promise<number> {
  const state = pomodoroStore.get();
  const elapsed = currentElapsedSeconds();
  const issueKey = state.issueKey;
  clearTimer();
  accumulated = 0;
  pomodoroStore.set({ phase: 'idle', issueKey: null, elapsedSeconds: 0 });

  if (issueKey && elapsed >= 60) {
    const started = new Date(Date.now() - elapsed * 1000).toISOString();
    try {
      await issues.addWorklog(issueKey, { seconds: elapsed, started, comment });
    } catch (err) {
      console.error(`Pomodoro: failed to log ${elapsed}s on ${issueKey}`, err);
    }
  }
  return elapsed;
}
