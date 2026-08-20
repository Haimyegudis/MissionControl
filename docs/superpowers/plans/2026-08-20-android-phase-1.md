# MissionControl Android — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sideloadable Android APK that runs MissionControl's Backlog (MyWork), TestRail Runs, and Settings screens against the HP external gateway, with no server process, no Lumo, and no SQLite.

**Architecture:** Extract the framework-free Jira and TestRail service layer from `server/src` into a new `@mc/core` workspace that has zero Node built-in dependencies. Add an in-process dispatcher in `core` that answers the same `(method, path, body)` contract the Express routes answer, and teach `client/src/api/client.ts` to call it instead of `fetch` when running natively. Package the existing Vite bundle in a Capacitor Android shell where `CapacitorHttp` routes `fetch` through native OkHttp (defeating CORS), credentials live in the Android Keystore behind a biometric prompt, and storage is an in-memory KV store hydrated from Capacitor Preferences and Filesystem.

**Tech Stack:** TypeScript 5.7 (strict), React 18, Vite 8, Vitest 4, Capacitor 6, Android Gradle + JDK 17, Kotlin (generated shell only).

Spec: `docs/superpowers/specs/2026-08-20-android-app-design.md`

## Global Constraints

- **No `node:` imports in `core/`.** Core runs inside a WebView. `server/src/testrail/service.ts` currently imports `node:fs`, `node:os`, `node:path` — those must be injected from the server side, not imported.
- **No new runtime dependencies in `core/`.** It uses only the platform `fetch` and injected ports.
- **Relative imports inside `core/` keep the `.js` extension** (e.g. `import { JiraSession } from './session.js'`). The server's tsconfig is `moduleResolution: NodeNext` and requires it; Vite resolves `./x.js` to `./x.ts` for TypeScript sources, so both consumers work.
- **TypeScript strict settings are non-negotiable:** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- **Client tests have no jsdom.** React tests use `renderToString` from `react-dom/server`. Never introduce `@testing-library/react`.
- **`KvStore` is synchronous.** Capacitor's storage APIs are async, so the Android implementation hydrates into memory at boot and writes through asynchronously. Repositories stay synchronous.
- **Desktop behaviour must not regress.** After every task, `npm test` at the repo root must pass. That is the regression gate for the whole plan.
- **Phase 1 Android limitations, accepted deliberately:** no saved JQL filters (`/api/filters` returns `[]`), no Teams, no pinned boards, no board workspaces, no Confluence, no Lumo, no reminders. These stay SQLite-backed and desktop-only.
- Timestamps in the KV layer are **epoch milliseconds** (`number`). The SQLite adapter converts per-table, because existing tables use mixed encodings (`IssueCache.UpdatedUtc` and `MetadataCache.UpdatedUtc` are ISO strings; `TestRailCache.updatedAt` is epoch ms).

## File Structure

**New workspace `core/`:**

| File | Responsibility |
| --- | --- |
| `core/package.json` | `@mc/core` workspace manifest, build + test scripts |
| `core/tsconfig.json` | NodeNext, emits `dist/` for the server consumer |
| `core/src/index.ts` | Barrel — the single entry point both server and client import |
| `core/src/types.ts` | Moved from `server/src/types.ts` |
| `core/src/jira/*` | Moved from `server/src/jira/*`, otherwise unchanged |
| `core/src/testrail/*` | Moved from `server/src/testrail/*`; `service.ts` loses its `node:` imports |
| `core/src/storage/kv.ts` | `KvStore` / `KvRecord` / `PeopleStore` interfaces + `MemoryKvStore` |
| `core/src/storage/repos.ts` | `AppSettingsRepo`, `IssueCacheRepo`, `MetadataCacheRepo` rebuilt on `KvStore` |
| `core/src/composition.ts` | `createCore(ports)` — builds every service from injected ports |
| `core/src/dispatch.ts` | Phase 1 route table: `(method, path, body) → DispatchResponse` |

**Modified in `server/`:**

| File | Change |
| --- | --- |
| `server/src/storage/sqliteKv.ts` (new) | `SqliteKvStore` + `SqlitePeopleStore` implementing the core ports over the existing tables |
| `server/src/storage/repositories.ts` | Jira/TestRail repos move to core; SavedFilter/Team/PinnedBoard/BoardWorkspace repos stay |
| `server/src/main.ts` | Imports services from `@mc/core`, passes `SqliteKvStore` and the legacy-people loader |
| `server/src/routes/*` | Import types from `@mc/core` instead of `../jira/*` |

**Modified in `client/`:**

| File | Change |
| --- | --- |
| `client/src/api/client.ts` | `request()` gains a native-dispatch branch; new `setNativeDispatch()` |
| `client/src/api/testrail.ts` | Same branch |
| `client/src/components/ResponsiveGrid.tsx` (new) | Breakpoint switch between `DataGrid` and `CardList` |
| `client/src/components/CardList.tsx` (new) | Card rendering of `GridColumn<T>[]` |
| `client/src/components/Modal.tsx` | Full-screen sheet below 900px |
| `client/src/components/Shell.tsx` | Bottom tab bar below 900px |
| `client/src/native/*` (new) | Capacitor bootstrap, Keystore credentials, biometric gate, KV persistence |
| `client/vite.config.ts` | `@mc/core` alias, `VITE_TARGET` define |

**New `android/`:** generated Capacitor project. Only `android/app/src/main/AndroidManifest.xml` and `android/app/build.gradle` are hand-edited.

---

## Task 1: Extract `@mc/core` workspace

Moves the framework-free service layer out of `server/src` with no behavioural change. This task is pure motion — if any test assertion needs editing, something was moved wrong.

**Files:**
- Create: `core/package.json`, `core/tsconfig.json`, `core/src/index.ts`, `core/vitest.config.ts`
- Move: `server/src/types.ts` → `core/src/types.ts`
- Move: `server/src/jira/*` (17 files) → `core/src/jira/*`
- Move: `server/src/testrail/*` → `core/src/testrail/*`
- Modify: `server/src/testrail/service.ts` (during the move — remove `node:` imports)
- Modify: `package.json` (root, add workspace), `server/package.json`, `client/vite.config.ts`
- Modify: every `server/src/**` and `server/test/**` file that imported the moved modules
- Test: `core/test/nodeFree.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: package `@mc/core`, barrel export `core/src/index.ts` re-exporting every public symbol from `types.ts`, `jira/*`, `testrail/*`. `TestRailService`'s constructor gains a fourth parameter `legacyPeople: () => TestRailPerson[] | null = () => null`, replacing the `peopleFile` string parameter.

- [ ] **Step 1: Write the failing test that guards the core boundary**

Create `core/test/nodeFree.test.ts`:

```ts
// core must run inside a WebView: no Node built-ins anywhere in src.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('core has no Node built-in imports', () => {
  it('finds no node: specifier in core/src', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const offenders = walk(srcDir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /from 'node:/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace core`
Expected: FAIL — the `core` workspace does not exist yet (`npm ERR! No workspaces found`).

- [ ] **Step 3: Create the workspace skeleton**

`core/package.json`:

```json
{
  "name": "@mc/core",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^4.1.10"
  }
}
```

`core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

`core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

Add `"core"` as the first entry of `workspaces` in the root `package.json`, and extend the root scripts:

```json
"build": "npm run build --workspace core && npm run build --workspace client && npm run build --workspace server",
"test": "npm run test --workspace core && npm run test --workspace server && npm run test --workspace client"
```

- [ ] **Step 4: Move the files with git so history survives**

```bash
mkdir -p core/src
git mv server/src/types.ts core/src/types.ts
git mv server/src/jira core/src/jira
git mv server/src/testrail core/src/testrail
```

- [ ] **Step 5: Purge the Node built-ins from `testrail/service.ts`**

Delete the three `node:` imports and the `legacyPeopleFile()` helper. Change the constructor's third parameter and the method that used it:

```ts
// core/src/testrail/service.ts — constructor
constructor(
  private readonly db: Db,
  private readonly clientFactory: (connection: TrConnection) => TestRailClientLike = defaultClientFactory,
  private readonly legacyPeople: () => TestRailPerson[] | null = () => null,
) {}
```

Rewrite `importLegacyPeopleIfEmpty()` to read from the injected callback rather than the filesystem:

```ts
/** Seed the people store from the standalone app's export, once, if empty. */
importLegacyPeopleIfEmpty(): void {
  if (trPeopleAll(this.db).length > 0) return;
  const people = this.legacyPeople();
  if (people === null || people.length === 0) return;
  trPeopleUpsertMany(this.db, people);
}
```

In `server/src/main.ts`, supply the filesystem reader that was deleted:

```ts
// server/src/main.ts
import fs from 'node:fs';
import os from 'node:os';
import type { TestRailPerson } from './storage/repositories.js';

