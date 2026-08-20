import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../src/storage/db.js';
import { BoardWorkspaceRepo, PinnedBoardRepo, SavedFilterRepo, TeamRepo } from '../src/storage/repositories.js';
import { SqliteKvStore } from '../src/storage/sqliteKv.js';
import { AppSettingsRepo, IssueCacheRepo, MetadataCacheRepo } from '@mc/core';
import { CreateDefaultsStore, CreateMetaCache } from '../src/storage/fileStores.js';
import { defaultAppSettings } from '@mc/core';
import type { JiraIssue, SavedFilter, BoardWorkspace, Team, PinnedBoard } from '@mc/core';

function makeIssue(key: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key,
    summary: `Summary for ${key}`,
    issueType: 'Bug',
    status: 'Open',
    statusCategory: 'new',
    priority: 'High',
    assignee: 'Alice Smith',
    reporter: 'Bob Jones',
    projectKey: 'ISW',
    sprint: 'Sprint 42',
    created: '2026-08-01T10:00:00.000Z',
    updated: '2026-08-10T12:30:00.000Z',
    timeSpent: 3600,
    remainingEstimate: 7200,
    originalEstimate: 10800,
    epicKey: 'ISW-1',
    epicName: 'Big Epic',
    allSprints: [{ name: 'Sprint 42', state: 'active', startDate: '2026-08-01T00:00:00.000Z', endDate: null }],
    workLoggedForPeriod: null,
    labels: ['label1'],
    components: ['comp1'],
    fixVersions: ['1.0'],
    boardNames: [],
    boardIds: [],
    isBlocked: false,
    isCritical: true,
    recentlyChanged: false,
    rejectReasons: null,
    changeSummary: null,
    severity: null,
    ...overrides,
  };
}

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// AppSettingsRepo
// ---------------------------------------------------------------------------

describe('AppSettingsRepo', () => {
  it('get() returns full defaults when no row exists', () => {
    const repo = new AppSettingsRepo(new SqliteKvStore(db));
    expect(repo.get()).toEqual(defaultAppSettings());
  });

  it('save() then get() round-trips including dictionary keys untouched', () => {
    const repo = new AppSettingsRepo(new SqliteKvStore(db));
    const s = defaultAppSettings();
    s.theme = 'Light';
    s.refreshIntervalSeconds = 300;
    s.kanbanWipLimits = { 'In Progress': 3, 'code review': 2 };
    s.mcpServerEnv = { JIRA_PERSONAL_TOKEN: 'tok', lower_key: 'v' };
    s.recentIssues = [{ key: 'ISW-1', summary: 'One' }];
    s.recentIssueKeys = ['ISW-1'];
    s.savedQueries = [{ name: 'Mine', jql: 'assignee = currentUser()' }];
    s.starredIssueKeys = ['ISW-9'];
    repo.save(s);
    expect(repo.get()).toEqual(s);
  });

  it('stores PascalCase keys in the JSON blob (incl. nested), dictionary keys verbatim', () => {
    const repo = new AppSettingsRepo(new SqliteKvStore(db));
    const s = defaultAppSettings();
    s.kanbanWipLimits = { 'In Progress': 3 };
    s.mcpServerEnv = { JIRA_PERSONAL_TOKEN: 'tok' };
    s.recentIssues = [{ key: 'ISW-1', summary: 'One' }];
    s.savedQueries = [{ name: 'Mine', jql: 'x' }];
    repo.save(s);
    const row = db.prepare('SELECT Json FROM AppSettings WHERE Id = 1').get() as { Json: string };
    const raw = JSON.parse(row.Json);
    expect(raw.Theme).toBe('Dark');
    expect(raw.RefreshIntervalSeconds).toBe(120);
    expect(raw.theme).toBeUndefined();
    expect(raw.RecentIssues[0]).toEqual({ Key: 'ISW-1', Summary: 'One' });
    expect(raw.SavedQueries[0]).toEqual({ Name: 'Mine', Jql: 'x' });
    // dictionary keys must NOT be case-converted
    expect(raw.KanbanWipLimits).toEqual({ 'In Progress': 3 });
    expect(raw.McpServerEnv).toEqual({ JIRA_PERSONAL_TOKEN: 'tok' });
  });

  it('get() merges defaults for fields missing from a stored blob', () => {
    db.prepare('INSERT INTO AppSettings (Id, Json) VALUES (1, ?)').run(
      JSON.stringify({ Theme: 'Light', RefreshIntervalSeconds: 60 }),
    );
    const repo = new AppSettingsRepo(new SqliteKvStore(db));
    const s = repo.get();
    expect(s.theme).toBe('Light');
    expect(s.refreshIntervalSeconds).toBe(60);
    // everything else falls back to defaults
    expect(s.autoRefreshEnabled).toBe(true);
    expect(s.defaultProjectKey).toBe('ISW');
    expect(s.dashboardWidgets).toEqual(defaultAppSettings().dashboardWidgets);
    expect(s.kanbanWipLimits).toEqual({});
  });

  it('save() upserts the single row (Id = 1)', () => {
    const repo = new AppSettingsRepo(new SqliteKvStore(db));
    const s1 = defaultAppSettings();
    s1.theme = 'Light';
    repo.save(s1);
    const s2 = defaultAppSettings();
    s2.theme = 'Dark';
    repo.save(s2);
    const count = db.prepare('SELECT COUNT(*) AS c FROM AppSettings').get() as { c: number };
    expect(count.c).toBe(1);
    expect(repo.get().theme).toBe('Dark');
  });
});

