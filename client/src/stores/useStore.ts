import { useRef, useSyncExternalStore } from 'react';
import type { Store } from './store';

/** React hook: subscribe to a Store and re-render on change. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.get(),
    () => store.get(),
  );
}

/**
 * Slice subscription: re-render only when the selected value changes
 * (Object.is, or a custom isEqual). Every trStore patch replaces the whole
 * store object, so plain useStore re-renders every consumer on any change —
 * use this in hot views.
 */
export function useStoreSelector<T, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const cache = useRef<{ value: S } | null>(null);
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => {
      const next = selector(store.get());
      if (cache.current && isEqual(cache.current.value, next)) return cache.current.value;
      cache.current = { value: next };
      return next;
    },
    () => selector(store.get()),
  );
}
