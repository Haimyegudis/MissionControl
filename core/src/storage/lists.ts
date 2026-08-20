// List-shaped repositories over the KvStore, for the mobile build.
//
// These four tables are row-shaped in SQLite (real columns, not a JSON blob),
// so they cannot ride on the same key/JSON mapping the cache repositories use.
// Rather than migrate the desktop schema, the mobile build stores each as one
// JSON array and the desktop keeps its SQL implementation. Both satisfy the
// same narrow interface, which is all the dispatcher and the routes need.

import type { BoardWorkspace, PinnedBoard, SavedFilter, Team } from '../types.js';
import type { KvStore } from './kv.js';

/** Lowercase hyphenated UUID, matching the desktop's Guid "D" form. */
function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** 32-hex, no hyphens (Guid "N" form) — Team.Id convention. */
function newTeamId(): string {
  return newId().replace(/-/g, '');
}

function nowIso(): string {
  return new Date().toISOString();
}

/** One JSON array per logical table, all under the `lists` KV table. */
class JsonList<T> {
  constructor(
    private readonly kv: KvStore,
    private readonly key: string,
  ) {}

  read(): T[] {
    const row = this.kv.get('lists', this.key);
    if (!row || !row.json) return [];
    try {
      const parsed: unknown = JSON.parse(row.json);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  write(items: T[]): void {
    this.kv.set('lists', this.key, JSON.stringify(items));
  }

  /** Replace the entry with a matching id, or append it. */
  upsertBy(items: T[], item: T, idOf: (v: T) => string): T[] {
    const id = idOf(item);
    const index = items.findIndex((v) => idOf(v) === id);
    if (index === -1) return [...items, item];
    const next = [...items];
    next[index] = item;
    return next;
  }
}

export class KvSavedFilterRepo {
  private readonly list: JsonList<SavedFilter>;

  constructor(kv: KvStore) {
    this.list = new JsonList(kv, 'savedFilters');
  }

  getAll(): SavedFilter[] {
    return [...this.list.read()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Insert or update by id; `created` is deliberately preserved on update. */
  upsert(filter: SavedFilter): SavedFilter {
    const items = this.list.read();
    const existing = items.find((f) => f.id === filter.id);
    const stored: SavedFilter = {
      ...filter,
      id: filter.id && filter.id.length > 0 ? filter.id : newId(),
      created: existing?.created ?? (filter.created && filter.created.length > 0 ? filter.created : nowIso()),
    };
    this.list.write(this.list.upsertBy(items, stored, (f) => f.id));
    return stored;
  }

  delete(id: string): void {
    this.list.write(this.list.read().filter((f) => f.id !== id));
  }
}

export class KvPinnedBoardRepo {
  private readonly list: JsonList<PinnedBoard>;

  constructor(kv: KvStore) {
    this.list = new JsonList(kv, 'pinnedBoards');
  }

  getForProfile(profileId: string): PinnedBoard[] {
    return this.list
      .read()
      .filter((b) => b.profileId === profileId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  upsert(board: PinnedBoard): PinnedBoard {
    const stored: PinnedBoard = { ...board, id: board.id && board.id.length > 0 ? board.id : newId() };
    this.list.write(this.list.upsertBy(this.list.read(), stored, (b) => b.id));
    return stored;
  }

  delete(id: string): void {
    this.list.write(this.list.read().filter((b) => b.id !== id));
  }
}

export class KvBoardWorkspaceRepo {
  private readonly list: JsonList<BoardWorkspace>;

  constructor(kv: KvStore) {
    this.list = new JsonList(kv, 'boardWorkspaces');
  }

  getForProfile(profileId: string): BoardWorkspace[] {
    return this.list.read().filter((w) => w.profileId === profileId);
  }

  upsert(ws: BoardWorkspace): BoardWorkspace {
    const stored: BoardWorkspace = { ...ws, id: ws.id && ws.id.length > 0 ? ws.id : newId() };
    this.list.write(this.list.upsertBy(this.list.read(), stored, (w) => w.id));
    return stored;
  }

  delete(id: string): void {
    this.list.write(this.list.read().filter((w) => w.id !== id));
  }

  /** Exactly one workspace per profile carries the default flag. */
  setDefault(id: string, profileId: string): void {
    this.list.write(
      this.list.read().map((w) => (w.profileId === profileId ? { ...w, isDefault: w.id === id } : w)),
    );
  }
}

export class KvTeamRepo {
  private readonly list: JsonList<Team>;

  constructor(kv: KvStore) {
    this.list = new JsonList(kv, 'teams');
  }

  getAll(): Team[] {
    return [...this.list.read()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  getById(id: string | null | undefined): Team | null {
    if (!id) return null;
    return this.list.read().find((t) => t.id === id) ?? null;
  }

  upsert(team: Team): Team {
    const stored: Team = {
      ...team,
      id: team.id && team.id.length > 0 ? team.id : newTeamId(),
      members: team.members ?? [],
    };
    this.list.write(this.list.upsertBy(this.list.read(), stored, (t) => t.id));
    return stored;
  }

  delete(id: string): void {
    this.list.write(this.list.read().filter((t) => t.id !== id));
  }
}


/**
 * Remembered field values for the create-issue dialog, keyed by
 * "{project}:{issuetype}". The desktop keeps these in a JSON file next to the
 * database; on a phone they ride in the same KV list table as everything else.
 */
export class KvCreateDefaultsRepo {
  private readonly list: JsonList<[string, Record<string, unknown>]>;

  constructor(kv: KvStore) {
    this.list = new JsonList(kv, 'createDefaults');
  }

  get(key: string): Record<string, unknown> {
    return this.list.read().find(([k]) => k === key)?.[1] ?? {};
  }

  put(key: string, values: Record<string, unknown>): void {
    const rows = this.list.read().filter(([k]) => k !== key);
    this.list.write([...rows, [key, values]]);
  }

  delete(key: string): void {
    this.list.write(this.list.read().filter(([k]) => k !== key));
  }
}
