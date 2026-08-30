import { describe, expect, it } from 'vitest';
import { MemoryKvStore, MemoryPeopleStore } from '../src/storage/kv.js';
import { TestRailNotConnectedError, TestRailService, parsePeople } from '../src/testrail/service.js';

describe('TestRailService over KV ports', () => {
  it('constructs without a database and reports disconnected', () => {
    const svc = new TestRailService(new MemoryKvStore(), new MemoryPeopleStore());
    expect(svc.isConnected).toBe(false);
    expect(svc.status()).toEqual({ connected: false, baseUrl: null, email: null, user: null });
    expect(() => svc.requireClient()).toThrow(TestRailNotConnectedError);
  });

  it('seeds people from the legacy loader only when the store is empty', () => {
    const people = new MemoryPeopleStore();
    const svc = new TestRailService(new MemoryKvStore(), people, undefined, () => [{ id: 7, name: 'Dana' }]);
    svc.importLegacyPeopleIfEmpty();
    expect(people.all()).toEqual([{ id: 7, name: 'Dana' }]);
  });

  it('does not overwrite an existing people store', () => {
    const people = new MemoryPeopleStore();
    people.upsertMany([{ id: 1, name: 'Existing' }]);
    const svc = new TestRailService(new MemoryKvStore(), people, undefined, () => [{ id: 7, name: 'Dana' }]);
    svc.importLegacyPeopleIfEmpty();
    expect(people.all()).toEqual([{ id: 1, name: 'Existing' }]);
  });

  it('tolerates a loader that finds nothing', () => {
    const people = new MemoryPeopleStore();
    new TestRailService(new MemoryKvStore(), people).importLegacyPeopleIfEmpty();
    expect(people.all()).toEqual([]);
  });

  it('getPeople exposes the store as an id to name map', () => {
    const people = new MemoryPeopleStore();
    people.upsertMany([{ id: 3, name: 'Ravi' }]);
    expect(new TestRailService(new MemoryKvStore(), people).getPeople()).toEqual({ '3': 'Ravi' });
  });

  it('setPeople replaces the whole set', () => {
    const people = new MemoryPeopleStore();
    people.upsertMany([{ id: 1, name: 'Gone' }]);
    new TestRailService(new MemoryKvStore(), people).setPeople({ '9': 'Kept' });
    expect(people.all()).toEqual([{ id: 9, name: 'Kept' }]);
  });

  it('serves a stale cases entry once and revalidates it behind the response', async () => {
    const kv = new MemoryKvStore();
    const svc = new TestRailService(kv, new MemoryPeopleStore());
    kv.set('trCache', 'cases:1:2', JSON.stringify(['old']), Date.now() - 4 * 60_000);
    const served = await svc.cachedJson('cases:1:2', async () => ['new'], false);
    expect(served).toEqual(['old']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(kv.get('trCache', 'cases:1:2')!.json)).toEqual(['new']);
  });

  it('serves a stale sections entry once and revalidates it behind the response', async () => {
    const kv = new MemoryKvStore();
    const svc = new TestRailService(kv, new MemoryPeopleStore());
    kv.set('trCache', 'sections:1:2', JSON.stringify(['old']), Date.now() - 4 * 60_000);
    const served = await svc.cachedJson('sections:1:2', async () => ['new'], false);
    expect(served).toEqual(['old']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(kv.get('trCache', 'sections:1:2')!.json)).toEqual(['new']);
  });

  it('does not refetch a cases entry younger than its TTL', async () => {
    const kv = new MemoryKvStore();
    const svc = new TestRailService(kv, new MemoryPeopleStore());
    kv.set('trCache', 'cases:1:2', JSON.stringify(['old']), Date.now() - 60_000);
    let fetched = false;
    const served = await svc.cachedJson('cases:1:2', async () => {
      fetched = true;
      return ['new'];
    }, false);
    expect(served).toEqual(['old']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetched).toBe(false);
  });

  it('clearCache empties only the TestRail table', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'projects', '[]', 1);
    kv.set('issueCache', 'mywork', '[]', 1);
    new TestRailService(kv, new MemoryPeopleStore()).clearCache();
    expect(kv.get('trCache', 'projects')).toBeNull();
    expect(kv.get('issueCache', 'mywork')).not.toBeNull();
  });
});

describe('parsePeople', () => {
  it('keeps numeric keys with string values and skips the rest', () => {
    expect(parsePeople({ '1': 'A', x: 'B', '2': 3 })).toEqual([{ id: 1, name: 'A' }]);
  });
});
