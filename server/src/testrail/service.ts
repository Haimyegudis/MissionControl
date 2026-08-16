import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../storage/db.js';
import {
  trCacheClear,
  trCacheGet,
  trCacheSet,
  trPeopleAll,
  trPeopleClear,
  trPeopleUpsertMany,
  type TestRailPerson,
} from '../storage/repositories.js';
import { TestRailClient, type TestRailClientLike } from './client.js';
import { TestRailApiError, TestRailHttp } from './httpClient.js';
import type { TrCaseType, TrConnection, TrPriority, TrStatus, TrUser } from './types.js';

/**
 * TestRail session + cache service (Phase 2 — unified-deck plan T9).
 * Port of TestRailWeb's SessionState + ApiCache (Program.cs): connect verifies
 * via get_current_user; GETs run through cachedJson (SQLite-backed, `fresh`
 * bypasses and re-fills); prefetch warms suites/runs/meta/sections/cases per
 * project in the background with {active,done,total} progress.
 */

/** Thrown when a TestRail call is attempted with no active session → 401. */
export class TestRailNotConnectedError extends Error {
  constructor() {
    super('Not connected to TestRail. Open Settings and connect first.');
    this.name = 'TestRailNotConnectedError';
  }
}

export interface TrSessionStatus {
  connected: boolean;
  baseUrl: string | null;
  email: string | null;
  user: TrUser | null;
}

export interface TrPrefetchProgress {
  active: boolean;
  done: number;
  total: number;
}

export interface TrMeta {
  users: TrUser[];
  statuses: TrStatus[];
  caseTypes: TrCaseType[];
  priorities: TrPriority[];
}

function defaultClientFactory(connection: TrConnection): TestRailClientLike {
  return new TestRailClient(new TestRailHttp(connection));
}

/** %APPDATA%\TestRailWeb\people.json — the standalone app's people store. */
function legacyPeopleFile(): string {
  const appData =
    process.env.APPDATA && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'TestRailWeb', 'people.json');
}

export class TestRailService {
  private client: TestRailClientLike | null = null;
  private connection: TrConnection | null = null;
  private currentUser: TrUser | null = null;
  private readonly progress: TrPrefetchProgress = { active: false, done: 0, total: 0 };

  constructor(
    private readonly db: Db,
    private readonly clientFactory: (connection: TrConnection) => TestRailClientLike = defaultClientFactory,
    private readonly peopleFile: string = legacyPeopleFile(),
  ) {}

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  get isConnected(): boolean {
    return this.client !== null;
  }

  status(): TrSessionStatus {
    return {
      connected: this.isConnected,
      baseUrl: this.connection?.baseUrl ?? null,
      email: this.connection?.email ?? null,
      user: this.currentUser,
    };
  }

  /** Verify via get_current_user before swapping the session in. */
  async connect(connection: TrConnection): Promise<TrUser> {
    const client = this.clientFactory(connection);
    const user = await client.getCurrentUser();
    this.client = client;
    this.connection = connection;
    this.currentUser = user;
    return user;
  }

  disconnect(): void {
    this.client = null;
    this.connection = null;
    this.currentUser = null;
  }

  requireClient(): TestRailClientLike {
    if (this.client === null) throw new TestRailNotConnectedError();
    return this.client;
  }

  // -------------------------------------------------------------------------
  // Cache
  // -------------------------------------------------------------------------

  /** In-flight background refreshes (stale-while-revalidate), keyed. */
  private readonly refreshing = new Set<string>();

  /** TTL per cache family — volatile run/test state expires fast, structure
   *  slowly. Entries past TTL are served stale ONCE while a background
   *  refresh re-fills them (previously entries never expired at all). */
  private static ttlFor(key: string): number {
    if (key.startsWith('runs:') || key.startsWith('planruns:') || key.startsWith('tests:') || key.startsWith('results:')) {
      return 3 * 60_000; // 3 minutes
    }
    return 60 * 60_000; // structure/meta: 1 hour
  }

  /** Serve from SQLite when present; `fresh` bypasses and re-fills the entry. */
  async cachedJson(key: string, fetchFn: () => Promise<unknown>, fresh: boolean): Promise<unknown> {
    if (!fresh) {
      const hit = trCacheGet(this.db, key);
      if (hit) {
        try {
          const value = JSON.parse(hit.json);
          const age = Date.now() - hit.updatedAt;
          if (age > TestRailService.ttlFor(key) && !this.refreshing.has(key)) {
            // Stale: serve it now, refresh behind the response.
            this.refreshing.add(key);
            void fetchFn()
              .then((freshValue) => trCacheSet(this.db, key, JSON.stringify(freshValue ?? null)))
              .catch(() => undefined)
              .finally(() => this.refreshing.delete(key));
          }
          return value;
        } catch {
          // corrupted entry → treated as a miss
        }
      }
    }
    const value = await fetchFn();
    trCacheSet(this.db, key, JSON.stringify(value ?? null));
    return value;
  }