// ---------------------------------------------------------------------------
// IssueCacheRepo
// ---------------------------------------------------------------------------

describe('IssueCacheRepo', () => {
  it('getCached() returns [] when key absent', () => {
    const repo = new IssueCacheRepo(new SqliteKvStore(db));
    expect(repo.getCached('mywork:x')).toEqual([]);
  });

  it('saveCache() then getCached() round-trips issues', () => {
    const repo = new IssueCacheRepo(new SqliteKvStore(db));
    const issues = [makeIssue('ISW-1'), makeIssue('ISW-2', { assignee: null, timeSpent: null })];
    repo.saveCache('mywork:x', issues);
    expect(repo.getCached('mywork:x')).toEqual(issues);
  });

  it('stores PascalCase keys in the blob', () => {
    const repo = new IssueCacheRepo(new SqliteKvStore(db));
    repo.saveCache('k', [makeIssue('ISW-1')]);
    const row = db.prepare('SELECT Json FROM IssueCache WHERE CacheKey = ?').get('k') as { Json: string };
    const raw = JSON.parse(row.Json);
    expect(raw[0].Key).toBe('ISW-1');
    expect(raw[0].key).toBeUndefined();
    expect(raw[0].AllSprints[0].Name).toBe('Sprint 42');
  });

  it('getLastRefresh() is null when absent, a recent Date after save', () => {
    const repo = new IssueCacheRepo(new SqliteKvStore(db));
    expect(repo.getLastRefresh('k')).toBeNull();
    const before = Date.now();
    repo.saveCache('k', [makeIssue('ISW-1')]);
    const ts = repo.getLastRefresh('k');
    expect(ts).toBeInstanceOf(Date);
    expect(ts!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(ts!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('saveCache() overwrites an existing key and bumps UpdatedUtc', () => {
    const repo = new IssueCacheRepo(new SqliteKvStore(db));
    repo.saveCache('k', [makeIssue('ISW-1')]);
    repo.saveCache('k', [makeIssue('ISW-2')]);
    const cached = repo.getCached('k');
    expect(cached).toHaveLength(1);
    expect(cached[0].key).toBe('ISW-2');
  });

  it('clearAll() empties the cache', () => {
    const repo = new IssueCacheRepo(new SqliteKvStore(db));
    repo.saveCache('a', [makeIssue('ISW-1')]);
    repo.saveCache('b', [makeIssue('ISW-2')]);
    repo.clearAll();
    expect(repo.getCached('a')).toEqual([]);
    expect(repo.getLastRefresh('b')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MetadataCacheRepo
// ---------------------------------------------------------------------------

describe('MetadataCacheRepo', () => {
  it('get() null when absent; set() then get() returns json + updatedUtc Date', () => {
    const repo = new MetadataCacheRepo(new SqliteKvStore(db));
    expect(repo.get('meta:x')).toBeNull();
    repo.set('meta:x', '["a","b"]');
    const entry = repo.get('meta:x');
    expect(entry).not.toBeNull();
    expect(entry!.json).toBe('["a","b"]');
    expect(entry!.updatedUtc).toBeInstanceOf(Date);
    expect(Math.abs(entry!.updatedUtc.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('set() upserts an existing key', () => {
    const repo = new MetadataCacheRepo(new SqliteKvStore(db));
    repo.set('k', '1');
    repo.set('k', '2');
    expect(repo.get('k')!.json).toBe('2');
  });

  it('delete() removes one key; clearAll() removes everything', () => {
    const repo = new MetadataCacheRepo(new SqliteKvStore(db));
    repo.set('a', '1');
    repo.set('b', '2');
    repo.delete('a');
    expect(repo.get('a')).toBeNull();
    expect(repo.get('b')).not.toBeNull();
    repo.clearAll();
    expect(repo.get('b')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SavedFilterRepo
// ---------------------------------------------------------------------------

describe('SavedFilterRepo', () => {
  const filter = (over: Partial<SavedFilter> = {}): SavedFilter => ({
    id: '11111111-1111-1111-1111-111111111111',
    name: 'My filter',
    description: 'desc',
    jql: 'project = ISW',
    isFavorite: true,
    created: '2026-01-01T00:00:00.000Z',
    lastUsed: null,
    ...over,
  });

  it('upsert() inserts, getAll() orders by Name', () => {
    const repo = new SavedFilterRepo(db);
    repo.upsert(filter({ id: 'b0000000-0000-0000-0000-000000000000', name: 'Zeta' }));
    repo.upsert(filter({ id: 'a0000000-0000-0000-0000-000000000000', name: 'Alpha' }));
    const all = repo.getAll();
    expect(all.map((f) => f.name)).toEqual(['Alpha', 'Zeta']);
    expect(all[0].isFavorite).toBe(true);
    expect(all[0].description).toBe('desc');
  });

  it('upsert() on conflict updates fields but NOT Created', () => {
    const repo = new SavedFilterRepo(db);
    repo.upsert(filter());
    repo.upsert(
      filter({
        name: 'Renamed',
        jql: 'project = ABC',
        isFavorite: false,
        created: '2030-12-31T00:00:00.000Z',
        lastUsed: '2026-08-12T00:00:00.000Z',
      }),
    );
    const all = repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Renamed');
    expect(all[0].jql).toBe('project = ABC');
    expect(all[0].isFavorite).toBe(false);
    expect(all[0].lastUsed).toBe('2026-08-12T00:00:00.000Z');
    expect(all[0].created).toBe('2026-01-01T00:00:00.000Z'); // unchanged
  });

  it('upsert() generates a lowercase hyphenated uuid when id is empty', () => {
    const repo = new SavedFilterRepo(db);
    const saved = repo.upsert(filter({ id: '' }));
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('delete() removes by id', () => {
    const repo = new SavedFilterRepo(db);
    repo.upsert(filter());
    repo.delete(filter().id);
    expect(repo.getAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PinnedBoardRepo
// ---------------------------------------------------------------------------

describe('PinnedBoardRepo', () => {
  const pb = (over: Partial<PinnedBoard> = {}): PinnedBoard => ({
    id: '11111111-1111-1111-1111-111111111111',
    profileId: 'p1',
    boardId: 42,
    name: 'Board',
    filterId: 7,
    ...over,
  });

  it('getForProfile() filters by profile and orders by Name', () => {
    const repo = new PinnedBoardRepo(db);
    repo.upsert(pb({ id: '1', name: 'Zeta', profileId: 'p1' }));
    repo.upsert(pb({ id: '2', name: 'Alpha', profileId: 'p1' }));
    repo.upsert(pb({ id: '3', name: 'Other', profileId: 'p2' }));
    const rows = repo.getForProfile('p1');
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('upsert() updates on conflict; null filterId round-trips; delete() removes', () => {
    const repo = new PinnedBoardRepo(db);
    repo.upsert(pb());
    repo.upsert(pb({ name: 'Renamed', filterId: null }));
    const rows = repo.getForProfile('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Renamed');
    expect(rows[0].filterId).toBeNull();
    repo.delete(rows[0].id);
    expect(repo.getForProfile('p1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BoardWorkspaceRepo
// ---------------------------------------------------------------------------

describe('BoardWorkspaceRepo', () => {
  const ws = (over: Partial<BoardWorkspace> = {}): BoardWorkspace => ({
    id: '11111111-1111-1111-1111-111111111111',
    profileId: 'p1',
    name: 'WS',
    boardIds: [1, 2, 3],
    isDefault: false,
    ...over,
  });

  it('upsert() stores BoardIdsJson as an int array and round-trips', () => {
    const repo = new BoardWorkspaceRepo(db);
    repo.upsert(ws());
    const raw = db.prepare('SELECT BoardIdsJson FROM BoardWorkspaces').get() as { BoardIdsJson: string };
    expect(raw.BoardIdsJson).toBe('[1,2,3]');
    expect(repo.getForProfile('p1')[0].boardIds).toEqual([1, 2, 3]);
  });

  it('setDefault() is scoped per profile', () => {
    const repo = new BoardWorkspaceRepo(db);
    repo.upsert(ws({ id: 'w1', profileId: 'p1', name: 'A', isDefault: true }));
    repo.upsert(ws({ id: 'w2', profileId: 'p1', name: 'B', isDefault: false }));
    repo.upsert(ws({ id: 'w3', profileId: 'p2', name: 'C', isDefault: true }));
    repo.setDefault('w2', 'p1');
    const p1 = repo.getForProfile('p1');
    expect(p1.find((w) => w.id === 'w1')!.isDefault).toBe(false);
    expect(p1.find((w) => w.id === 'w2')!.isDefault).toBe(true);
    // other profile untouched
    expect(repo.getForProfile('p2')[0].isDefault).toBe(true);
  });

  it('delete() removes by id', () => {
    const repo = new BoardWorkspaceRepo(db);
    repo.upsert(ws());
    repo.delete(ws().id);
    expect(repo.getForProfile('p1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TeamRepo
// ---------------------------------------------------------------------------

describe('TeamRepo', () => {
  const team = (over: Partial<Team> = {}): Team => ({
    id: 'abc123',
    name: 'Team A',
    members: ['Alice Smith', 'Bob Jones'],
    ...over,
  });

  it('upsert() + getAll() round-trips MembersJson; NOCASE name ordering', () => {
    const repo = new TeamRepo(db);
    repo.upsert(team({ id: 't1', name: 'beta' }));
    repo.upsert(team({ id: 't2', name: 'Alpha' }));
    const all = repo.getAll();
    expect(all.map((t) => t.name)).toEqual(['Alpha', 'beta']);
    expect(all[0].members).toEqual(['Alice Smith', 'Bob Jones']);
  });

  it('corrupt MembersJson yields []', () => {
    db.prepare("INSERT INTO Teams (Id, Name, MembersJson) VALUES ('bad', 'Broken', '{oops')").run();
    const repo = new TeamRepo(db);
    const t = repo.getById('bad');
    expect(t).not.toBeNull();
    expect(t!.members).toEqual([]);
  });

  it('getById() returns null on empty id and on missing id', () => {
    const repo = new TeamRepo(db);
    expect(repo.getById('')).toBeNull();
    expect(repo.getById('nope')).toBeNull();
  });

  it('upsert() generates a 32-hex no-hyphen id when empty; conflict updates Name/Members', () => {
    const repo = new TeamRepo(db);
    const saved = repo.upsert(team({ id: '' }));
    expect(saved.id).toMatch(/^[0-9a-f]{32}$/);
    repo.upsert({ ...saved, name: 'Renamed', members: ['X'] });
    const again = repo.getById(saved.id)!;
    expect(again.name).toBe('Renamed');
    expect(again.members).toEqual(['X']);
  });

  it('delete() removes by id', () => {
    const repo = new TeamRepo(db);
    repo.upsert(team({ id: 't1' }));
    repo.delete('t1');
    expect(repo.getAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File stores
// ---------------------------------------------------------------------------

describe('file stores', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiraweb-storage-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('CreateDefaultsStore', () => {
    it('load() null when nothing saved; save() then load() round-trips per key', () => {
      const file = path.join(tmpDir, 'create-defaults.json');
      const store = new CreateDefaultsStore(file);
      expect(store.load('ISW:Bug')).toBeNull();
      store.save('ISW:Bug', {
        summary: { TextValue: 'Default summary' },
        priority: { SelectedValue: 'High' },
        components: { SelectedItems: ['comp1', 'comp2'] },
        duedate: { DateValue: '2026-08-12T00:00:00.000Z' },
      });
      expect(store.load('ISW:Bug')).toEqual({
        summary: { TextValue: 'Default summary' },
        priority: { SelectedValue: 'High' },
        components: { SelectedItems: ['comp1', 'comp2'] },
        duedate: { DateValue: '2026-08-12T00:00:00.000Z' },
      });
      // written indented, keyed by "PROJ:Type"
      const raw = fs.readFileSync(file, 'utf8');
      expect(raw).toContain('\n');
      expect(JSON.parse(raw)['ISW:Bug'].summary.TextValue).toBe('Default summary');
    });

    it('clear() removes only the given key', () => {
      const store = new CreateDefaultsStore(path.join(tmpDir, 'create-defaults.json'));
      store.save('ISW:Bug', { summary: { TextValue: 'a' } });
      store.save('ISW:Task', { summary: { TextValue: 'b' } });
      store.clear('ISW:Bug');
      expect(store.load('ISW:Bug')).toBeNull();
      expect(store.load('ISW:Task')).toEqual({ summary: { TextValue: 'b' } });
    });
  });

  describe('CreateMetaCache', () => {
    it('load() null when absent; save() then load() returns SavedUtc + Meta', () => {
      const file = path.join(tmpDir, 'create-meta-cache.json');
      const cache = new CreateMetaCache(file);
      expect(cache.load('ISW:Bug')).toBeNull();
      const meta = {
        projectKey: 'ISW',
        issueType: 'Bug',
        fields: [{ fieldId: 'summary', displayName: 'Summary', required: true, schemaType: 'string', allowedValues: [] }],
      };
      cache.save('ISW:Bug', meta);
      const entry = cache.load('ISW:Bug');
      expect(entry).not.toBeNull();
      expect(entry!.meta).toEqual(meta);
      expect(entry!.savedUtc).toBeInstanceOf(Date);
      // disk shape: { key: { SavedUtc, Meta } } with PascalCase keys
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(raw['ISW:Bug'].SavedUtc).toBeTypeOf('string');
      expect(raw['ISW:Bug'].Meta.ProjectKey).toBe('ISW');
      expect(raw['ISW:Bug'].Meta.Fields[0].FieldId).toBe('summary');
    });

    it('clearAll() deletes the file', () => {
      const file = path.join(tmpDir, 'create-meta-cache.json');
      const cache = new CreateMetaCache(file);
      cache.save('ISW:Bug', null);
      expect(fs.existsSync(file)).toBe(true);
      cache.clearAll();
      expect(fs.existsSync(file)).toBe(false);
      expect(cache.load('ISW:Bug')).toBeNull();
    });
  });
});
