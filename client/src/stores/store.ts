// Tiny observable store + event emitter. No external state library.

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const l of [...listeners]) l(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface Emitter<T = void> {
  emit(payload: T): void;
  on(listener: (payload: T) => void): () => void;
}

export function createEmitter<T = void>(): Emitter<T> {
  const listeners = new Set<(payload: T) => void>();
  return {
    emit(payload) {
      for (const l of [...listeners]) l(payload);
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
