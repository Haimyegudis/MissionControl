import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import {
  defaultAppSettings,
  type AppSettings,
  type BoardWorkspace,
  type JiraIssue,
  type PinnedBoard,
  type SavedFilter,
  type Team,
} from '../types.js';

// ---------------------------------------------------------------------------
// ID + date helpers
// ---------------------------------------------------------------------------

/** Lowercase hyphenated UUID (Guid "D" form). */
export function newId(): string {
  return randomUUID();
}

/** 32-hex, no hyphens (Guid "N" form) — used for Team.Id. */
export function newTeamId(): string {
  return randomUUID().replace(/-/g, '');
}

/** ISO-8601 UTC now — DateTime column convention. */
function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// camelCase <-> PascalCase key conversion for JSON blob columns
// (storage-layer.md §8.1 — blobs keep PascalCase keys).
// Dictionary-valued fields (user-chosen keys) are passed through verbatim.
// ---------------------------------------------------------------------------

type JsonValue = unknown;

function pascalizeKey(k: string): string {
  return k.length === 0 ? k : k.charAt(0).toUpperCase() + k.slice(1);
}

function camelizeKey(k: string): string {
  return k.length === 0 ? k : k.charAt(0).toLowerCase() + k.slice(1);
}

function mapKeysDeep(
  value: JsonValue,
  keyFn: (k: string) => string,
  passthroughKeys: ReadonlySet<string>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((v) => mapKeysDeep(v, keyFn, passthroughKeys));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, JsonValue>)) {
      // Dictionary-valued field: convert the field name but copy the value
      // verbatim so its keys (column titles, env var names, ...) survive.
      out[keyFn(k)] = passthroughKeys.has(k) ? v : mapKeysDeep(v, keyFn, passthroughKeys);
    }
    return out;
  }
  return value;
}

const NO_PASSTHROUGH: ReadonlySet<string> = new Set();

/** Recursively camelCase -> PascalCase object keys. */
export function toPascalKeys<T = JsonValue>(value: JsonValue, passthroughKeys: ReadonlySet<string> = NO_PASSTHROUGH): T {
  return mapKeysDeep(value, pascalizeKey, passthroughKeys) as T;
}

/** Recursively PascalCase -> camelCase object keys. */
export function toCamelKeys<T = JsonValue>(value: JsonValue, passthroughKeys: ReadonlySet<string> = NO_PASSTHROUGH): T {
  return mapKeysDeep(value, camelizeKey, passthroughKeys) as T;
}

/** AppSettings fields whose values are dictionaries with user-defined keys. */
const SETTINGS_DICT_FIELDS_CAMEL: ReadonlySet<string> = new Set(['kanbanWipLimits', 'mcpServerEnv']);
const SETTINGS_DICT_FIELDS_PASCAL: ReadonlySet<string> = new Set(['KanbanWipLimits', 'McpServerEnv']);

// ---------------------------------------------------------------------------
// AppSettingsRepo — single row (Id = 1), whole-object JSON blob
// ---------------------------------------------------------------------------

export class AppSettingsRepo {
  constructor(private readonly db: Db) {}

  /** Returns stored settings merged over defaults; full defaults when absent. */
  get(): AppSettings {
    const row = this.db.prepare('SELECT Json FROM AppSettings WHERE Id = 1').get() as
      | { Json: string }
      | undefined;
    const defaults = defaultAppSettings();
    if (!row || !row.Json) return defaults;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.Json);
    } catch {
      return defaults;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    const stored = toCamelKeys<Partial<AppSettings>>(parsed, SETTINGS_DICT_FIELDS_PASCAL);
    return { ...defaults, ...stored };
  }

  /** Upserts the single settings row with PascalCase JSON keys. */
  save(settings: AppSettings): void {
    const json = JSON.stringify(toPascalKeys(settings, SETTINGS_DICT_FIELDS_CAMEL));
    this.db
      .prepare('INSERT INTO AppSettings (Id, Json) VALUES (1, @json) ON CONFLICT(Id) DO UPDATE SET Json = excluded.Json')
      .run({ json });
  }
}

// ---------------------------------------------------------------------------
// IssueCacheRepo
// ---------------------------------------------------------------------------

