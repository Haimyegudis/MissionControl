// Write-through KV store for the Android shell. Capacitor's storage APIs are
// async but the repositories are synchronous, so every table is hydrated into
// memory at boot and written back on a debounced flush.

import { KV_TABLES, MemoryKvStore, type KvRecord, type KvTable, type PeopleStore, type TestRailPerson } from '@mc/core';

/**
 * Ceiling on a single persisted table. Everything crosses the Capacitor bridge
 * as one JSON string, which the native side copies several times; a Backlog of
 * a couple of thousand issues produced a ~55MB allocation and an
 * OutOfMemoryError. Past this size the table stays in memory for the session
 * instead of being written — a cold start re-fetches, which is far better than
 * a crash.
 */
export const MAX_PERSISTED_BYTES = 2 * 1024 * 1024;

export interface KvPersistence {
  read(table: KvTable): Promise<Array<[string, KvRecord]> | null>;
  write(table: KvTable, entries: Array<[string, KvRecord]>): Promise<void>;
}

export class HydratedKvStore extends MemoryKvStore {
  private readonly dirty = new Set<KvTable>();
  /** Tables skipped by the size cap, exposed for diagnostics. */
  readonly oversized = new Set<KvTable>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: (table: KvTable) => KvPersistence,
    private readonly flushMs = 250,
  ) {
    super();
  }

  /** Load every table into memory. A failed read leaves that table empty. */
  async hydrate(): Promise<void> {
    for (const table of KV_TABLES) {
      try {
        const entries = await this.persistence(table).read(table);
        if (entries) this.restore(table, entries);
      } catch {
        // A corrupt or unreadable cache must not block startup.
      }
    }
  }

  /** Write every dirty table now and wait for it. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const tables = [...this.dirty];
    this.dirty.clear();
    this.pending = this.pending.then(async () => {
      for (const table of tables) {
        try {
          const entries = this.snapshot(table);
          const bytes = entries.reduce((sum, [key, rec]) => sum + key.length + rec.json.length, 0);
          if (bytes > MAX_PERSISTED_BYTES) {
            this.oversized.add(table);
            continue;
          }
          this.oversized.delete(table);
          await this.persistence(table).write(table, entries);
        } catch {
          // Losing a cache write is survivable; crashing the app is not.
        }
      }
    });
    await this.pending;
  }

  protected override onMutated(table: KvTable): void {
    this.dirty.add(table);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushMs);
  }
}

/**
 * TestRail's people list, held in memory and mirrored to Preferences. Small
 * enough that a whole-list rewrite per change is cheaper than any diffing.
 */
export class PreferencesPeopleStore implements PeopleStore {
  private people: TestRailPerson[] = [];

  constructor(private readonly key = 'mc.testrail.people') {}

  async hydrate(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: this.key });
      if (!value) return;
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) this.people = parsed as TestRailPerson[];
    } catch {
      this.people = [];
    }
  }

  all(): TestRailPerson[] {
    return [...this.people].sort((a, b) => a.id - b.id);
  }

  upsertMany(people: TestRailPerson[]): void {
    const byId = new Map(this.people.map((p) => [p.id, p.name]));
    for (const p of people) byId.set(p.id, p.name);
    this.people = [...byId.entries()].map(([id, name]) => ({ id, name }));
    void this.persist();
  }

  clear(): void {
    this.people = [];
    void this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: this.key, value: JSON.stringify(this.people) });
    } catch {
      // Same reasoning as the KV flush: a lost write must not crash the app.
    }
  }
}