/** %APPDATA%\TestRailWeb\people.json — the standalone app's people store. */
function legacyPeople(): TestRailPerson[] | null {
  const appData =
    process.env.APPDATA && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming');
  try {
    const raw = fs.readFileSync(path.join(appData, 'TestRailWeb', 'people.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((p): p is { id: number; name: string } =>
        p !== null && typeof p === 'object' &&
        typeof (p as { id?: unknown }).id === 'number' &&
        typeof (p as { name?: unknown }).name === 'string')
      .map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return null;
  }
}

const testRail = new TestRailService(db, undefined, legacyPeople);
```

- [ ] **Step 6: Write the barrel**

`core/src/index.ts` re-exports every symbol the server and client consume. Enumerate them explicitly — a `export *` barrel would silently widen the public surface:

```ts
export * from './types.js';
export { JiraSession, type SessionChangedListener } from './jira/session.js';
export { JiraError, apiPrefix, agilePrefix, normalizeBaseUrl, extractErrorMessage, type JiraFetchOptions } from './jira/httpClient.js';
export { JiraIssueService } from './jira/issueService.js';
export { JiraWorklogService, type AdjustEstimate } from './jira/worklogService.js';
export { JiraBoardService } from './jira/boardService.js';
export { JiraMetadataService } from './jira/metadataService.js';
export { JiraDashboardService } from './jira/dashboardService.js';
export { JiraCreateIssueService } from './jira/createIssueService.js';
export { CachedBoardService, CachedMetadataService, type BoardServiceLike, type MetadataServiceLike } from './jira/cached.js';
export { TimeLoggedService, type TimeLoggedPeriod } from './jira/timeLogged.js';
export { DashboardAggregator } from './jira/aggregator.js';
export { metadataWarmup } from './jira/warmup.js';
export { TestRailService, TestRailNotConnectedError, type TrSessionStatus, type TrPrefetchProgress, type TrMeta } from './testrail/service.js';
export { TestRailClient, type TestRailClientLike } from './testrail/client.js';
export { TestRailApiError, TestRailHttp } from './testrail/httpClient.js';
export * from './testrail/types.js';
```

If `tsc` reports a symbol that a server file imports but the barrel omits, add it. Do not add anything the server does not import.

- [ ] **Step 7: Repoint every importer**

In `server/src/**` and `server/test/**`, rewrite imports of the moved modules to the barrel. Mechanically:

```bash
grep -rln "from '\.\./jira/\|from '\./jira/\|from '\.\./testrail/\|from '\./testrail/\|from '\.\./types\.js'\|from '\./types\.js'" server/src server/test
```

Each hit becomes `from '@mc/core'`. Collapse multiple imports from moved modules in one file into a single `@mc/core` import. Add `"@mc/core": "*"` to `server/package.json` dependencies.

For Vite, alias the barrel to TypeScript source so the client does not need a prebuilt `dist`. In `client/vite.config.ts`, inside `defineConfig({...})`:

```ts
resolve: {
  alias: { '@mc/core': path.resolve(__dirname, '../core/src/index.ts') },
},
```

Add `"@mc/core": "*"` to `client/package.json` dependencies, then run `npm install` at the root to link the workspace.

- [ ] **Step 8: Run the full suite**

Run: `npm install && npm run build --workspace core && npm test`
Expected: PASS — every existing `server/test` and `client/test` file passes with **assertions unchanged**, plus `core/test/nodeFree.test.ts` passes.

If an assertion needed changing, revert and redo the move; behaviour drift is a bug, not an expected cost.

- [ ] **Step 9: Commit**

```bash
git add core server client package.json package-lock.json
git commit -m "refactor: extract framework-free Jira/TestRail layer into @mc/core"
```

---

## Task 2: `KvStore` port and the SQLite adapter

Replaces the direct `Db` dependency of the three Jira-side repositories with an injectable key/value port, so Android can supply a non-SQLite backend without duplicating repository logic.

**Files:**
- Create: `core/src/storage/kv.ts`, `core/src/storage/repos.ts`
- Create: `server/src/storage/sqliteKv.ts`
- Modify: `server/src/storage/repositories.ts` (delete the three moved repos)
- Modify: `server/src/main.ts`, `server/src/routes/deps.ts`
- Test: `core/test/kv.test.ts`, `server/test/storage.test.ts`

**Interfaces:**
- Consumes: `@mc/core` barrel from Task 1; `AppSettings`, `JiraIssue`, `defaultAppSettings()` from `core/src/types.ts`.
- Produces:
  ```ts
  export type KvTable = 'appSettings' | 'issueCache' | 'metadataCache' | 'trCache';
  export interface KvRecord { json: string; updatedAt: number }
  export interface KvStore {
    get(table: KvTable, key: string): KvRecord | null;
    set(table: KvTable, key: string, json: string, now?: number): void;
    delete(table: KvTable, key: string): void;
    clear(table: KvTable): void;
  }
  export class MemoryKvStore implements KvStore { ... }
  export class AppSettingsRepo { constructor(kv: KvStore); get(): AppSettings; save(s: AppSettings): void }
  export class IssueCacheRepo { constructor(kv: KvStore); getCached(k: string): JiraIssue[]; saveCache(k: string, issues: JiraIssue[]): void; getLastRefresh(k: string): Date | null; clearAll(): void }
  export class MetadataCacheRepo { constructor(kv: KvStore); get(k: string): MetadataCacheEntry | null; set(k: string, json: string): void; delete(k: string): void; clearAll(): void }
  ```
  Method names and signatures are byte-identical to the current SQLite versions, so no caller changes.

- [ ] **Step 1: Write the failing test**

Create `core/test/kv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemoryKvStore } from '../src/storage/kv.js';
import { AppSettingsRepo, IssueCacheRepo, MetadataCacheRepo } from '../src/storage/repos.js';
import type { JiraIssue } from '../src/types.js';

function issue(key: string): JiraIssue {
  return { key, summary: `s-${key}` } as JiraIssue;
}

describe('MemoryKvStore', () => {
  it('round-trips a value and stamps updatedAt from the injected clock', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'runs', '{"a":1}', 1_700_000_000_000);
    expect(kv.get('trCache', 'runs')).toEqual({ json: '{"a":1}', updatedAt: 1_700_000_000_000 });
  });

  it('returns null for a missing key and isolates tables', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'k', '1', 1);
    expect(kv.get('trCache', 'missing')).toBeNull();
    expect(kv.get('issueCache', 'k')).toBeNull();
  });

  it('clear removes only the named table', () => {
    const kv = new MemoryKvStore();
    kv.set('trCache', 'k', '1', 1);
    kv.set('issueCache', 'k', '2', 1);
    kv.clear('trCache');
    expect(kv.get('trCache', 'k')).toBeNull();
    expect(kv.get('issueCache', 'k')?.json).toBe('2');
  });
});

describe('AppSettingsRepo over KvStore', () => {
  it('returns defaults when nothing is stored', () => {
    const repo = new AppSettingsRepo(new MemoryKvStore());
    expect(repo.get().theme).toBeDefined();
  });

  it('merges stored values over defaults', () => {
    const kv = new MemoryKvStore();
    const repo = new AppSettingsRepo(kv);
    const saved = { ...repo.get(), theme: 'light' as const };
    repo.save(saved);
    expect(repo.get().theme).toBe('light');
  });

  it('falls back to defaults on corrupt JSON', () => {
    const kv = new MemoryKvStore();
    kv.set('appSettings', '1', 'not json', 1);
    expect(new AppSettingsRepo(kv).get().theme).toBeDefined();
  });
});

describe('IssueCacheRepo over KvStore', () => {
  it('round-trips issues and exposes the write time', () => {
    const kv = new MemoryKvStore();
    const repo = new IssueCacheRepo(kv, () => 1_700_000_000_000);
    repo.saveCache('mywork', [issue('AAA-1')]);
    expect(repo.getCached('mywork').map((i) => i.key)).toEqual(['AAA-1']);
    expect(repo.getLastRefresh('mywork')?.getTime()).toBe(1_700_000_000_000);
  });

  it('returns an empty array and a null refresh time for an unknown key', () => {
    const repo = new IssueCacheRepo(new MemoryKvStore());
    expect(repo.getCached('nope')).toEqual([]);
    expect(repo.getLastRefresh('nope')).toBeNull();
  });
});

describe('MetadataCacheRepo over KvStore', () => {
  it('stores a pre-serialized string and returns a Date', () => {
    const repo = new MetadataCacheRepo(new MemoryKvStore(), () => 1_700_000_000_000);
    repo.set('projects', '["A"]');
    expect(repo.get('projects')).toEqual({ json: '["A"]', updatedUtc: new Date(1_700_000_000_000) });
    repo.delete('projects');
    expect(repo.get('projects')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace core -- kv`
Expected: FAIL with "Cannot find module '../src/storage/kv.js'".

- [ ] **Step 3: Implement `core/src/storage/kv.ts`**

```ts
// Key/value port. Synchronous by contract: repositories are synchronous, and
// the Android backend hydrates into memory at boot rather than making every
// caller async.

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

/** TestRail's people list is a flat id→name table, not a JSON cache. */
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
```

- [ ] **Step 4: Implement `core/src/storage/repos.ts`**

Copy the three repository classes out of `server/src/storage/repositories.ts` and swap their SQL for `KvStore` calls. Keep `toCamelKeys` / `toPascalKeys` / `SETTINGS_DICT_FIELDS_*` behaviour identical — move those helpers into this file too, since they are only used by the moved repos.

```ts
import type { AppSettings, JiraIssue } from '../types.js';
import { defaultAppSettings } from '../types.js';
import type { KvStore } from './kv.js';

// toPascalKeys / toCamelKeys / SETTINGS_DICT_FIELDS_PASCAL / SETTINGS_DICT_FIELDS_CAMEL
// are moved verbatim from server/src/storage/repositories.ts.

const SETTINGS_KEY = '1';

export class AppSettingsRepo {
  constructor(private readonly kv: KvStore) {}

  get(): AppSettings {
    const defaults = defaultAppSettings();
    const row = this.kv.get('appSettings', SETTINGS_KEY);
    if (!row || !row.json) return defaults;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.json);
    } catch {
      return defaults;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    const stored = toCamelKeys<Partial<AppSettings>>(parsed, SETTINGS_DICT_FIELDS_PASCAL);
    return { ...defaults, ...stored };
  }

  save(settings: AppSettings): void {
    this.kv.set('appSettings', SETTINGS_KEY, JSON.stringify(toPascalKeys(settings, SETTINGS_DICT_FIELDS_CAMEL)));
  }
}

