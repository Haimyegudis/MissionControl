import { describe, expect, it } from 'vitest';
import { MemoryKvStore, MemoryPeopleStore } from '../src/storage/kv.js';
import { AppSettingsRepo, IssueCacheRepo, MetadataCacheRepo } from '../src/storage/repos.js';
import type { JiraIssue } from '../src/types.js';

const FIXED = 1_700_000_000_000;

function issue(key: string): JiraIssue {
  return { key, summary: `s-${key}` } as JiraIssue;
}

describe('MemoryKvStore', () => {
  it('round-trips a value and stamps updatedAt from the injected clock', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'runs', '{"a":1}', FIXED);
    expect(kv.get('trCache', 'runs')).toEqual({ json: '{"a":1}', updatedAt: FIXED });
  });

  it('returns null for a missing key and isolates tables', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'k', '1', FIXED);
    expect(kv.get('trCache', 'missing')).toBeNull();
    expect(kv.get('issueCache', 'k')).toBeNull();
  });

  it('delete removes one key, clear removes only the named table', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'a', '1', FIXED);
    kv.set('trCache', 'b', '2', FIXED);
    kv.set('issueCache', 'a', '3', FIXED);
    kv.delete('trCache', 'a');
    expect(kv.get('trCache', 'a')).toBeNull();
    expect(kv.get('trCache', 'b')?.json).toBe('2');
    kv.clear('trCache');
    expect(kv.get('trCache', 'b')).toBeNull();
    expect(kv.get('issueCache', 'a')?.json).toBe('3');
  });

  it('snapshot and restore round-trip a whole table', () => {
    const kv = new MemoryKvStore();
    kv.set('metadataCache', 'projects', '["A"]', FIXED);
    const other = new MemoryKvStore();
    other.restore('metadataCache', kv.snapshot('metadataCache'));
    expect(other.get('metadataCache', 'projects')).toEqual({ json: '["A"]', updatedAt: FIXED });
  });
});

describe('MemoryPeopleStore', () => {
  it('upserts by id and returns them sorted', () => {
    const people = new MemoryPeopleStore();
    people.upsertMany([
      { id: 2, name: 'B' },
      { id: 1, name: 'A' },
    ]);
    people.upsertMany([{ id: 2, name: 'B2' }]);
    expect(people.all()).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B2' },
    ]);
    people.clear();
    expect(people.all()).toEqual([]);
  });
});

describe('AppSettingsRepo over KvStore', () => {
  it('returns full defaults when nothing is stored', () => {
    expect(new AppSettingsRepo(new MemoryKvStore()).get().theme).toBe('Dark');
  });

  it('merges stored values over defaults', () => {
    const kv = new MemoryKvStore();
    const repo = new AppSettingsRepo(kv);
    repo.save({ ...repo.get(), theme: 'Light' });
    expect(new AppSettingsRepo(kv).get().theme).toBe('Light');
  });

  it('writes PascalCase keys into the blob', () => {
    const kv = new MemoryKvStore();
    const repo = new AppSettingsRepo(kv);
    repo.save({ ...repo.get(), theme: 'Light' });
    const row = kv.get('appSettings', '1');
    expect(row).not.toBeNull();
    expect(JSON.parse(row?.json ?? '{}').Theme).toBe('Light');
  });

  it('falls back to defaults on corrupt JSON', () => {
    const kv = new MemoryKvStore();
    kv.set('appSettings', '1', 'not json', FIXED);
    expect(new AppSettingsRepo(kv).get().theme).toBe('Dark');
  });

  it('falls back to defaults when the blob is an array', () => {
    const kv = new MemoryKvStore();
    kv.set('appSettings', '1', '[]', FIXED);
    expect(new AppSettingsRepo(kv).get().theme).toBe('Dark');
  });
});

describe('IssueCacheRepo over KvStore', () => {
  it('round-trips issues and exposes the write time', () => {
    const repo = new IssueCacheRepo(new MemoryKvStore(), () => FIXED);
    repo.saveCache('mywork', [issue('AAA-1')]);
    expect(repo.getCached('mywork').map((i) => i.key)).toEqual(['AAA-1']);
    expect(repo.getLastRefresh('mywork')?.getTime()).toBe(FIXED);
  });

  it('returns an empty array and a null refresh time for an unknown key', () => {
    const repo = new IssueCacheRepo(new MemoryKvStore());
    expect(repo.getCached('nope')).toEqual([]);
    expect(repo.getLastRefresh('nope')).toBeNull();
  });

  it('returns an empty array for a non-array blob', () => {
    const kv = new MemoryKvStore();
    kv.set('issueCache', 'mywork', '{"not":"an array"}', FIXED);
    expect(new IssueCacheRepo(kv).getCached('mywork')).toEqual([]);
  });

  it('clearAll empties the cache', () => {
    const kv = new MemoryKvStore();
    const repo = new IssueCacheRepo(kv, () => FIXED);
    repo.saveCache('mywork', [issue('AAA-1')]);
    repo.clearAll();
    expect(repo.getCached('mywork')).toEqual([]);
  });
});

describe('MetadataCacheRepo over KvStore', () => {
  it('stores a pre-serialized string and returns a Date', () => {
    const repo = new MetadataCacheRepo(new MemoryKvStore(), () => FIXED);
    repo.set('projects', '["A"]');
    expect(repo.get('projects')).toEqual({ json: '["A"]', updatedUtc: new Date(FIXED) });
  });

  it('delete removes one key and clearAll removes everything', () => {
    const repo = new MetadataCacheRepo(new MemoryKvStore(), () => FIXED);
    repo.set('a', '1');
    repo.set('b', '2');
    repo.delete('a');
    expect(repo.get('a')).toBeNull();
    expect(repo.get('b')?.json).toBe('2');
    repo.clearAll();
    expect(repo.get('b')).toBeNull();
  });
});
