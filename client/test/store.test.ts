import { describe, expect, it, vi } from 'vitest';
import { createEmitter, createStore } from '../src/stores/store';

describe('createStore', () => {
  it('get/set round-trip', () => {
    const store = createStore(1);
    expect(store.get()).toBe(1);
    store.set(2);
    expect(store.get()).toBe(2);
  });

  it('supports updater functions', () => {
    const store = createStore({ n: 1 });
    store.set((prev) => ({ n: prev.n + 1 }));
    expect(store.get()).toEqual({ n: 2 });
  });

  it('notifies subscribers and honors unsubscribe', () => {
    const store = createStore('a');
    const seen: string[] = [];
    const off = store.subscribe((v) => seen.push(v));
    store.set('b');
    off();
    store.set('c');
    expect(seen).toEqual(['b']);
  });

  it('skips notification when value is identical', () => {
    const store = createStore(5);
    const cb = vi.fn();
    store.subscribe(cb);
    store.set(5);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('createEmitter', () => {
  it('emits to listeners and honors unsubscribe', () => {
    const bus = createEmitter<number>();
    const seen: number[] = [];
    const off = bus.on((n) => seen.push(n));
    bus.emit(1);
    off();
    bus.emit(2);
    expect(seen).toEqual([1]);
  });
});
