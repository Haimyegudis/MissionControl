// SqliteKvStore — maps the core KvStore port onto the tables the desktop build
// already has, so no schema migration is needed. Timestamp encodings differ per
// table (IssueCache/MetadataCache store ISO text, TestRailCache stores epoch
// milliseconds), so each descriptor declares its own.

import type { KvRecord, KvStore, KvTable, PeopleStore, TestRailPerson } from '@mc/core';
import type { Db } from './db.js';

type TsKind = 'iso' | 'epoch' | 'none';

interface TableSpec {
  table: string;
  keyCol: string;
  jsonCol: string;
  tsCol: string | null;
  tsKind: TsKind;
}

const SPECS: Record<KvTable, TableSpec> = {
  appSettings: { table: 'AppSettings', keyCol: 'Id', jsonCol: 'Json', tsCol: null, tsKind: 'none' },
  issueCache: { table: 'IssueCache', keyCol: 'CacheKey', jsonCol: 'Json', tsCol: 'UpdatedUtc', tsKind: 'iso' },
  metadataCache: { table: 'MetadataCache', keyCol: 'CacheKey', jsonCol: 'Json', tsCol: 'UpdatedUtc', tsKind: 'iso' },
  trCache: { table: 'TestRailCache', keyCol: 'key', jsonCol: 'json', tsCol: 'updatedAt', tsKind: 'epoch' },
  // Mobile-only: the desktop keeps its row-shaped SavedFilters/Teams/
  // PinnedBoards/BoardWorkspaces tables and never routes them through here.
  lists: { table: 'KvLists', keyCol: 'key', jsonCol: 'json', tsCol: 'updatedAt', tsKind: 'epoch' },
};

function encodeTs(kind: TsKind, ms: number): string | number | null {
  if (kind === 'iso') return new Date(ms).toISOString();
  if (kind === 'epoch') return ms;
  return null;
}

function decodeTs(kind: TsKind, raw: unknown): number {
  if (kind === 'epoch') return typeof raw === 'number' ? raw : 0;
  if (kind === 'iso' && typeof raw === 'string') {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

export class SqliteKvStore implements KvStore {
  constructor(private readonly db: Db) {}

  get(table: KvTable, key: string): KvRecord | null {
    const s = SPECS[table];
    const cols = s.tsCol ? `${s.jsonCol}, ${s.tsCol}` : s.jsonCol;
    const row = this.db
      .prepare(`SELECT ${cols} FROM ${s.table} WHERE ${s.keyCol} = @k`)
      .get({ k: key }) as Record<string, unknown> | undefined;
    if (!row) return null;
    const json = row[s.jsonCol];
    if (typeof json !== 'string') return null;
    return { json, updatedAt: s.tsCol ? decodeTs(s.tsKind, row[s.tsCol]) : 0 };
  }

  set(table: KvTable, key: string, json: string, now: number = Date.now()): void {
    const s = SPECS[table];
    if (s.tsCol === null) {
      this.db
        .prepare(
          `INSERT INTO ${s.table} (${s.keyCol}, ${s.jsonCol}) VALUES (@k, @json)
           ON CONFLICT(${s.keyCol}) DO UPDATE SET ${s.jsonCol} = excluded.${s.jsonCol}`,
        )
        .run({ k: key, json });
      return;
    }
    this.db
      .prepare(
        `INSERT INTO ${s.table} (${s.keyCol}, ${s.jsonCol}, ${s.tsCol}) VALUES (@k, @json, @u)
         ON CONFLICT(${s.keyCol}) DO UPDATE SET ${s.jsonCol} = excluded.${s.jsonCol}, ${s.tsCol} = excluded.${s.tsCol}`,
      )
      .run({ k: key, json, u: encodeTs(s.tsKind, now) });
  }

  delete(table: KvTable, key: string): void {
    const s = SPECS[table];
    this.db.prepare(`DELETE FROM ${s.table} WHERE ${s.keyCol} = @k`).run({ k: key });
  }

  clear(table: KvTable): void {
    this.db.prepare(`DELETE FROM ${SPECS[table].table}`).run();
  }
}

export class SqlitePeopleStore implements PeopleStore {
  constructor(private readonly db: Db) {}

  all(): TestRailPerson[] {
    const rows = this.db.prepare('SELECT id, name FROM TestRailPeople ORDER BY id').all() as TestRailPerson[];
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  upsertMany(people: TestRailPerson[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO TestRailPeople (id, name) VALUES (@id, @name)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    );
    this.db.transaction((rows: TestRailPerson[]) => {
      for (const row of rows) upsert.run({ id: row.id, name: row.name });
    })(people);
  }

  clear(): void {
    this.db.prepare('DELETE FROM TestRailPeople').run();
  }
}
