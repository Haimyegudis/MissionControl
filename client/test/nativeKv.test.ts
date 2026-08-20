import { describe, expect, it, vi } from 'vitest';
import type { KvRecord, KvTable } from '@mc/core';
import { HydratedKvStore, type KvPersistence } from '../src/native/kvStore';

function fakePersistence() {
  const store = new Map<KvTable, Array<[string, KvRecord]>>();
  const impl: KvPersistence = {
    read: async (t) => store.get(t) ?? null,
    write: async (t, e) => {
      store.set(t, e);
    },
  };
  return { store, impl, factory: () => impl };
}

describe('HydratedKvStore', () => {
  it('serves reads from memory after hydrate', async () => {
    const p = fakePersistence();
    p.store.set('appSettings', [['1', { json: '{"Theme":"Light"}', updatedAt: 5 }]]);
    const kv = new HydratedKvStore(p.factory, 0);
    await kv.hydrate();
    expect(kv.get('appSettings', '1')).toEqual({ json: '{"Theme":"Light"}', updatedAt: 5 });
  });

  it('makes a written value readable synchronously, before the flush lands', () => {
    const kv = new HydratedKvStore(fakePersistence().factory, 1000);
    kv.set('trCache', 'runs', '[]', 7);
    expect(kv.get('trCache', 'runs')).toEqual({ json: '[]', updatedAt: 7 });
  });

  it('flushes the mutated table to persistence', async () => {
    const p = fakePersistence();
    const kv = new HydratedKvStore(p.factory, 0);
    kv.set('trCache', 'runs', '[1]', 7);
    await kv.flush();
    expect(p.store.get('trCache')).toEqual([['runs', { json: '[1]', updatedAt: 7 }]]);
  });

  it('coalesces rapid writes to one table into a single flush', async () => {
    const p = fakePersistence();
    const spy = vi.spyOn(p.impl, 'write');
    const kv = new HydratedKvStore(() => p.impl, 0);
    kv.set('trCache', 'a', '1', 1);
    kv.set('trCache', 'b', '2', 2);
    await kv.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('flushes each mutated table exactly once', async () => {
    const p = fakePersistence();
    const spy = vi.spyOn(p.impl, 'write');
    const kv = new HydratedKvStore(() => p.impl, 0);
    kv.set('trCache', 'a', '1', 1);
    kv.set('issueCache', 'b', '2', 2);
    await kv.flush();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not write a table that was never touched', async () => {
    const p = fakePersistence();
    const spy = vi.spyOn(p.impl, 'write');
    const kv = new HydratedKvStore(() => p.impl, 0);
    await kv.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('persists a delete and a clear, not just a set', async () => {
    const p = fakePersistence();
    const kv = new HydratedKvStore(p.factory, 0);
    kv.set('trCache', 'a', '1', 1);
    await kv.flush();
    kv.clear('trCache');
    await kv.flush();
    expect(p.store.get('trCache')).toEqual([]);
  });

  it('survives a persistence read failure by starting empty', async () => {
    const kv = new HydratedKvStore(
      () => ({
        read: async () => {
          throw new Error('io');
        },
        write: async () => {},
      }),
      0,
    );
    await expect(kv.hydrate()).resolves.toBeUndefined();
    expect(kv.get('appSettings', '1')).toBeNull();
  });

  it('survives a persistence write failure without throwing at the caller', async () => {
    const kv = new HydratedKvStore(
      () => ({
        read: async () => null,
        write: async () => {
          throw new Error('disk full');
        },
      }),
      0,
    );
    kv.set('trCache', 'a', '1', 1);
    await expect(kv.flush()).resolves.toBeUndefined();
    expect(kv.get('trCache', 'a')).not.toBeNull();
  });
});