export class IssueCacheRepo {
  constructor(private readonly db: Db) {}

  getCached(cacheKey: string): JiraIssue[] {
    const row = this.db.prepare('SELECT Json FROM IssueCache WHERE CacheKey = @k').get({ k: cacheKey }) as
      | { Json: string }
      | undefined;
    if (!row || !row.Json) return [];
    try {
      const parsed = JSON.parse(row.Json);
      if (!Array.isArray(parsed)) return [];
      return toCamelKeys<JiraIssue[]>(parsed);
    } catch {
      return [];
    }
  }

  saveCache(cacheKey: string, issues: JiraIssue[]): void {
    const json = JSON.stringify(toPascalKeys(issues));
    this.db
      .prepare(
        `INSERT INTO IssueCache (CacheKey, Json, UpdatedUtc) VALUES (@k, @json, @u)
         ON CONFLICT(CacheKey) DO UPDATE SET Json = excluded.Json, UpdatedUtc = excluded.UpdatedUtc`,
      )
      .run({ k: cacheKey, json, u: nowIso() });
  }

  getLastRefresh(cacheKey: string): Date | null {
    const row = this.db
      .prepare('SELECT UpdatedUtc FROM IssueCache WHERE CacheKey = @k')
      .get({ k: cacheKey }) as { UpdatedUtc: string } | undefined;
    if (!row || !row.UpdatedUtc) return null;
    const d = new Date(row.UpdatedUtc);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM IssueCache').run();
  }
}

// ---------------------------------------------------------------------------
// MetadataCacheRepo
// ---------------------------------------------------------------------------

export interface MetadataCacheEntry {
  json: string;
  updatedUtc: Date;
}

export class MetadataCacheRepo {
  constructor(private readonly db: Db) {}

  get(cacheKey: string): MetadataCacheEntry | null {
    const row = this.db
      .prepare('SELECT Json, UpdatedUtc FROM MetadataCache WHERE CacheKey = @k')
      .get({ k: cacheKey }) as { Json: string; UpdatedUtc: string } | undefined;
    if (!row) return null;
    return { json: row.Json, updatedUtc: new Date(row.UpdatedUtc) };
  }

  /** Caller passes an already-serialized JSON string. */
  set(cacheKey: string, json: string): void {
    this.db
      .prepare(
        `INSERT INTO MetadataCache (CacheKey, Json, UpdatedUtc) VALUES (@k, @json, @u)
         ON CONFLICT(CacheKey) DO UPDATE SET Json = excluded.Json, UpdatedUtc = excluded.UpdatedUtc`,
      )
      .run({ k: cacheKey, json, u: nowIso() });
  }

  delete(cacheKey: string): void {
    this.db.prepare('DELETE FROM MetadataCache WHERE CacheKey = @k').run({ k: cacheKey });
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM MetadataCache').run();
  }
}

// ---------------------------------------------------------------------------
// SavedFilterRepo
// ---------------------------------------------------------------------------

interface SavedFilterRow {
  Id: string;
  Name: string;
  Description: string | null;
  Jql: string;
  IsFavorite: number;
  Created: string;
  LastUsed: string | null;
}

export class SavedFilterRepo {
  constructor(private readonly db: Db) {}

  getAll(): SavedFilter[] {
    const rows = this.db
      .prepare('SELECT Id, Name, Description, Jql, IsFavorite, Created, LastUsed FROM SavedFilters ORDER BY Name')
      .all() as SavedFilterRow[];
    return rows.map((r) => ({
      id: r.Id,
      name: r.Name,
      description: r.Description ?? null,
      jql: r.Jql,
      isFavorite: r.IsFavorite === 1,
      created: r.Created,
      lastUsed: r.LastUsed ?? null,
    }));
  }

