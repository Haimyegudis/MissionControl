// Toast stack (ui-parity §10.8) — auto-dismiss 8s.

import { createStore } from './store';

export interface Toast {
  id: number;
  title: string;
  body: string;
}

export const toastsStore = createStore<Toast[]>([]);

let nextId = 1;

export function pushToast(input: { title: string; body: string; duration?: number }): number {
  const id = nextId++;
  const toast: Toast = { id, title: input.title, body: input.body };
  toastsStore.set((prev) => [...prev, toast]);
  const duration = input.duration ?? 8000;
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id: number): void {
  toastsStore.set((prev) => (prev.some((t) => t.id === id) ? prev.filter((t) => t.id !== id) : prev));
}