export class IssueCacheRepo {
  constructor(
    private readonly kv: KvStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getCached(cacheKey: string): JiraIssue[] {
    const row = this.kv.get('issueCache', cacheKey);
    if (!row || !row.json) return [];
    try {
      const parsed: unknown = JSON.parse(row.json);
      if (!Array.isArray(parsed)) return [];
      return toCamelKeys<JiraIssue[]>(parsed);
    } catch {
      return [];
    }
  }

  saveCache(cacheKey: string, issues: JiraIssue[]): void {
    this.kv.set('issueCache', cacheKey, JSON.stringify(toPascalKeys(issues)), this.now());
  }

  getLastRefresh(cacheKey: string): Date | null {
    const row = this.kv.get('issueCache', cacheKey);
    return row ? new Date(row.updatedAt) : null;
  }

  clearAll(): void {
    this.kv.clear('issueCache');
  }
}

export interface MetadataCacheEntry {
  json: string;
  updatedUtc: Date;
}

export class MetadataCacheRepo {
  constructor(
    private readonly kv: KvStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(cacheKey: string): MetadataCacheEntry | null {
    const row = this.kv.get('metadataCache', cacheKey);
    return row ? { json: row.json, updatedUtc: new Date(row.updatedAt) } : null;
  }

  set(cacheKey: string, json: string): void {
    this.kv.set('metadataCache', cacheKey, json, this.now());
  }

  delete(cacheKey: string): void {
    this.kv.delete('metadataCache', cacheKey);
  }

  clearAll(): void {
    this.kv.clear('metadataCache');
  }
}
```

Export all of `kv.ts` and `repos.ts` from `core/src/index.ts`.

- [ ] **Step 5: Run the core tests**

Run: `npm test --workspace core -- kv`
Expected: PASS.

- [ ] **Step 6: Write the failing SQLite-adapter test**

Append to `server/test/storage.test.ts`:

```ts
import { SqliteKvStore, SqlitePeopleStore } from '../src/storage/sqliteKv.js';
import { AppSettingsRepo, IssueCacheRepo, MetadataCacheRepo } from '@mc/core';

describe('SqliteKvStore', () => {
  it('persists app settings through the KV port', () => {
    const db = openDb(':memory:');
    const repo = new AppSettingsRepo(new SqliteKvStore(db));
    const next = { ...repo.get(), theme: 'light' as const };
    repo.save(next);
    expect(new AppSettingsRepo(new SqliteKvStore(db)).get().theme).toBe('light');
  });

  it('stores issue-cache timestamps as ISO and reads them back as epoch ms', () => {
    const db = openDb(':memory:');
    const kv = new SqliteKvStore(db);
    kv.set('issueCache', 'mywork', '[]', 1_700_000_000_000);
    expect(kv.get('issueCache', 'mywork')?.updatedAt).toBe(1_700_000_000_000);
  });

  it('stores TestRail cache timestamps as epoch ms', () => {
    const db = openDb(':memory:');
    const kv = new SqliteKvStore(db);
    kv.set('trCache', 'runs', '[]', 1_700_000_000_000);
    expect(kv.get('trCache', 'runs')).toEqual({ json: '[]', updatedAt: 1_700_000_000_000 });
  });

  it('round-trips people', () => {
    const db = openDb(':memory:');
    const people = new SqlitePeopleStore(db);
    people.upsertMany([{ id: 2, name: 'B' }, { id: 1, name: 'A' }]);
    expect(people.all()).toEqual([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    people.clear();
    expect(people.all()).toEqual([]);
  });
});

describe('MetadataCacheRepo over SqliteKvStore', () => {
  it('round-trips a metadata entry', () => {
    const db = openDb(':memory:');
    const repo = new MetadataCacheRepo(new SqliteKvStore(db), () => 1_700_000_000_000);
    repo.set('projects', '["A"]');
    expect(repo.get('projects')?.updatedUtc.getTime()).toBe(1_700_000_000_000);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test --workspace server -- storage`
Expected: FAIL with "Cannot find module '../src/storage/sqliteKv.js'".

- [ ] **Step 8: Implement `server/src/storage/sqliteKv.ts`**

```ts
// SqliteKvStore — maps the core KvStore port onto the existing tables so the
// desktop build keeps its schema and its data. Timestamp encodings differ per
// table, so each descriptor declares its own.

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
```

- [ ] **Step 9: Delete the superseded repos and rewire `main.ts`**

Remove `AppSettingsRepo`, `IssueCacheRepo`, `MetadataCacheRepo`, `MetadataCacheEntry`, and the `toPascalKeys`/`toCamelKeys`/`SETTINGS_DICT_FIELDS_*` helpers from `server/src/storage/repositories.ts` if no remaining repo in that file uses them. `SavedFilterRepo`, `TeamRepo`, `PinnedBoardRepo`, `BoardWorkspaceRepo` stay.

In `server/src/main.ts`:

```ts
const kv = new SqliteKvStore(db);
const appSettings = new AppSettingsRepo(kv);
const issueCache = new IssueCacheRepo(kv);
const metadataCache = new MetadataCacheRepo(kv);
```

In `server/src/routes/deps.ts`, import `AppSettingsRepo`/`IssueCacheRepo`/`MetadataCacheEntry` types from `@mc/core`.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS, all three workspaces.

- [ ] **Step 11: Commit**

```bash
git add core server
git commit -m "refactor: put Jira storage repos behind a KvStore port"
```

---

## Task 3: `TestRailService` on the KV port

Removes the last `Db` dependency from core.

**Files:**
- Modify: `core/src/testrail/service.ts`
- Modify: `server/src/main.ts`
- Modify: `server/src/storage/repositories.ts` (delete `trCache*` / `trPeople*` functions)
- Test: `core/test/testrailKv.test.ts`

**Interfaces:**
- Consumes: `KvStore`, `PeopleStore`, `MemoryKvStore`, `MemoryPeopleStore`, `TestRailPerson` from Task 2.
- Produces: `new TestRailService(kv: KvStore, people: PeopleStore, clientFactory?, legacyPeople?)`. Parameter order changes — `db` becomes two ports. Every existing `TestRailService` behaviour and public method keeps its current name and signature.

- [ ] **Step 1: Write the failing test**

Create `core/test/testrailKv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemoryKvStore, MemoryPeopleStore } from '../src/storage/kv.js';
import { TestRailService, TestRailNotConnectedError } from '../src/testrail/service.js';

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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace core -- testrailKv`
Expected: FAIL — `TestRailService` still requires a `Db`.

- [ ] **Step 3: Rewrite the service's storage calls**

In `core/src/testrail/service.ts`, replace the `Db` import and the free-function cache calls:

```ts
import type { KvStore, PeopleStore, TestRailPerson } from '../storage/kv.js';

export class TestRailService {
  // ...existing private fields unchanged...

  constructor(
    private readonly kv: KvStore,
    private readonly people: PeopleStore,
    private readonly clientFactory: (connection: TrConnection) => TestRailClientLike = defaultClientFactory,
    private readonly legacyPeople: () => TestRailPerson[] | null = () => null,
  ) {}

  importLegacyPeopleIfEmpty(): void {
    if (this.people.all().length > 0) return;
    const seeded = this.legacyPeople();
    if (seeded === null || seeded.length === 0) return;
    this.people.upsertMany(seeded);
  }
}
```

Then substitute call sites throughout the file:

| Was | Becomes |
| --- | --- |
| `trCacheGet(this.db, key)` | `this.kv.get('trCache', key)` — the returned field is `updatedAt`, same name |
| `trCacheSet(this.db, key, json)` | `this.kv.set('trCache', key, json)` |
| `trCacheClear(this.db)` | `this.kv.clear('trCache')` |
| `trPeopleAll(this.db)` | `this.people.all()` |
| `trPeopleUpsertMany(this.db, rows)` | `this.people.upsertMany(rows)` |
| `trPeopleClear(this.db)` | `this.people.clear()` |

`KvRecord` and `TestRailCacheEntry` are structurally identical (`{ json, updatedAt }`), so the cache-freshness logic needs no change. Delete the now-unused `TestRailCacheEntry` import.

- [ ] **Step 4: Run the core tests**

Run: `npm test --workspace core`
Expected: PASS.

- [ ] **Step 5: Rewire the server and delete the dead SQL**

`server/src/main.ts`:

```ts
const testRail = new TestRailService(kv, new SqlitePeopleStore(db), undefined, legacyPeople);
```

Delete `trCacheGet`, `trCacheSet`, `trCacheClear`, `TestRailCacheEntry`, `trPeopleAll`, `trPeopleUpsertMany`, `trPeopleClear`, and `TestRailPerson` from `server/src/storage/repositories.ts`. Re-export `TestRailPerson` from `@mc/core` wherever the server still names the type.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. `server/test/testrailPagination.test.ts` and `server/test/testrailPlanRuns.test.ts` construct `TestRailService`; update those construction calls to the two-port form. Assertions stay unchanged.

- [ ] **Step 7: Commit**

```bash
git add core server
git commit -m "refactor: TestRailService depends on KV ports, not SQLite"
```

---

## Task 4: Core composition root

One function that assembles every service from injected ports, so the Android bootstrap and the desktop `main.ts` build the same object graph.

**Files:**
- Create: `core/src/composition.ts`
- Test: `core/test/composition.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  ```ts
  export interface CorePorts {
    kv: KvStore;
    people: PeopleStore;
    credentials: { load(): Credentials | null; save(c: Credentials): void; clear(): void };
  }
  export interface Core {
    session: JiraSession;
    issues: JiraIssueService;
    worklogs: JiraWorklogService;
    boards: CachedBoardService;
    metadata: CachedMetadataService;
    timeLogged: TimeLoggedService;
    testrail: TestRailService;
    settings: AppSettingsRepo;
    issueCache: IssueCacheRepo;
    credentials: CorePorts['credentials'];
    getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]>;
    testConnection(creds: Credentials): Promise<JiraUser>;
  }
  export function createCore(ports: CorePorts): Core;
  ```
  `Credentials` moves from `server/src/config/credentialsStore.ts` into `core/src/types.ts` as a plain interface (the DPAPI class stays in the server).

- [ ] **Step 1: Write the failing test**

Create `core/test/composition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/composition.js';
import { MemoryKvStore, MemoryPeopleStore } from '../src/storage/kv.js';
import type { Credentials } from '../src/types.js';

function ports() {
  let stored: Credentials | null = null;
  return {
    kv: new MemoryKvStore(),
    people: new MemoryPeopleStore(),
    credentials: {
      load: () => stored,
      save: (c: Credentials) => { stored = c; },
      clear: () => { stored = null; },
    },
  };
}

describe('createCore', () => {
  it('builds a disconnected graph when no credentials are stored', () => {
    const core = createCore(ports());
    expect(core.session.isConnected).toBe(false);
    expect(core.testrail.isConnected).toBe(false);
  });

  it('exposes settings backed by the injected KV store', () => {
    const p = ports();
    const core = createCore(p);
    core.settings.save({ ...core.settings.get(), theme: 'light' });
    expect(createCore(p).settings.get().theme).toBe('light');
  });

  it('shares one session instance across the Jira services', () => {
    const core = createCore(ports());
    expect(core.issues).toBeDefined();
    expect(core.worklogs).toBeDefined();
    expect(core.timeLogged).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace core -- composition`
Expected: FAIL with "Cannot find module '../src/composition.js'".

- [ ] **Step 3: Move the `Credentials` interface into core**

Cut the `Credentials` and `JiraInstanceType` declarations out of `server/src/config/credentialsStore.ts` and paste them into `core/src/types.ts`. In `credentialsStore.ts`, import them back: `import type { Credentials, JiraInstanceType } from '@mc/core';` and re-export for existing consumers: `export type { Credentials, JiraInstanceType };`

- [ ] **Step 4: Implement `core/src/composition.ts`**

```ts
// Composition root shared by the desktop server and the Android shell. Both
// build the identical service graph; only the injected ports differ.

import { JiraSession } from './jira/session.js';
import { JiraIssueService } from './jira/issueService.js';
import { JiraWorklogService } from './jira/worklogService.js';
import { JiraBoardService } from './jira/boardService.js';
import { JiraMetadataService } from './jira/metadataService.js';
import { CachedBoardService, CachedMetadataService } from './jira/cached.js';
import { TimeLoggedService } from './jira/timeLogged.js';
import { TestRailService } from './testrail/service.js';
import { AppSettingsRepo, IssueCacheRepo, MetadataCacheRepo } from './storage/repos.js';
import type { KvStore, PeopleStore } from './storage/kv.js';
import type { Credentials, JiraUser } from './types.js';

export interface CredentialsPort {
  load(): Credentials | null;
  save(credentials: Credentials): void;
  clear(): void;
}

export interface CorePorts {
  kv: KvStore;
  people: PeopleStore;
  credentials: CredentialsPort;
}

export interface Core {
  session: JiraSession;
  issues: JiraIssueService;
  worklogs: JiraWorklogService;
  boards: CachedBoardService;
  metadata: CachedMetadataService;
  timeLogged: TimeLoggedService;
  testrail: TestRailService;
  settings: AppSettingsRepo;
  issueCache: IssueCacheRepo;
  credentials: CredentialsPort;
  getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]>;
  testConnection(creds: Credentials): Promise<JiraUser>;
}

export function createCore(ports: CorePorts): Core {
  const session = new JiraSession();
  const metadataCache = new MetadataCacheRepo(ports.kv);
  const issues = new JiraIssueService(session);
  const worklogs = new JiraWorklogService(session);
  const boards = new CachedBoardService(new JiraBoardService(session), metadataCache);
  const metadata = new CachedMetadataService(new JiraMetadataService(session), metadataCache);
  const timeLogged = new TimeLoggedService(session, issues, worklogs);
  const testrail = new TestRailService(ports.kv, ports.people);

  return {
    session,
    issues,
    worklogs,
    boards,
    metadata,
    timeLogged,
    testrail,
    settings: new AppSettingsRepo(ports.kv),
    issueCache: new IssueCacheRepo(ports.kv),
    credentials: ports.credentials,
    getDistinct: (projectKey, fieldName, maxIssues) =>
      metadata.getDistinct(projectKey, fieldName, () =>
        issues.getDistinctIssueField(projectKey, fieldName, maxIssues, metadata),
      ),
    testConnection: (creds) => {
      const probe = new JiraSession();
      probe.activate(creds, null);
      return new JiraIssueService(probe).getCurrentUser();
    },
  };
}
```

Export `composition.js` from the barrel.

- [ ] **Step 5: Run the core tests**

Run: `npm test --workspace core`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add core server
git commit -m "feat(core): composition root shared by desktop and mobile"
```

---

## Task 5: In-process dispatcher

Answers the exact HTTP contract the Express routes answer, without Express. Only the Phase 1 paths are implemented; anything else returns 404 so an unported screen fails loudly instead of silently misbehaving.

**Files:**
- Create: `core/src/dispatch.ts`
- Test: `core/test/dispatch.test.ts`

**Interfaces:**
- Consumes: `Core` from Task 4; `CACHE_FRESH_MS`, `DELTA_SLACK_MS`, `formatJqlMinute`, `injectUpdatedClause` — these move from `server/src/routes/issues.ts` into `core/src/dispatch.ts` and are re-imported by the route file.
- Produces:
  ```ts
  export interface DispatchResponse { status: number; body: unknown }
  export type Dispatch = (method: string, path: string, body?: unknown) => Promise<DispatchResponse>;
  export function createDispatcher(core: Core): Dispatch;
  ```

**Phase 1 route table** (everything else → `{ status: 404, body: { message: 'Not available in the mobile build.' } }`):

| Method | Path | Handler |
| --- | --- | --- |
| GET | `/api/auth/status` | session state |
| POST | `/api/auth/test` | `core.testConnection` |
| POST | `/api/auth/login` | save credentials + activate |
| POST | `/api/auth/logout` | clear session |
| POST | `/api/issues/search` | `core.issues.searchIssues` |
| GET | `/api/issues/:key` | `core.issues.getIssueDetails` |
| GET | `/api/issues/:key/timeline` | `core.issues.getIssueTimeline` |
| GET | `/api/issues/:key/transitions` | `core.issues.getTransitions` |
| POST | `/api/issues/:key/transitions` | `core.issues.performTransition` |
| POST | `/api/issues/:key/comments` | `core.issues.addComment` |
| PUT | `/api/issues/:key/assignee` | `core.issues.setAssignee` |
| GET | `/api/issues/:key/worklogs` | `core.worklogs.getWorklogs` |
| POST | `/api/issues/:key/worklogs` | `core.worklogs.addWorklog` |
| GET | `/api/settings` | `core.settings.get` |
| PUT | `/api/settings` | load-then-merge-then-save |
| POST | `/api/settings/clear-issue-cache` | `core.issueCache.clearAll` |
| GET | `/api/metadata/users` | `core.metadata.getUsers` |
| GET | `/api/metadata/statuses` | `core.metadata.getStatuses` |
| GET | `/api/filters` | `[]` (Phase 1 limitation) |
| GET/POST/PUT/DELETE | `/api/testrail/*` | delegate to `core.testrail` |

- [ ] **Step 1: Write the failing test**

Create `core/test/dispatch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDispatcher } from '../src/dispatch.js';
import type { Core } from '../src/composition.js';

function fakeCore(overrides: Partial<Core> = {}): Core {
  const settings = { theme: 'dark' };
  return {
    session: { isConnected: false, currentUser: null, profile: null, activate: vi.fn(), clear: vi.fn() },
    issues: { searchIssues: vi.fn(async () => ({ items: [], total: 0 })), getIssueDetails: vi.fn(async () => ({ key: 'A-1' })) },
    settings: { get: () => settings, save: vi.fn() },
    issueCache: { clearAll: vi.fn() },
    credentials: { load: () => null, save: vi.fn(), clear: vi.fn() },
    ...overrides,
  } as unknown as Core;
}

describe('createDispatcher', () => {
  it('returns 404 for a path outside the Phase 1 table', async () => {
    const res = await createDispatcher(fakeCore())('GET', '/api/dashboard/snapshot');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not available in the mobile build.' });
  });

  it('reports auth status from the session', async () => {
    const res = await createDispatcher(fakeCore())('GET', '/api/auth/status');
    expect(res).toEqual({ status: 200, body: { connected: false, user: null } });
  });

  it('routes an issue search to the issue service', async () => {
    const core = fakeCore();
    const res = await createDispatcher(core)('POST', '/api/issues/search', { jql: 'project = X', startAt: 0, maxResults: 50 });
    expect(res.status).toBe(200);
    expect(core.issues.searchIssues).toHaveBeenCalledWith('project = X', 0, 50);
  });

  it('decodes a URL-encoded issue key from the path', async () => {
    const core = fakeCore();
    await createDispatcher(core)('GET', '/api/issues/ABC-1');
    expect(core.issues.getIssueDetails).toHaveBeenCalledWith('ABC-1');
  });

  it('merges a partial settings PUT over the stored object', async () => {
    const core = fakeCore();
    await createDispatcher(core)('PUT', '/api/settings', { theme: 'light' });
    expect(core.settings.save).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('returns an empty saved-filter list in the mobile build', async () => {
    const res = await createDispatcher(fakeCore())('GET', '/api/filters');
    expect(res).toEqual({ status: 200, body: [] });
  });

  it('maps a thrown JiraError onto its status', async () => {
    const core = fakeCore({
      issues: { getIssueDetails: vi.fn(async () => { throw Object.assign(new Error('nope'), { name: 'JiraError', status: 403 }); }) } as unknown as Core['issues'],
    });
    const res = await createDispatcher(core)('GET', '/api/issues/A-1');
    expect(res).toEqual({ status: 403, body: { message: 'nope' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace core -- dispatch`
Expected: FAIL with "Cannot find module '../src/dispatch.js'".

- [ ] **Step 3: Move the MyWork cache constants into core**

Cut `CACHE_FRESH_MS`, `DELTA_SLACK_MS`, `formatJqlMinute`, and `injectUpdatedClause` from `server/src/routes/issues.ts` into `core/src/dispatch.ts` verbatim and export them. In `server/src/routes/issues.ts`, replace them with `import { CACHE_FRESH_MS, DELTA_SLACK_MS, formatJqlMinute, injectUpdatedClause } from '@mc/core';` and re-export so `server/test/routes.test.ts` keeps importing them from the same place.

- [ ] **Step 4: Implement `core/src/dispatch.ts`**

```ts
// In-process route dispatcher. Answers the same (method, path, body) contract
// as the Express routes so client/src/api/* needs no per-endpoint change. Only
// Phase 1 paths exist; everything else 404s loudly.

import type { Core } from './composition.js';
import type { AppSettings, Credentials } from './types.js';

export interface DispatchResponse {
  status: number;
  body: unknown;
}

export type Dispatch = (method: string, path: string, body?: unknown) => Promise<DispatchResponse>;

/** Issue-cache freshness window (ui-parity §2): 1 hour. */
export const CACHE_FRESH_MS = 60 * 60 * 1000;
/** Delta lower bound = last refresh − 2 minutes. */
export const DELTA_SLACK_MS = 2 * 60 * 1000;

// formatJqlMinute and injectUpdatedClause move here verbatim from
// server/src/routes/issues.ts.

const NOT_FOUND: DispatchResponse = { status: 404, body: { message: 'Not available in the mobile build.' } };

function ok(body: unknown): DispatchResponse {
  return { status: 200, body };
}

function errorResponse(err: unknown): DispatchResponse {
  const e = err as { name?: string; status?: number; message?: string };
  const status = typeof e.status === 'number' ? e.status : 500;
  return { status, body: { message: e.message ?? 'Request failed.' } };
}

/** Split "/api/issues/ABC-1/worklogs?x=1" into decoded segments + query. */
function parse(path: string): { segments: string[]; query: URLSearchParams } {
  const [rawPath, rawQuery = ''] = path.split('?', 2);
  return {
    segments: rawPath.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(rawQuery),
  };
}

export function createDispatcher(core: Core): Dispatch {
  async function route(method: string, segments: string[], query: URLSearchParams, body: unknown): Promise<DispatchResponse> {
    const [api, group, ...rest] = segments;
    if (api !== 'api') return NOT_FOUND;
    const b = (body ?? {}) as Record<string, unknown>;

    if (group === 'auth') {
      const action = rest[0];
      if (method === 'GET' && action === 'status') {
        return ok({ connected: core.session.isConnected, user: core.session.currentUser });
      }
      if (method === 'POST' && action === 'test') {
        return ok(await core.testConnection(b as unknown as Credentials));
      }
      if (method === 'POST' && action === 'login') {
        const creds = b as unknown as Credentials;
        const user = await core.testConnection(creds);
        core.credentials.save(creds);
        core.session.activate(creds, user);
        return ok({ connected: true, user });
      }
      if (method === 'POST' && action === 'logout') {
        core.session.clear();
        return { status: 204, body: undefined };
      }
      return NOT_FOUND;
    }

    if (group === 'issues') {
      if (method === 'POST' && rest[0] === 'search') {
        const jql = String(b.jql ?? '');
        const startAt = Number(b.startAt ?? 0);
        const maxResults = Number(b.maxResults ?? 100);
        return ok(await core.issues.searchIssues(jql, startAt, maxResults));
      }
      const key = rest[0];
      if (!key) return NOT_FOUND;
      const sub = rest[1];
      if (method === 'GET' && sub === undefined) return ok(await core.issues.getIssueDetails(key));
      if (method === 'GET' && sub === 'timeline') return ok(await core.issues.getIssueTimeline(key));
      if (method === 'GET' && sub === 'transitions' && rest[2] === undefined) {
        return ok(await core.issues.getTransitions(key));
      }
      if (method === 'POST' && sub === 'transitions') {
        await core.issues.performTransition(key, b as never);
        return { status: 204, body: undefined };
      }
      if (method === 'POST' && sub === 'comments') {
        await core.issues.addComment(key, String(b.body ?? ''));
        return { status: 204, body: undefined };
      }
      if (method === 'PUT' && sub === 'assignee') {
        await core.issues.setAssignee(key, String(b.assignee ?? ''));
        return { status: 204, body: undefined };
      }
      if (method === 'GET' && sub === 'worklogs') return ok(await core.worklogs.getWorklogs(key));
      if (method === 'POST' && sub === 'worklogs') return ok(await core.worklogs.addWorklog(key, b as never));
      return NOT_FOUND;
    }

    if (group === 'settings') {
      if (method === 'GET' && rest.length === 0) return ok(core.settings.get());
      if (method === 'PUT' && rest.length === 0) {
        const merged = { ...core.settings.get(), ...(b as Partial<AppSettings>) } as AppSettings;
        core.settings.save(merged);
        return ok(merged);
      }
      if (method === 'POST' && rest[0] === 'clear-issue-cache') {
        core.issueCache.clearAll();
        return { status: 204, body: undefined };
      }
      return NOT_FOUND;
    }

    if (group === 'metadata') {
      if (method === 'GET' && rest[0] === 'users') {
        return ok(await core.metadata.getUsers(query.get('project') ?? undefined));
      }
      if (method === 'GET' && rest[0] === 'statuses') return ok(await core.metadata.getStatuses());
      return NOT_FOUND;
    }

    // Saved filters are desktop-only in Phase 1; an empty list keeps the
    // Backlog's JQL dialog functional instead of throwing.
    if (group === 'filters' && method === 'GET') return ok([]);

    if (group === 'testrail') return testrailRoute(core, method, rest, query, b);

    return NOT_FOUND;
  }

  return async (method, path, body) => {
    const { segments, query } = parse(path);
    try {
      return await route(method.toUpperCase(), segments, query, body);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
```

`testrailRoute` is a sibling function in the same file mirroring `server/src/routes/testrail.ts` for the Phase 1 subset: `session` (GET/POST/DELETE), `meta`, `projects`, `projects/:id/suites`, `projects/:id/runs`, `runs/:id/tests`, `runs/:id/results`, `tests/:id/results`, `add-result`. Read `server/src/routes/testrail.ts` and port exactly those handlers, keeping the `{ error, statusCode, body }` error shape that `TrApiError` parses.

- [ ] **Step 5: Run the core tests**

Run: `npm test --workspace core -- dispatch`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `server/test/routes.test.ts` still imports the four MyWork helpers from `server/src/routes/issues.ts` and finds the re-exports.

- [ ] **Step 7: Commit**

```bash
git add core server
git commit -m "feat(core): in-process dispatcher for the Phase 1 route surface"
```

---

## Task 6: Client API native branch

Teaches the two typed API clients to call the dispatcher instead of the network, with zero changes to any view.

**Files:**
- Modify: `client/src/api/client.ts`, `client/src/api/testrail.ts`
- Test: `client/test/apiNative.test.ts`

**Interfaces:**
- Consumes: `Dispatch`, `DispatchResponse` from Task 5.
- Produces: `setNativeDispatch(dispatch: Dispatch | null): void`, exported from `client/src/api/client.ts`. Passing `null` restores HTTP mode (tests rely on this for cleanup). `client/src/api/testrail.ts` imports the same module-level dispatch rather than owning its own.

- [ ] **Step 1: Write the failing test**

Create `client/test/apiNative.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, issues, setNativeDispatch } from '../src/api/client';
import { TrApiError, trApi } from '../src/api/testrail';

afterEach(() => setNativeDispatch(null));

describe('native dispatch mode', () => {
  it('routes a GET through the dispatcher, not fetch', async () => {
    const dispatch = vi.fn(async () => ({ status: 200, body: { key: 'A-1' } }));
    setNativeDispatch(dispatch);
    await expect(issues.details('A-1')).resolves.toEqual({ key: 'A-1' });
    expect(dispatch).toHaveBeenCalledWith('GET', '/api/issues/A-1', undefined);
  });

  it('passes the JSON body straight through without stringifying', async () => {
    const dispatch = vi.fn(async () => ({ status: 200, body: { items: [], total: 0 } }));
    setNativeDispatch(dispatch);
    await issues.search('project = X', 0, 50);
    expect(dispatch).toHaveBeenCalledWith('POST', '/api/issues/search', { jql: 'project = X', startAt: 0, maxResults: 50 });
  });

  it('throws ApiError carrying the dispatcher status and message', async () => {
    setNativeDispatch(async () => ({ status: 403, body: { message: 'Forbidden' } }));
    await expect(issues.details('A-1')).rejects.toMatchObject({ name: 'ApiError', status: 403, message: 'Forbidden' });
    expect(ApiError).toBeDefined();
  });

  it('resolves undefined for a 204', async () => {
    setNativeDispatch(async () => ({ status: 204, body: undefined }));
    await expect(issues.addComment('A-1', 'hi')).resolves.toBeUndefined();
  });

  it('shares the dispatcher with the TestRail client and preserves its error shape', async () => {
    setNativeDispatch(async () => ({ status: 502, body: { error: 'TestRail said no', statusCode: 400, body: 'detail' } }));
    await expect(trApi.projects()).rejects.toMatchObject({
      name: 'TrApiError', status: 502, message: 'TestRail said no', trStatus: 400, body: 'detail',
    });
    expect(TrApiError).toBeDefined();
  });

  it('falls back to fetch when no dispatcher is installed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ key: 'A-2' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(issues.details('A-2')).resolves.toEqual({ key: 'A-2' });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- apiNative`
Expected: FAIL with "does not provide an export named 'setNativeDispatch'".

- [ ] **Step 3: Add the branch to `client/src/api/client.ts`**

Insert above `request`:

```ts
export interface DispatchResponse {
  status: number;
  body: unknown;
}

export type Dispatch = (method: string, path: string, body?: unknown) => Promise<DispatchResponse>;

let nativeDispatch: Dispatch | null = null;

/**
 * Install the in-process dispatcher (Android build). Passing null restores
 * HTTP mode. Both api/client and api/testrail read this single slot.
 */
export function setNativeDispatch(dispatch: Dispatch | null): void {
  nativeDispatch = dispatch;
}

export function getNativeDispatch(): Dispatch | null {
  return nativeDispatch;
}
```

Then give `request` its early branch, preserving the existing 401 and error semantics exactly:

```ts
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (nativeDispatch) {
    const res = await nativeDispatch(method, path, body);
    if (res.status === 401) emitSessionLost();
    if (res.status >= 400) {
      const data = res.body as { message?: string } | null;
      const message = data && typeof data.message === 'string' && data.message ? data.message : `Request failed (${res.status})`;
      throw new ApiError(res.status, message);
    }
    return res.body as T;
  }
  // ...existing fetch path unchanged...
}
```

- [ ] **Step 4: Add the branch to `client/src/api/testrail.ts`**

```ts
import { getNativeDispatch } from './client';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const dispatch = getNativeDispatch();
  if (dispatch) {
    const res = await dispatch(method, path, body);
    if (res.status >= 400) {
      const err = (res.body ?? {}) as { error?: string; statusCode?: number | null; body?: string | null };
      throw new TrApiError(
        res.status,
        typeof err.error === 'string' && err.error ? err.error : `Request failed (${res.status})`,
        err.statusCode ?? null,
        err.body ?? null,
      );
    }
    return res.body as T;
  }
  // ...existing fetch path unchanged...
}
```

- [ ] **Step 5: Run the client tests**

Run: `npm test --workspace client -- apiNative`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client
git commit -m "feat(client): route API calls through an in-process dispatcher when native"
```

---

## Task 7: Capacitor scaffold and a bundle that loads

First APK. Nothing app-specific yet — the goal is proving the toolchain, the WebView, and native HTTP.

**Files:**
- Create: `capacitor.config.ts` (repo root), `android/` (generated)
- Create: `client/src/native/platform.ts`
- Modify: `client/package.json`, root `package.json`, `client/vite.config.ts`, `.gitignore`
- Test: `client/test/platform.test.ts`

**Interfaces:**
- Produces: `isNativeApp(): boolean` from `client/src/native/platform.ts`, true only when Capacitor reports a native platform.

- [ ] **Step 1: Write the failing test**

Create `client/test/platform.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp } from '../src/native/platform';

declare global {
  // eslint-disable-next-line no-var
  var Capacitor: { getPlatform?: () => string } | undefined;
}

afterEach(() => { globalThis.Capacitor = undefined; });

describe('isNativeApp', () => {
  it('is false in a plain browser', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is false when Capacitor reports the web platform', () => {
    globalThis.Capacitor = { getPlatform: () => 'web' };
    expect(isNativeApp()).toBe(false);
  });

  it('is true on android', () => {
    globalThis.Capacitor = { getPlatform: () => 'android' };
    expect(isNativeApp()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- platform`
Expected: FAIL with "Cannot find module '../src/native/platform'".

- [ ] **Step 3: Implement the platform probe**

`client/src/native/platform.ts`:

```ts
// Single source of truth for "are we inside the Android shell". Reads the
// global Capacitor injects rather than importing @capacitor/core, so the
// desktop bundle never pulls the native runtime in.

interface CapacitorGlobal {
  getPlatform?: () => string;
}

export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  const platform = cap?.getPlatform?.();
  return platform === 'android' || platform === 'ios';
}
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace client -- platform`
Expected: PASS.

- [ ] **Step 5: Install Capacitor and scaffold the Android project**

```bash
npm install --workspace client @capacitor/core @capacitor/app @capacitor/preferences @capacitor/filesystem
npm install --workspace client -D @capacitor/cli @capacitor/android
npx --workspace client cap init MissionControl com.hp.missioncontrol --web-dir dist
npx --workspace client cap add android
```

- [ ] **Step 6: Configure Capacitor**

`capacitor.config.ts` at the repo root:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hp.missioncontrol',
  appName: 'MissionControl',
  webDir: 'client/dist',
  android: { allowMixedContent: false },
  plugins: {
    // Route window.fetch through native OkHttp. Load-bearing: Jira and
    // TestRail send no CORS headers, so a WebView-origin fetch would fail.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
```

Add to the root `package.json` scripts:

```json
"android:sync": "npm run build --workspace core && npm run build --workspace client && npx cap sync android",
"android:run": "npm run android:sync && npx cap run android"
```

Add `android/` build outputs to `.gitignore`:

```
android/.gradle/
android/app/build/
android/build/
android/local.properties
android/app/src/main/assets/public/
```

- [ ] **Step 7: Grant internet access in the manifest**

Confirm `android/app/src/main/AndroidManifest.xml` contains, as a direct child of `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

Capacitor's template includes it. If absent, add it.

- [ ] **Step 8: Build and install the APK**

Run: `npm run android:run`
Expected: The app installs on the connected device or emulator and shows the existing login screen. It will not connect yet — no credentials store on Android. Reaching a rendered screen is the pass condition.

If Gradle fails, confirm JDK 17 (`java -version`) and that `android/local.properties` points at a valid `sdk.dir`.

- [ ] **Step 9: Commit**

```bash
git add capacitor.config.ts android client package.json package-lock.json .gitignore
git commit -m "build: Capacitor Android shell scaffold"
```

---

## Task 8: Android storage backends

Gives the KV port a persistent home on the device without a database.

**Files:**
- Create: `client/src/native/persistence.ts`, `client/src/native/kvStore.ts`
- Test: `client/test/nativeKv.test.ts`

**Interfaces:**
- Consumes: `MemoryKvStore`, `KvTable`, `KV_TABLES`, `KvRecord`, `PeopleStore`, `TestRailPerson` from `@mc/core`.
- Produces:
  ```ts
  export interface KvPersistence {
    read(table: KvTable): Promise<Array<[string, KvRecord]> | null>;
    write(table: KvTable, entries: Array<[string, KvRecord]>): Promise<void>;
  }
  export const PreferencesPersistence: KvPersistence;   // appSettings, metadataCache
  export const FilesystemPersistence: KvPersistence;    // issueCache, trCache
  export function persistenceFor(table: KvTable): KvPersistence;
  export class HydratedKvStore extends MemoryKvStore {
    constructor(persistence: (table: KvTable) => KvPersistence, flushMs?: number);
    hydrate(): Promise<void>;
    flush(): Promise<void>;
  }
  export class PreferencesPeopleStore implements PeopleStore {
    hydrate(): Promise<void>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `client/test/nativeKv.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { KvRecord, KvTable } from '@mc/core';
import { HydratedKvStore, type KvPersistence } from '../src/native/kvStore';

function fakePersistence() {
  const store = new Map<KvTable, Array<[string, KvRecord]>>();
  const impl: KvPersistence = {
    read: async (t) => store.get(t) ?? null,
    write: async (t, e) => { store.set(t, e); },
  };
  return { store, impl, factory: () => impl };
}

describe('HydratedKvStore', () => {
  it('serves reads from memory after hydrate', async () => {
    const p = fakePersistence();
    p.store.set('appSettings', [['1', { json: '{"theme":"light"}', updatedAt: 5 }]]);
    const kv = new HydratedKvStore(p.factory, 0);
    await kv.hydrate();
    expect(kv.get('appSettings', '1')).toEqual({ json: '{"theme":"light"}', updatedAt: 5 });
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

  it('coalesces rapid writes into one flush per table', async () => {
    const p = fakePersistence();
    const spy = vi.spyOn(p.impl, 'write');
    const kv = new HydratedKvStore(() => p.impl, 0);
    kv.set('trCache', 'a', '1', 1);
    kv.set('trCache', 'b', '2', 2);
    await kv.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('survives a persistence read failure by starting empty', async () => {
    const kv = new HydratedKvStore(() => ({ read: async () => { throw new Error('io'); }, write: async () => {} }), 0);
    await expect(kv.hydrate()).resolves.toBeUndefined();
    expect(kv.get('appSettings', '1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- nativeKv`
Expected: FAIL with "Cannot find module '../src/native/kvStore'".

- [ ] **Step 3: Implement `client/src/native/kvStore.ts`**

```ts
// Write-through KV store for the Android shell. Capacitor storage is async but
// the repositories are synchronous, so everything is hydrated into memory at
// boot and written back on a debounced flush.

import { KV_TABLES, MemoryKvStore, type KvRecord, type KvTable, type PeopleStore, type TestRailPerson } from '@mc/core';

export interface KvPersistence {
  read(table: KvTable): Promise<Array<[string, KvRecord]> | null>;
  write(table: KvTable, entries: Array<[string, KvRecord]>): Promise<void>;
}

export class HydratedKvStore extends MemoryKvStore {
  private readonly dirty = new Set<KvTable>();
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
          await this.persistence(table).write(table, this.snapshot(table));
        } catch {
          // Losing a cache write is survivable; losing the app is not.
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

export class PreferencesPeopleStore implements PeopleStore {
  private people: TestRailPerson[] = [];

  constructor(private readonly key = 'mc.testrail.people') {}

  async hydrate(): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: this.key });
    if (!value) return;
    try {
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
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: this.key, value: JSON.stringify(this.people) });
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace client -- nativeKv`
Expected: PASS.

- [ ] **Step 5: Implement the two persistence backends**

`client/src/native/persistence.ts`:

```ts
// Two backends, chosen by size. Preferences maps to SharedPreferences, which
// is fine for small structured state and wrong for megabyte caches; those go
// to an app-private JSON file instead.

import type { KvRecord, KvTable } from '@mc/core';
import type { KvPersistence } from './kvStore';

const SMALL_TABLES: ReadonlySet<KvTable> = new Set<KvTable>(['appSettings', 'metadataCache']);

export const PreferencesPersistence: KvPersistence = {
  async read(table) {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: `mc.kv.${table}` });
    return value ? (JSON.parse(value) as Array<[string, KvRecord]>) : null;
  },
  async write(table, entries) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: `mc.kv.${table}`, value: JSON.stringify(entries) });
  },
};

export const FilesystemPersistence: KvPersistence = {
  async read(table) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    try {
      const { data } = await Filesystem.readFile({
        path: `kv-${table}.json`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return JSON.parse(String(data)) as Array<[string, KvRecord]>;
    } catch {
      return null; // absent on first run
    }
  },
  async write(table, entries) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: `kv-${table}.json`,
      directory: Directory.Data,
      data: JSON.stringify(entries),
      encoding: Encoding.UTF8,
    });
  },
};

export function persistenceFor(table: KvTable): KvPersistence {
  return SMALL_TABLES.has(table) ? PreferencesPersistence : FilesystemPersistence;
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client
git commit -m "feat(android): hydrated KV store over Preferences and Filesystem"
```

---

## Task 9: Keystore credentials and the biometric gate

**Files:**
- Create: `client/src/native/credentials.ts`, `client/src/native/biometric.ts`
- Modify: `client/package.json`, `android/app/src/main/AndroidManifest.xml`
- Test: `client/test/nativeCredentials.test.ts`

**Interfaces:**
- Consumes: `Credentials`, `CredentialsPort` from `@mc/core`.
- Produces:
  ```ts
  export class KeystoreCredentials implements CredentialsPort {
    hydrate(): Promise<void>;   // must be awaited after a successful unlock
    load(): Credentials | null;
    save(c: Credentials): void;
    clear(): void;
  }
  export function requireUnlock(reason: string): Promise<boolean>;
  export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
  ```

Split rationale: non-secret profile fields (`email`, `jiraBaseUrl`, `instanceType`, `defaultProjectKey`, `testRailBaseUrl`, `testRailEmail`) go to Preferences so the login screen can pre-fill without a biometric prompt. Only `jiraPat` and `testRailApiKey` go to the Keystore.

- [ ] **Step 1: Write the failing test**

Create `client/test/nativeCredentials.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { KeystoreCredentials, splitSecrets, mergeSecrets } from '../src/native/credentials';
import type { Credentials } from '@mc/core';

const full: Credentials = {
  email: 'a@hp.com',
  jiraBaseUrl: 'https://hp-jira.external.hp.com/',
  jiraPat: 'JIRA-SECRET',
  instanceType: 'datacenter',
  defaultProjectKey: 'ISW',
  testRailBaseUrl: 'https://hp-testrail.external.hp.com',
  testRailEmail: 'a@hp.com',
  testRailApiKey: 'TR-SECRET',
  confluenceBaseUrl: '',
  confluencePat: '',
};

describe('credential splitting', () => {
  it('keeps PAT and API key out of the non-secret half', () => {
    const { profile } = splitSecrets(full);
    expect(JSON.stringify(profile)).not.toContain('JIRA-SECRET');
    expect(JSON.stringify(profile)).not.toContain('TR-SECRET');
    expect(profile.jiraBaseUrl).toBe(full.jiraBaseUrl);
  });

  it('round-trips through split and merge', () => {
    const { profile, secrets } = splitSecrets(full);
    expect(mergeSecrets(profile, secrets)).toEqual(full);
  });

  it('merges to empty secrets when the keystore half is missing', () => {
    const { profile } = splitSecrets(full);
    expect(mergeSecrets(profile, null).jiraPat).toBe('');
  });
});

describe('KeystoreCredentials', () => {
  it('returns null before hydrate', () => {
    expect(new KeystoreCredentials().load()).toBeNull();
  });

  it('serves the merged credentials after a save', () => {
    const creds = new KeystoreCredentials();
    creds.save(full);
    expect(creds.load()).toEqual(full);
  });

  it('drops everything on clear', () => {
    const creds = new KeystoreCredentials();
    creds.save(full);
    creds.clear();
    expect(creds.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- nativeCredentials`
Expected: FAIL with "Cannot find module '../src/native/credentials'".

- [ ] **Step 3: Install the native plugins**

```bash
npm install --workspace client capacitor-secure-storage-plugin @aparajita/capacitor-biometric-auth
```

- [ ] **Step 4: Implement `client/src/native/credentials.ts`**

```ts
// Credential store for the Android shell. Only jiraPat and testRailApiKey are
// secret; the rest is profile data the login screen pre-fills without asking
// for a fingerprint. Secrets live in the Android Keystore and are held in
// memory only after a successful biometric unlock.

import type { Credentials, CredentialsPort } from '@mc/core';

export interface CredentialProfile extends Omit<Credentials, 'jiraPat' | 'testRailApiKey'> {}

export interface CredentialSecrets {
  jiraPat: string;
  testRailApiKey: string;
}

const PROFILE_KEY = 'mc.credentials.profile';
const SECRET_KEY = 'mc.credentials.secrets';

export function splitSecrets(c: Credentials): { profile: CredentialProfile; secrets: CredentialSecrets } {
  const { jiraPat, testRailApiKey, ...profile } = c;
  return { profile, secrets: { jiraPat, testRailApiKey } };
}

export function mergeSecrets(profile: CredentialProfile, secrets: CredentialSecrets | null): Credentials {
  return { ...profile, jiraPat: secrets?.jiraPat ?? '', testRailApiKey: secrets?.testRailApiKey ?? '' };
}

export class KeystoreCredentials implements CredentialsPort {
  private cached: Credentials | null = null;

  /** Read both halves into memory. Call only after a successful unlock. */
  async hydrate(): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    const { value: profileJson } = await Preferences.get({ key: PROFILE_KEY });
    if (!profileJson) return;
    let profile: CredentialProfile;
    try {
      profile = JSON.parse(profileJson) as CredentialProfile;
    } catch {
      return;
    }
    let secrets: CredentialSecrets | null = null;
    try {
      const { value } = await SecureStoragePlugin.get({ key: SECRET_KEY });
      secrets = JSON.parse(value) as CredentialSecrets;
    } catch {
      secrets = null; // no secrets stored yet
    }
    this.cached = mergeSecrets(profile, secrets);
  }

  load(): Credentials | null {
    return this.cached;
  }

  save(credentials: Credentials): void {
    this.cached = credentials;
    void this.persist(credentials);
  }

  clear(): void {
    this.cached = null;
    void this.wipe();
  }

  private async persist(credentials: Credentials): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    const { profile, secrets } = splitSecrets(credentials);
    await Preferences.set({ key: PROFILE_KEY, value: JSON.stringify(profile) });
    await SecureStoragePlugin.set({ key: SECRET_KEY, value: JSON.stringify(secrets) });
  }

  private async wipe(): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    await Preferences.remove({ key: PROFILE_KEY });
    try {
      await SecureStoragePlugin.remove({ key: SECRET_KEY });
    } catch {
      // already absent
    }
  }
}
```

- [ ] **Step 5: Implement `client/src/native/biometric.ts`**

```ts
// Biometric gate. Fails closed: if the check throws, the app stays locked.

export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export async function requireUnlock(reason: string): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const info = await BiometricAuth.checkBiometry();
    if (!info.isAvailable) return true; // no enrolled biometry: device PIN already guards the app
    await BiometricAuth.authenticate({
      reason,
      androidTitle: 'MissionControl',
      allowDeviceCredential: true,
    });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the client tests**

Run: `npm test --workspace client -- nativeCredentials`
Expected: PASS. The plugin imports are dynamic, so the pure split/merge and in-memory paths run without a device.

- [ ] **Step 7: Declare the biometric permission**

In `android/app/src/main/AndroidManifest.xml`, alongside the internet permission:

```xml
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
```

- [ ] **Step 8: Commit**

```bash
git add client android package-lock.json
git commit -m "feat(android): Keystore credential store behind a biometric gate"
```

---

## Task 10: Native bootstrap

Wires Tasks 4–9 together: on Android, build the core, install the dispatcher, unlock, hydrate, and hand off to the existing React app.

**Files:**
- Create: `client/src/native/bootstrap.ts`
- Modify: `client/src/main.tsx`
- Test: `client/test/nativeBootstrap.test.ts`

**Interfaces:**
- Consumes: `createCore`, `createDispatcher` from `@mc/core`; `HydratedKvStore`, `persistenceFor`, `PreferencesPeopleStore`, `KeystoreCredentials`, `requireUnlock`, `LOCK_TIMEOUT_MS`, `isNativeApp`.
- Produces: `bootstrapNative(): Promise<{ unlocked: boolean }>` and `installLockOnResume(): void`.

- [ ] **Step 1: Write the failing test**

Create `client/test/nativeBootstrap.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildNativeRuntime } from '../src/native/bootstrap';

describe('buildNativeRuntime', () => {
  it('hydrates storage before creating the dispatcher', async () => {
    const order: string[] = [];
    const kv = { hydrate: vi.fn(async () => { order.push('kv'); }) };
    const people = { hydrate: vi.fn(async () => { order.push('people'); }), all: () => [], upsertMany: () => {}, clear: () => {} };
    const credentials = { hydrate: vi.fn(async () => { order.push('creds'); }), load: () => null, save: () => {}, clear: () => {} };
    const install = vi.fn(() => { order.push('dispatch'); });

    await buildNativeRuntime({ kv: kv as never, people: people as never, credentials: credentials as never, installDispatch: install });

    expect(order).toEqual(['kv', 'people', 'creds', 'dispatch']);
  });

  it('activates the session when stored credentials carry a PAT', async () => {
    const credentials = {
      hydrate: async () => {},
      load: () => ({ jiraPat: 'x', jiraBaseUrl: 'https://j/', email: 'a@b', instanceType: 'datacenter' }),
      save: () => {}, clear: () => {},
    };
    const runtime = await buildNativeRuntime({
      kv: { hydrate: async () => {} } as never,
      people: { hydrate: async () => {}, all: () => [], upsertMany: () => {}, clear: () => {} } as never,
      credentials: credentials as never,
      installDispatch: () => {},
    });
    expect(runtime.core.session.isConnected).toBe(true);
  });

  it('leaves the session disconnected when nothing is stored', async () => {
    const runtime = await buildNativeRuntime({
      kv: { hydrate: async () => {} } as never,
      people: { hydrate: async () => {}, all: () => [], upsertMany: () => {}, clear: () => {} } as never,
      credentials: { hydrate: async () => {}, load: () => null, save: () => {}, clear: () => {} } as never,
      installDispatch: () => {},
    });
    expect(runtime.core.session.isConnected).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- nativeBootstrap`
Expected: FAIL with "Cannot find module '../src/native/bootstrap'".

- [ ] **Step 3: Implement `client/src/native/bootstrap.ts`**

```ts
// Android bootstrap. Order matters: storage must be hydrated before the core
// reads settings, and the dispatcher must be installed before React mounts, or
// the first view's API call goes to fetch and fails.

import { createCore, createDispatcher, type Core, type CredentialsPort, type KvStore, type PeopleStore } from '@mc/core';
import { setNativeDispatch } from '../api/client';
import { HydratedKvStore } from './kvStore';
import { persistenceFor } from './persistence';
import { PreferencesPeopleStore } from './kvStore';
import { KeystoreCredentials } from './credentials';
import { LOCK_TIMEOUT_MS, requireUnlock } from './biometric';

interface RuntimeDeps {
  kv: KvStore & { hydrate(): Promise<void> };
  people: PeopleStore & { hydrate(): Promise<void> };
  credentials: CredentialsPort & { hydrate(): Promise<void> };
  installDispatch: (dispatch: ReturnType<typeof createDispatcher>) => void;
}

export interface NativeRuntime {
  core: Core;
}

/** Testable seam: no plugin imports, no globals. */
export async function buildNativeRuntime(deps: RuntimeDeps): Promise<NativeRuntime> {
  await deps.kv.hydrate();
  await deps.people.hydrate();
  await deps.credentials.hydrate();

  const core = createCore({ kv: deps.kv, people: deps.people, credentials: deps.credentials });
  deps.installDispatch(createDispatcher(core));

  const saved = deps.credentials.load();
  if (saved && saved.jiraPat.trim().length > 0) core.session.activate(saved, null);

  return { core };
}

let runtime: NativeRuntime | null = null;

export async function bootstrapNative(): Promise<{ unlocked: boolean }> {
  const unlocked = await requireUnlock('Unlock MissionControl');
  if (!unlocked) return { unlocked: false };

  runtime = await buildNativeRuntime({
    kv: new HydratedKvStore(persistenceFor),
    people: new PreferencesPeopleStore(),
    credentials: new KeystoreCredentials(),
    installDispatch: (dispatch) => setNativeDispatch(dispatch),
  });
  return { unlocked: true };
}

export function nativeRuntime(): NativeRuntime | null {
  return runtime;
}

/** Re-lock after LOCK_TIMEOUT_MS in the background; reload to force the gate. */
export function installLockOnResume(): void {
  let backgroundedAt: number | null = null;
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundedAt = Date.now();
        return;
      }
      if (backgroundedAt !== null && Date.now() - backgroundedAt > LOCK_TIMEOUT_MS) {
        window.location.reload();
      }
      backgroundedAt = null;
    });
  });
}
```

- [ ] **Step 4: Run the client tests**

Run: `npm test --workspace client -- nativeBootstrap`
Expected: PASS.

- [ ] **Step 5: Branch `client/src/main.tsx`**

Before the existing `createRoot(...).render(...)` call, gate on the platform:

```tsx
import { isNativeApp } from './native/platform';

async function start(): Promise<void> {
  if (isNativeApp()) {
    const { bootstrapNative, installLockOnResume } = await import('./native/bootstrap');
    const { unlocked } = await bootstrapNative();
    if (!unlocked) {
      document.body.textContent = 'Locked. Reopen MissionControl to unlock.';
      return;
    }
    installLockOnResume();
  }
  // ...existing createRoot render call, unchanged...
}

void start();
```

- [ ] **Step 6: Run the full suite and the app on device**

Run: `npm test && npm run android:run`
Expected: Tests pass. On the device: biometric prompt, then the login screen. Enter the Jira and TestRail credentials from `%APPDATA%\JiraWeb\config.json`, connect, and confirm the Backlog loads real issues **with VPN off**.

- [ ] **Step 7: Commit**

```bash
git add client
git commit -m "feat(android): native bootstrap with biometric unlock and in-process dispatch"
```

---

## Task 11: `ResponsiveGrid` and `CardList`

**Files:**
- Create: `client/src/components/CardList.tsx`, `client/src/components/ResponsiveGrid.tsx`, `client/src/lib/useViewport.ts`
- Modify: `client/src/views/MyWorkView.tsx`, `client/src/views/testrail/RunsView.tsx`, `client/src/views/testrail/RunDetailView.tsx`
- Test: `client/test/responsiveGrid.test.tsx`

**Interfaces:**
- Consumes: `GridColumn<T>`, `DataGridProps<T>` from `client/src/components/DataGrid`.
- Produces:
  ```ts
  export const MOBILE_BREAKPOINT = 900;
  export function useIsNarrow(breakpoint?: number): boolean;
  export interface CardListProps<T> {
    columns: GridColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    onRowClick?: (row: T) => void;
    onRowLongPress?: (row: T, at: { clientX: number; clientY: number }) => void;
    /** Columns after this index collapse behind "more". Default 4. */
    visibleFields?: number;
  }
  export function CardList<T>(props: CardListProps<T>): JSX.Element;
  export function ResponsiveGrid<T>(props: DataGridProps<T> & { visibleFields?: number }): JSX.Element;
  ```

`ResponsiveGrid` maps `DataGrid`'s `onRowDoubleClick` to `CardList`'s `onRowClick` and `onRowContextMenu` to `onRowLongPress`, so callers pass exactly what they pass `DataGrid` today.

- [ ] **Step 1: Write the failing test**

Create `client/test/responsiveGrid.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CardList } from '../src/components/CardList';
import type { GridColumn } from '../src/components/DataGrid';

interface Row { key: string; summary: string; status: string; assignee: string; priority: string; extra: string }

const columns: GridColumn<Row>[] = [
  { key: 'key', header: 'Key', width: 100 },
  { key: 'summary', header: 'Summary', width: 300 },
  { key: 'status', header: 'Status', width: 100, render: (r) => <b>{r.status}</b> },
  { key: 'assignee', header: 'Assignee', width: 120 },
  { key: 'priority', header: 'Priority', width: 80 },
  { key: 'extra', header: 'Extra', width: 80 },
];

const rows: Row[] = [
  { key: 'A-1', summary: 'First', status: 'Open', assignee: 'Dana', priority: 'High', extra: 'x' },
  { key: 'A-2', summary: 'Second', status: 'Done', assignee: 'Ravi', priority: 'Low', extra: 'y' },
];

describe('CardList', () => {
  it('renders one card per row with the first column as the title', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('A-1');
    expect(html).toContain('A-2');
    expect(html).toContain('First');
  });

  it('uses the column render function when present', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('<b>Open</b>');
  });

  it('shows headers for the visible fields and hides the overflow behind a summary', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} visibleFields={4} />);
    expect(html).toContain('Assignee');
    expect(html).toContain('2 more');
  });

  it('prefers format over the raw property', () => {
    const cols: GridColumn<Row>[] = [
      { key: 'key', header: 'Key', width: 100 },
      { key: 'priority', header: 'Priority', width: 80, format: (r) => `P:${r.priority}` },
    ];
    const html = renderToString(<CardList columns={cols} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('P:High');
  });

  it('renders an empty-state message with no rows', () => {
    const html = renderToString(<CardList columns={columns} rows={[]} rowKey={(r) => r.key} />);
    expect(html).toContain('No rows');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- responsiveGrid`
Expected: FAIL with "Cannot find module '../src/components/CardList'".

- [ ] **Step 3: Implement `client/src/lib/useViewport.ts`**

```ts
// Viewport width hook. SSR-safe: react-dom/server has no window, and the
// component tests render through renderToString.

import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 900;

export function useIsNarrow(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);

  return narrow;
}
```

- [ ] **Step 4: Implement `client/src/components/CardList.tsx`**

Render each row as a card. Resolve a cell exactly the way `DataGrid` does — `render` first, then `format`, then the raw property — so the two presentations never disagree. Long-press is a 500ms timer on `onTouchStart`, cancelled by `onTouchEnd` or `onTouchMove`, reporting the touch coordinates so the existing `ContextMenu` can position itself.

```tsx
// Card presentation of a DataGrid column set. Same columns, same cell
// resolution order, phone-shaped layout.

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GridColumn } from './DataGrid';

export interface CardListProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onRowLongPress?: (row: T, at: { clientX: number; clientY: number }) => void;
  /** Columns after this index collapse behind "N more". Default 4. */
  visibleFields?: number;
}

function cell<T>(col: GridColumn<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  if (col.format) return col.format(row);
  const raw = (row as Record<string, unknown>)[col.key];
  return raw === null || raw === undefined ? '' : String(raw);
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border-soft)',
  borderRadius: 10,
  background: 'var(--bg-panel)',
  padding: '12px 14px',
  marginBottom: 8,
};

export function CardList<T>({
  columns, rows, rowKey, onRowClick, onRowLongPress, visibleFields = 4,
}: CardListProps<T>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (rows.length === 0) {
    return <div style={{ padding: 24, opacity: 0.7, textAlign: 'center' }}>No rows</div>;
  }

  const [titleCol, ...fieldCols] = columns;
  const primary = fieldCols.slice(0, Math.max(0, visibleFields - 1));
  const overflow = fieldCols.slice(Math.max(0, visibleFields - 1));

  return (
    <div style={{ padding: 8 }}>
      {rows.map((row) => {
        const id = rowKey(row);
        const isOpen = expanded.has(id);
        const shown = isOpen ? [...primary, ...overflow] : primary;
        return (
          <div
            key={id}
            style={cardStyle}
            onClick={() => onRowClick?.(row)}
            onTouchStart={(e) => {
              const t = e.touches[0];
              const at = { clientX: t.clientX, clientY: t.clientY };
              timer.current = setTimeout(() => onRowLongPress?.(row, at), 500);
            }}
            onTouchEnd={() => { if (timer.current) clearTimeout(timer.current); }}
            onTouchMove={() => { if (timer.current) clearTimeout(timer.current); }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{cell(titleCol, row)}</div>
            {shown.map((col) => (
              <div key={col.key} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '2px 0' }}>
                <span style={{ opacity: 0.65, minWidth: 96 }}>{col.header}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{cell(col, row)}</span>
              </div>
            ))}
            {overflow.length > 0 && (
              <button
                type="button"
                style={{ marginTop: 6, fontSize: 12, background: 'none', border: 'none', color: 'var(--accent)', padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  });
                }}
              >
                {isOpen ? 'Show less' : `${overflow.length} more`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Implement `client/src/components/ResponsiveGrid.tsx`**

```tsx
// Breakpoint switch. Above the breakpoint the desktop DataGrid renders exactly
// as before; below it, the same columns render as cards.

import { CardList } from './CardList';
import { DataGrid, type DataGridProps } from './DataGrid';
import { useIsNarrow } from '../lib/useViewport';

export function ResponsiveGrid<T>({ visibleFields, ...props }: DataGridProps<T> & { visibleFields?: number }) {
  if (!useIsNarrow()) return <DataGrid {...props} />;
  return (
    <CardList
      columns={props.columns}
      rows={props.rows}
      rowKey={props.rowKey}
      visibleFields={visibleFields}
      onRowClick={props.onRowDoubleClick}
      onRowLongPress={props.onRowContextMenu}
    />
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test --workspace client -- responsiveGrid`
Expected: PASS.

- [ ] **Step 7: Swap the three Phase 1 views**

In `MyWorkView.tsx`, `RunsView.tsx`, and `RunDetailView.tsx`, change the import from `DataGrid` to `ResponsiveGrid` and rename the JSX element. `GridColumn` keeps coming from `../components/DataGrid`. Do not touch the column definitions.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — `client/test/viewsSmoke.test.tsx` and `client/test/testrailViews.test.tsx` render these views through `renderToString`, where `useIsNarrow` returns `false` and the desktop grid renders as before.

- [ ] **Step 9: Commit**

```bash
git add client
git commit -m "feat(client): responsive card presentation for the Phase 1 grids"
```

---

## Task 12: Mobile chrome

**Files:**
- Modify: `client/src/components/Modal.tsx`, `client/src/components/Shell.tsx`
- Create: `client/src/components/BottomTabs.tsx`
- Test: `client/test/mobileChrome.test.tsx`

**Interfaces:**
- Consumes: `useIsNarrow` from Task 11; `navigate`, `routeStore`, `type RouteId` from `client/src/router`.
- Produces:
  ```ts
  export const MOBILE_TABS: ReadonlyArray<{ id: RouteId; label: string }>;
  export function BottomTabs(props: { active: RouteId }): JSX.Element;
  ```
  `MOBILE_TABS` is `[{ id: 'mywork', label: 'Backlog' }, { id: 'testrail-runs', label: 'Runs' }, { id: 'settings', label: 'Settings' }]`.

- [ ] **Step 1: Write the failing test**

Create `client/test/mobileChrome.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BottomTabs, MOBILE_TABS } from '../src/components/BottomTabs';

describe('BottomTabs', () => {
  it('renders exactly the Phase 1 tabs', () => {
    expect(MOBILE_TABS.map((t) => t.id)).toEqual(['mywork', 'testrail-runs', 'settings']);
  });

  it('renders a labelled button per tab', () => {
    const html = renderToString(<BottomTabs active="mywork" />);
    expect(html).toContain('Backlog');
    expect(html).toContain('Runs');
    expect(html).toContain('Settings');
  });

  it('marks the active tab with aria-current', () => {
    const html = renderToString(<BottomTabs active="testrail-runs" />);
    expect(html).toMatch(/aria-current="page"[^>]*>|>Runs</);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- mobileChrome`
Expected: FAIL with "Cannot find module '../src/components/BottomTabs'".

- [ ] **Step 3: Implement `client/src/components/BottomTabs.tsx`**

```tsx
// Phone navigation. Replaces the 220px sidebar below the breakpoint; only the
// Phase 1 routes appear, because nothing else is ported yet.

import type { CSSProperties } from 'react';
import { navigate, type RouteId } from '../router';

export const MOBILE_TABS: ReadonlyArray<{ id: RouteId; label: string }> = [
  { id: 'mywork', label: 'Backlog' },
  { id: 'testrail-runs', label: 'Runs' },
  { id: 'settings', label: 'Settings' },
];

const barStyle: CSSProperties = {
  display: 'flex',
  borderTop: '1px solid var(--border-soft)',
  background: 'var(--bg-panel)',
  paddingBottom: 'env(safe-area-inset-bottom)',
  flexShrink: 0,
};

export function BottomTabs({ active }: { active: RouteId }) {
  return (
    <nav style={barStyle}>
      {MOBILE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={tab.id === active ? 'page' : undefined}
          onClick={() => navigate(tab.id)}
          style={{
            flex: 1,
            padding: '12px 4px',
            background: 'none',
            border: 'none',
            fontSize: 13,
            color: tab.id === active ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace client -- mobileChrome`
Expected: PASS.

- [ ] **Step 5: Make `Modal` a full-screen sheet below the breakpoint**

In `Modal.tsx`, call `useIsNarrow()` and override the panel geometry. Change only the style object — the Esc handling, focus trap, and backdrop behaviour stay untouched:

```tsx
const narrow = useIsNarrow();
const panelStyle: CSSProperties = narrow
  ? { width: '100vw', height: '100dvh', maxHeight: '100dvh', borderRadius: 0, display: 'flex', flexDirection: 'column' }
  : { width, maxHeight };
```

Apply `panelStyle` to the existing panel `div` in place of its current inline `width` / `maxHeight`.

- [ ] **Step 6: Swap the sidebar for tabs in `Shell.tsx`**

Call `useIsNarrow()`. When narrow: skip the sidebar `<aside>`, render `<BottomTabs active={route} />` after the content host, and hide the top bar's desktop-only affordances (pinned boards, Pomodoro, clock). The top bar keeps the title, the refresh button, and the notification bell.

- [ ] **Step 7: Wire the Android back button**

In `client/src/native/bootstrap.ts`, extend `installLockOnResume` with a back handler, so back closes a dialog or pops the route instead of exiting the app:

```ts
void import('@capacitor/app').then(({ App }) => {
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
});
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. Existing dialog tests in `client/test/dialogs.test.tsx` render through `renderToString`, where `useIsNarrow()` is `false` and the desktop geometry is unchanged.

- [ ] **Step 9: Commit**

```bash
git add client
git commit -m "feat(client): mobile chrome — sheet dialogs, bottom tabs, back button"
```

---

## Task 13: Trim the Android bundle

Keeps Lumo, Confluence, and the unported views out of the APK, so the app is smaller and an unported screen cannot be reached.

**Files:**
- Modify: `client/vite.config.ts`, `client/src/App.tsx`, `client/src/router.ts`
- Test: `client/test/mobileRoutes.test.ts`

**Interfaces:**
- Produces: `MOBILE_ROUTE_IDS: ReadonlySet<RouteId>` exported from `client/src/router.ts`, and `isRouteAvailable(id: RouteId, native: boolean): boolean`.

- [ ] **Step 1: Write the failing test**

Create `client/test/mobileRoutes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MOBILE_ROUTE_IDS, isRouteAvailable } from '../src/router';

describe('mobile route gating', () => {
  it('allows exactly the Phase 1 routes natively', () => {
    expect([...MOBILE_ROUTE_IDS].sort()).toEqual(['mywork', 'settings', 'testrail-run', 'testrail-runs']);
  });

  it('blocks an unported route natively', () => {
    expect(isRouteAvailable('traceability', true)).toBe(false);
    expect(isRouteAvailable('confluence', true)).toBe(false);
  });

  it('allows every route on desktop', () => {
    expect(isRouteAvailable('traceability', false)).toBe(true);
    expect(isRouteAvailable('confluence', false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace client -- mobileRoutes`
Expected: FAIL — `MOBILE_ROUTE_IDS` is not exported.

- [ ] **Step 3: Add the gate to `client/src/router.ts`**

```ts
/** Routes ported to the Android shell in Phase 1. */
export const MOBILE_ROUTE_IDS: ReadonlySet<RouteId> = new Set<RouteId>([
  'mywork', 'testrail-runs', 'testrail-run', 'settings',
]);

export function isRouteAvailable(id: RouteId, native: boolean): boolean {
  return native ? MOBILE_ROUTE_IDS.has(id) : true;
}
```

In `App.tsx`, redirect to `mywork` when `isNativeApp()` and the current route is unavailable, and skip rendering the Lumo panel and Confluence nav entirely when native.

- [ ] **Step 4: Exclude Lumo and Confluence from the native bundle**

In `client/vite.config.ts`, add a build-time flag:

```ts
define: {
  __MC_TARGET__: JSON.stringify(process.env.MC_TARGET ?? 'desktop'),
},
```

Declare it in `client/src/vite-env.d.ts` (create the file if absent):

```ts
declare const __MC_TARGET__: 'desktop' | 'android';
```

Guard the lazy imports of `LumoPanel`, `ConfluenceView`, and the other unported views with `__MC_TARGET__ === 'desktop'`, so Rollup drops those chunks from the Android build. Set `MC_TARGET=android` in the `android:sync` script:

```json
"android:sync": "npm run build --workspace core && cross-env MC_TARGET=android npm run build --workspace client && npx cap sync android"
```

Install `cross-env` as a root dev dependency: `npm install -D cross-env`.

- [ ] **Step 5: Run the tests and both builds**

Run: `npm test && npm run build --workspace client && npm run android:sync`
Expected: PASS. Compare bundle sizes; the Android build must be smaller than the desktop build. If it is not, a guard is not taking effect — a lazy import guarded by a runtime `if` still emits the chunk unless the condition is the compile-time constant.

- [ ] **Step 6: Commit**

```bash
git add client package.json package-lock.json
git commit -m "build(android): gate unported routes and drop Lumo/Confluence chunks"
```

---

## Task 14: Device verification

The final gate. No new code — this is the evidence that Phase 1 works.

**Files:**
- Create: `docs/reference/android-verification.md`

- [ ] **Step 1: Build a release-signed APK**

```bash
keytool -genkey -v -keystore android/mc-release.keystore -alias missioncontrol -keyalg RSA -keysize 2048 -validity 10000
```

Add `android/mc-release.keystore` and `android/keystore.properties` to `.gitignore` — a signing key must never enter the repository. Configure the release signing block in `android/app/build.gradle` reading from `keystore.properties`, then:

```bash
npm run android:sync && (cd android && ./gradlew assembleRelease)
```

Expected: `android/app/build/outputs/apk/release/app-release.apk` exists.

- [ ] **Step 2: Run the verification checklist on a physical device, VPN off, on cellular**

Record the result of each line in `docs/reference/android-verification.md`:

1. Install the APK. App launches and shows the biometric prompt.
2. Cancel the prompt. App shows the locked message and no data.
3. Reopen, authenticate. Login screen appears.
4. Enter Jira base URL, email, PAT; connect. Success toast with the resolved user name.
5. Enter TestRail base URL, email, API key; connect. Success toast.
6. Backlog loads real issues. Confirm at least one issue key matches Jira in a browser.
7. Tap an issue. Detail dialog opens full-screen; comments and worklogs render.
8. Add a comment. Confirm it appears in Jira from a browser.
9. Log work via the Log Work dialog. Confirm the worklog in Jira.
10. Perform a transition. Confirm the new status in Jira.
11. Long-press an issue card. The context menu opens at the touch point.
12. Runs tab lists TestRail runs. Open one; tests and results render.
13. Force-stop the app. Reopen. Biometric prompt appears, then Backlog loads **without re-entering credentials**.
14. Background the app for six minutes, return. Biometric prompt appears again.
15. Airplane mode: Backlog shows a network error, not a blank screen or a crash.
16. Rotate to landscape on a tablet or large phone: the desktop grid appears above 900px.
17. Android back button inside a dialog closes the dialog, not the app.
18. Settings → Disconnect, then force-stop and reopen: the login screen appears with no stored PAT.

- [ ] **Step 3: Commit the results**

```bash
git add docs/reference/android-verification.md
git commit -m "docs: Android Phase 1 device verification results"
```

---

## Phase 2 backlog (not in this plan)

Dashboard, Incidents, Boards, Time Spent, Team, Traceability, Case Library, Case Editor, TestRail Reports — each needs its dispatcher routes added to `core/src/dispatch.ts`, its route id added to `MOBILE_ROUTE_IDS`, and a `DataGrid` → `ResponsiveGrid` swap. Saved filters, teams, pinned boards, and board workspaces need their repositories moved onto the `KvStore` port the way Task 2 moved the first three. Android local notifications may replace the Windows Task Scheduler reminders.