  /** Insert or update by Id; Created is deliberately NOT updated on conflict. */
  upsert(filter: SavedFilter): SavedFilter {
    const stored: SavedFilter = {
      ...filter,
      id: filter.id && filter.id.length > 0 ? filter.id : newId(),
      created: filter.created && filter.created.length > 0 ? filter.created : nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO SavedFilters (Id, Name, Description, Jql, IsFavorite, Created, LastUsed)
         VALUES (@id, @name, @description, @jql, @isFavorite, @created, @lastUsed)
         ON CONFLICT(Id) DO UPDATE SET
           Name = excluded.Name,
           Description = excluded.Description,
           Jql = excluded.Jql,
           IsFavorite = excluded.IsFavorite,
           LastUsed = excluded.LastUsed`,
      )
      .run({
        id: stored.id,
        name: stored.name,
        description: stored.description ?? null,
        jql: stored.jql,
        isFavorite: stored.isFavorite ? 1 : 0,
        created: stored.created,
        lastUsed: stored.lastUsed ?? null,
      });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM SavedFilters WHERE Id = @id').run({ id });
  }
}

// ---------------------------------------------------------------------------
// PinnedBoardRepo
// ---------------------------------------------------------------------------

interface PinnedBoardRow {
  Id: string;
  ProfileId: string;
  BoardId: number;
  Name: string;
  FilterId: number | null;
}

export class PinnedBoardRepo {
  constructor(private readonly db: Db) {}

  getForProfile(profileId: string): PinnedBoard[] {
    const rows = this.db
      .prepare('SELECT Id, ProfileId, BoardId, Name, FilterId FROM PinnedBoards WHERE ProfileId = @pid ORDER BY Name')
      .all({ pid: profileId }) as PinnedBoardRow[];
    return rows.map((r) => ({
      id: r.Id,
      profileId: r.ProfileId,
      boardId: r.BoardId,
      name: r.Name,
      filterId: r.FilterId ?? null,
    }));
  }

  upsert(board: PinnedBoard): PinnedBoard {
    const stored: PinnedBoard = { ...board, id: board.id && board.id.length > 0 ? board.id : newId() };
    this.db
      .prepare(
        `INSERT INTO PinnedBoards (Id, ProfileId, BoardId, Name, FilterId)
         VALUES (@id, @profileId, @boardId, @name, @filterId)
         ON CONFLICT(Id) DO UPDATE SET
           ProfileId = excluded.ProfileId,
           BoardId = excluded.BoardId,
           Name = excluded.Name,
           FilterId = excluded.FilterId`,
      )
      .run({
        id: stored.id,
        profileId: stored.profileId,
        boardId: stored.boardId,
        name: stored.name,
        filterId: stored.filterId ?? null,
      });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM PinnedBoards WHERE Id = @id').run({ id });
  }
}

// ---------------------------------------------------------------------------
// BoardWorkspaceRepo
// ---------------------------------------------------------------------------

interface BoardWorkspaceRow {
  Id: string;
  ProfileId: string;
  Name: string;
  BoardIdsJson: string;
  IsDefault: number;
}

export class BoardWorkspaceRepo {
  private readonly setDefaultTx: (id: string, profileId: string) => void;

  constructor(private readonly db: Db) {
    const clear = db.prepare('UPDATE BoardWorkspaces SET IsDefault = 0 WHERE ProfileId = @pid');
    const set = db.prepare('UPDATE BoardWorkspaces SET IsDefault = 1 WHERE Id = @id');
    this.setDefaultTx = db.transaction((id: string, profileId: string) => {
      clear.run({ pid: profileId });
      set.run({ id });
    });
  }

  getForProfile(profileId: string): BoardWorkspace[] {
    const rows = this.db
      .prepare(
        'SELECT Id, ProfileId, Name, BoardIdsJson, IsDefault FROM BoardWorkspaces WHERE ProfileId = @pid ORDER BY Name',
      )
      .all({ pid: profileId }) as BoardWorkspaceRow[];
    return rows.map((r) => ({
      id: r.Id,
      profileId: r.ProfileId,
      name: r.Name,
      boardIds: parseIntArray(r.BoardIdsJson),
      isDefault: r.IsDefault === 1,
    }));
  }

  upsert(ws: BoardWorkspace): BoardWorkspace {
    const stored: BoardWorkspace = { ...ws, id: ws.id && ws.id.length > 0 ? ws.id : newId() };
    this.db
      .prepare(
        `INSERT INTO BoardWorkspaces (Id, ProfileId, Name, BoardIdsJson, IsDefault)
         VALUES (@id, @profileId, @name, @boardIdsJson, @isDefault)
         ON CONFLICT(Id) DO UPDATE SET
           ProfileId = excluded.ProfileId,
           Name = excluded.Name,
           BoardIdsJson = excluded.BoardIdsJson,
           IsDefault = excluded.IsDefault`,
      )
      .run({
        id: stored.id,
        profileId: stored.profileId,
        name: stored.name,
        boardIdsJson: JSON.stringify(stored.boardIds ?? []),
        isDefault: stored.isDefault ? 1 : 0,
      });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM BoardWorkspaces WHERE Id = @id').run({ id });
  }

  /** Clears IsDefault for the profile then sets it on one row — in a transaction. */
  setDefault(id: string, profileId: string): void {
    this.setDefaultTx(id, profileId);
  }
}

function parseIntArray(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// TestRail cache + people (Phase 2 — unified-deck plan T8)
// ---------------------------------------------------------------------------

export interface TestRailCacheEntry {
  json: string;
  /** Epoch milliseconds. */
  updatedAt: number;
}

export function trCacheGet(db: Db, key: string): TestRailCacheEntry | null {
  const row = db
    .prepare('SELECT json, updatedAt FROM TestRailCache WHERE key = @k')
    .get({ k: key }) as { json: string; updatedAt: number } | undefined;
  if (!row) return null;
  return { json: row.json, updatedAt: row.updatedAt };
}

/** Caller passes an already-serialized JSON string. */
export function trCacheSet(db: Db, key: string, json: string): void {
  db.prepare(
    `INSERT INTO TestRailCache (key, json, updatedAt) VALUES (@k, @json, @u)
     ON CONFLICT(key) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt`,
  ).run({ k: key, json, u: Date.now() });
}

export function trCacheClear(db: Db): void {
  db.prepare('DELETE FROM TestRailCache').run();
}

export interface TestRailPerson {
  id: number;
  name: string;
}

export function trPeopleAll(db: Db): TestRailPerson[] {
  const rows = db.prepare('SELECT id, name FROM TestRailPeople ORDER BY id').all() as TestRailPerson[];
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export function trPeopleUpsertMany(db: Db, people: TestRailPerson[]): void {
  const upsert = db.prepare(
    `INSERT INTO TestRailPeople (id, name) VALUES (@id, @name)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  );
  const tx = db.transaction((rows: TestRailPerson[]) => {
    for (const row of rows) upsert.run({ id: row.id, name: row.name });
  });
  tx(people);
}

export function trPeopleClear(db: Db): void {
  db.prepare('DELETE FROM TestRailPeople').run();
}

// ---------------------------------------------------------------------------
// TeamRepo
// ---------------------------------------------------------------------------

interface TeamRow {
  Id: string;
  Name: string;
  MembersJson: string;
}

export class TeamRepo {
  constructor(private readonly db: Db) {}

