import { useSyncExternalStore } from 'react';
import type { Store } from './store';

/** React hook: subscribe to a Store and re-render on change. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.get(),
    () => store.get(),
  );
}
