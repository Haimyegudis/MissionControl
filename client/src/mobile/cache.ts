// Stale-while-revalidate cache for mobile screens.
//
// The complaint was that pages take too long and a phone user will not wait.
// Three things were wrong:
//
//   1. Every screen fetched on mount with no memory, so leaving a tab and
//      coming back paid full price again.
//   2. Nothing was shared between screens, so Dashboard and Incidents each
//      issued their own Jira searches.
//   3. There was no way to show something immediately while refreshing.
//
// This fixes all three: the cache is module-level so it survives unmount and
// tab switches, entries are shared by key, and a cached value renders straight
// away while a refresh runs behind it. The user sees data instantly and it
// quietly becomes current.

import { useCallback, useEffect, useRef, useState } from 'react';

interface Entry<T> {
  value: T | undefined;
  at: number;
  error: string | null;
  inflight: Promise<unknown> | null;
  subscribers: Set<() => void>;
}

const store = new Map<string, Entry<unknown>>();

function entryFor<T>(key: string): Entry<T> {
  let e = store.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { value: undefined, at: 0, error: null, inflight: null, subscribers: new Set() };
    store.set(key, e as Entry<unknown>);
  }
  return e;
}

function notify(e: Entry<unknown>): void {
  for (const fn of [...e.subscribers]) fn();
}

/** Drop cached data. Called after a write so the next read is authoritative. */
export function invalidate(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      const e = store.get(key);
      if (e) {
        e.at = 0;
        e.value = undefined;
      }
    }
  }
}

/** Warm a key without rendering it — used to prefetch the next likely tab. */
export function prefetch<T>(key: string, loader: () => Promise<T>, ttlMs = 60_000): void {
  const e = entryFor<T>(key);
  if (e.inflight || Date.now() - e.at < ttlMs) return;
  e.inflight = loader()
    .then((value) => {
      e.value = value;
      e.at = Date.now();
      e.error = null;
    })
    .catch(() => undefined)
    .finally(() => {
      e.inflight = null;
      notify(e as Entry<unknown>);
    });
}

export interface Cached<T> {
  data: T | undefined;
  /** True only when there is nothing to show yet. */
  loading: boolean;
  /** True while a background refresh runs over existing data. */
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Read a key, rendering any cached value immediately.
 *
 * `deps` is part of the identity of the request — change the project id and
 * you are asking a different question, so it belongs in the key.
 */
export function useCached<T>(
  key: string,
  loader: () => Promise<T>,
  { ttlMs = 60_000, enabled = true }: { ttlMs?: number; enabled?: boolean } = {},
): Cached<T> {
  const e = entryFor<T>(key);
  const [, bump] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    e.subscribers.add(onChange);
    return () => {
      e.subscribers.delete(onChange);
    };
  }, [e]);

  const run = useCallback(
    (force: boolean) => {
      if (!enabled) return;
      if (e.inflight) return;
      if (!force && e.value !== undefined && Date.now() - e.at < ttlMs) return;
      e.inflight = loaderRef.current()
        .then((value) => {
          e.value = value;
          e.at = Date.now();
          e.error = null;
        })
        .catch((err: unknown) => {
          e.error = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          e.inflight = null;
          notify(e as Entry<unknown>);
        });
      notify(e as Entry<unknown>);
    },
    [e, enabled, ttlMs],
  );

  useEffect(() => {
    run(false);
  }, [run]);

  return {
    data: e.value,
    loading: e.value === undefined && (e.inflight !== null || (enabled && e.at === 0 && e.error === null)),
    refreshing: e.inflight !== null && e.value !== undefined,
    error: e.error,
    refresh: () => run(true),
  };
}