  getAll(): Team[] {
    const rows = this.db
      .prepare('SELECT Id, Name, MembersJson FROM Teams ORDER BY Name COLLATE NOCASE')
      .all() as TeamRow[];
    return rows.map(mapTeam);
  }

  getById(id: string | null | undefined): Team | null {
    if (!id) return null;
    const row = this.db.prepare('SELECT Id, Name, MembersJson FROM Teams WHERE Id = @id').get({ id }) as
      | TeamRow
      | undefined;
    return row ? mapTeam(row) : null;
  }

  upsert(team: Team): Team {
    const stored: Team = { ...team, id: team.id && team.id.length > 0 ? team.id : newTeamId() };
    this.db
      .prepare(
        `INSERT INTO Teams (Id, Name, MembersJson) VALUES (@id, @name, @membersJson)
         ON CONFLICT(Id) DO UPDATE SET Name = excluded.Name, MembersJson = excluded.MembersJson`,
      )
      .run({ id: stored.id, name: stored.name, membersJson: JSON.stringify(stored.members ?? []) });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM Teams WHERE Id = @id').run({ id });
  }
}

function mapTeam(row: TeamRow): Team {
  let members: string[];
  try {
    const parsed = JSON.parse(row.MembersJson);
    members = Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    members = [];
  }
  return { id: row.Id, name: row.Name, members };
}