  clearCache(): void {
    trCacheClear(this.db);
  }

  /** Reference data is nice-to-have; a 403 on one part (e.g. get_users for
   *  non-admins) must not take the whole app down. */
  async fetchMeta(projectId?: number | null): Promise<TrMeta> {
    const client = this.requireClient();
    const safe = async <T>(fetchOne: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fetchOne();
      } catch (err) {
        if (err instanceof TestRailApiError) return [];
        throw err;
      }
    };
    const [users, statuses, caseTypes, priorities] = await Promise.all([
      safe(() => client.getUsers(projectId)),
      safe(() => client.getStatuses()),
      safe(() => client.getCaseTypes()),
      safe(() => client.getPriorities()),
    ]);
    return { users, statuses, caseTypes, priorities };
  }

  // -------------------------------------------------------------------------
  // Prefetch (Program.cs POST /prefetch)
  // -------------------------------------------------------------------------

  prefetchStatus(): TrPrefetchProgress {
    return { ...this.progress };
  }

  prefetch(projectIds: number[]): { started: boolean; active?: boolean } {
    if (this.progress.active) return { started: false, active: true };
    this.progress.active = true;
    this.progress.done = 0;
    this.progress.total = projectIds.length * 3;
    void this.runPrefetch(projectIds);
    return { started: true };
  }

  private async runPrefetch(projectIds: number[]): Promise<void> {
    try {
      const client = this.requireClient();
      for (const pid of projectIds) {
        // Already warmed (e.g. page refresh) — skip; `fresh=1` paths keep entries current.
        if (trCacheGet(this.db, `suites:${pid}`)) {
          this.progress.done += 3;
          continue;
        }

        const suites = await client.getSuites(pid);
        trCacheSet(this.db, `suites:${pid}`, JSON.stringify(suites));
        this.progress.total += suites.length * 2;
        this.progress.done++;

        const runsTask = client.getRuns(pid).then((runs) => {
          trCacheSet(this.db, `runs:${pid}`, JSON.stringify(runs));
          this.progress.done++;
        });

        const metaTask = (async () => {
          try {
            const meta = await this.fetchMeta(pid);
            trCacheSet(this.db, `meta:${pid}`, JSON.stringify(meta));
          } catch (err) {
            if (!(err instanceof TestRailApiError)) throw err;
          }
          this.progress.done++;
        })();

        // Bounded pool (6) over suites — the serial loop warmed one suite at
        // a time, 2 sequential calls each.
        let nextSuite = 0;
        const suiteWorker = async (): Promise<void> => {
          for (;;) {
            const i = nextSuite++;
            if (i >= suites.length) return;
            const suite = suites[i];
            const sections = await client.getSections(pid, suite.id);
            trCacheSet(this.db, `sections:${pid}:${suite.id}`, JSON.stringify(sections));
            this.progress.done++;
            const cases = await client.getCases(pid, suite.id, null);
            trCacheSet(this.db, `cases:${pid}:${suite.id}:`, JSON.stringify(cases));
            this.progress.done++;
          }
        };
        await Promise.all([
          runsTask,
          metaTask,
          ...Array.from({ length: Math.min(6, suites.length) }, () => suiteWorker()),
        ]);
      }
    } catch {
      // Prefetch is best-effort; whatever landed in the cache still helps.
    } finally {
      this.progress.active = false;
    }
  }

  // -------------------------------------------------------------------------
  // People (id -> display name)
  // -------------------------------------------------------------------------

  getPeople(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const person of trPeopleAll(this.db)) map[String(person.id)] = person.name;
    return map;
  }

  /** Full replacement, matching the standalone app's PUT /people semantics. */
  setPeople(people: Record<string, unknown>): void {
    const rows = parsePeople(people);
    trPeopleClear(this.db);
    trPeopleUpsertMany(this.db, rows);
  }

  /**
   * Boot-time one-time import of %AppData%\TestRailWeb\people.json into
   * TestRailPeople when the table is empty. Absent/corrupt files are ignored.
   */
  importLegacyPeopleIfEmpty(): void {
    try {
      if (trPeopleAll(this.db).length > 0) return;
      const raw = fs.readFileSync(this.peopleFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const rows = parsePeople(parsed as Record<string, unknown>);
      if (rows.length > 0) trPeopleUpsertMany(this.db, rows);
    } catch {
      // missing or unreadable legacy store — nothing to import
    }
  }
}

function parsePeople(people: Record<string, unknown>): TestRailPerson[] {
  const rows: TestRailPerson[] = [];
  for (const [key, value] of Object.entries(people)) {
    const id = Number.parseInt(key, 10);
    if (Number.isNaN(id) || typeof value !== 'string') continue;
    rows.push({ id, name: value });
  }
  return rows;
}
