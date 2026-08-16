// Toast stack (ui-parity §10.8) — auto-dismiss 8s, severity variants, an
// optional action (Undo), a retained history feed for the notification bell,
// and the Settings notification switches (mute all / critical only) actually
// applied here.

import { getSettings } from './settings';
import { createStore } from './store';

export type ToastSeverity = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  title: string;
  body: string;
  severity: ToastSeverity;
  action?: ToastAction;
}

export interface ToastHistoryEntry {
  id: number;
  title: string;
  body: string;
  severity: ToastSeverity;
  at: number;
}

const HISTORY_CAP = 100;

export const toastsStore = createStore<Toast[]>([]);
/** Everything pushed this session, newest first — the bell's feed. */
export const toastHistoryStore = createStore<ToastHistoryEntry[]>([]);
/** Timestamp of the user's last look at the bell (unread badge cutoff). */
export const toastSeenStore = createStore<number>(Date.now());

let nextId = 1;

/** Guess severity from the title when the caller didn't say. */
function inferSeverity(title: string, body: string): ToastSeverity {
  const t = `${title} ${body}`.toLowerCase();
  if (/fail|error|invalid|denied|unable|cannot|✕/.test(t)) return 'error';
  if (/created|updated|saved|deleted|recorded|logged|scheduled|copied|moved|✓/.test(t)) return 'success';
  return 'info';
}

export function pushToast(input: {
  title: string;
  body: string;
  duration?: number;
  severity?: ToastSeverity;
  action?: ToastAction;
}): number {
  const id = nextId++;
  const severity = input.severity ?? inferSeverity(input.title, input.body);

  // History records everything, muted or not — the bell is the audit trail.
  toastHistoryStore.set((prev) =>
    [{ id, title: input.title, body: input.body, severity, at: Date.now() }, ...prev].slice(0, HISTORY_CAP),
  );

  // Notification settings (Settings → Notifications) finally do something.
  try {
    const s = getSettings();
    if (s.muteAll) return id;
    if (s.criticalOnly && severity !== 'error') return id;
    if (s.inAppNotifications === false && severity !== 'error') return id;
  } catch {
    /* settings unavailable → show */
  }

  const toast: Toast = { id, title: input.title, body: input.body, severity, action: input.action };
  toastsStore.set((prev) => [...prev, toast]);
  const duration = input.duration ?? (input.action ? 12000 : 8000);
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id: number): void {
  toastsStore.set((prev) => (prev.some((t) => t.id === id) ? prev.filter((t) => t.id !== id) : prev));
}

export function markToastsSeen(): void {
  toastSeenStore.set(Date.now());
}
