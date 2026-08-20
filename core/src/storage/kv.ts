// Key/value port. Synchronous by contract: the repositories are synchronous and
// so are their callers, so the Android backend hydrates into memory at boot
// rather than forcing every caller to become async.

export type KvTable = 'appSettings' | 'issueCache' | 'metadataCache' | 'trCache';

export const KV_TABLES: readonly KvTable[] = ['appSettings', 'issueCache', 'metadataCache', 'trCache'];

export interface KvRecord {
  json: string;
  /** Epoch milliseconds of the last write. */
  updatedAt: number;
}

export interface KvStore {
  get(table: KvTable, key: string): KvRecord | null;
  /** `now` defaults to Date.now(); tests inject a fixed clock. */
  set(table: KvTable, key: string, json: string, now?: number): void;
  delete(table: KvTable, key: string): void;
  clear(table: KvTable): void;
}

/** TestRail's people list is a flat id -> name table, not a JSON cache. */
export interface TestRailPerson {
  id: number;
  name: string;
}

export interface PeopleStore {
  all(): TestRailPerson[];
  upsertMany(people: TestRailPerson[]): void;
  clear(): void;
}

/** Plain in-memory store. Base class for the Android write-through store. */
export class MemoryKvStore implements KvStore {
  protected readonly tables = new Map<KvTable, Map<string, KvRecord>>();

  private table(name: KvTable): Map<string, KvRecord> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  get(table: KvTable, key: string): KvRecord | null {
    return this.table(table).get(key) ?? null;
  }

  set(table: KvTable, key: string, json: string, now: number = Date.now()): void {
    this.table(table).set(key, { json, updatedAt: now });
    this.onMutated(table);
  }

  delete(table: KvTable, key: string): void {
    this.table(table).delete(key);
    this.onMutated(table);
  }

  clear(table: KvTable): void {
    this.table(table).clear();
    this.onMutated(table);
  }

  /** Snapshot for persistence backends. */
  snapshot(table: KvTable): Array<[string, KvRecord]> {
    return [...this.table(table).entries()];
  }

  /** Replace a table wholesale during hydration. */
  restore(table: KvTable, entries: Array<[string, KvRecord]>): void {
    this.tables.set(table, new Map(entries));
  }

  /** Hook for subclasses that persist. No-op in memory. */
  protected onMutated(_table: KvTable): void {}
}

export class MemoryPeopleStore implements PeopleStore {
  private readonly people = new Map<number, string>();

  all(): TestRailPerson[] {
    return [...this.people.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id - b.id);
  }

  upsertMany(people: TestRailPerson[]): void {
    for (const p of people) this.people.set(p.id, p.name);
  }

  clear(): void {
    this.people.clear();
  }
}
