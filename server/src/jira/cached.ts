import type { MetadataCacheRepo } from '../storage/repositories.js';
import { toCamelKeys, toPascalKeys } from '../storage/repositories.js';
import type {
  BoardLoadResult,
  JiraBoard,
  JiraIssue,
  JiraQuickFilter,
  JiraSprint,
} from '../types.js';

/**
 * Cached decorators (jira-rest-layer.md §5).
 * Single-profile deployment → stable profile key constant "default".
 * Cache keys MUST keep these formats:
 *   boards   → `meta:default:boards`
 *   metadata → `meta:v10:default:{suffix}`
 */
const PROFILE_KEY = 'default';
export const BOARDS_CACHE_KEY = `meta:${PROFILE_KEY}:boards`;
export const METADATA_KEY_PREFIX = `meta:v10:${PROFILE_KEY}:`;

const DAY_MS = 24 * 60 * 60 * 1000;
export const BOARDS_TTL_MS = 30 * DAY_MS;
export const METADATA_TTL_MS = 14 * DAY_MS;

// ---------------------------------------------------------------------------
// CachedBoardService — decorates ONLY getBoards (§5)
// ---------------------------------------------------------------------------

export interface BoardServiceLike {
  getBoards(): Promise<BoardLoadResult>;
  getActiveSprints(boardId: number): Promise<JiraSprint[]>;
  getBoardIssues(boardId: number, jql?: string): Promise<JiraIssue[]>;
  getQuickFilters(rapidViewId: number): Promise<JiraQuickFilter[]>;
}

export class CachedBoardService implements BoardServiceLike {
  constructor(
    private readonly inner: BoardServiceLike,
    private readonly repo: MetadataCacheRepo,
    private readonly ttlMs: number = BOARDS_TTL_MS,
  ) {}

  /**
   * Stale-while-revalidate: an existing entry is returned immediately; when
   * older than the TTL a background refetch+store is queued. Cached returns
   * fabricate a BoardLoadResult whose greenhopperError is a human-readable
   * cache marker (not a real error — §10.10). Fresh results are stored only
   * when non-empty.
   */
  async getBoards(): Promise<BoardLoadResult> {
    const entry = this.repo.get(BOARDS_CACHE_KEY);
    if (entry) {
      const boards = parseBoards(entry.json);
      if (boards !== null) {
        const stale = Date.now() - entry.updatedUtc.getTime() > this.ttlMs;
        if (stale) void this.refresh();
        return {
          boards,
          fromGreenhopper: boards.length,
          fromAgile: 0,
          greenhopperError: stale ? 'served from cache (refresh queued)' : 'served from cache',
          agileError: null,
        };
      }
    }
    const result = await this.inner.getBoards();
    this.store(result.boards);
    return result;
  }

  private async refresh(): Promise<void> {
    try {
      const result = await this.inner.getBoards();
      this.store(result.boards);
    } catch {
      // background refresh failures are swallowed
    }
  }

  private store(boards: JiraBoard[]): void {
    if (boards.length === 0) return; // write only non-empty
    this.repo.set(BOARDS_CACHE_KEY, JSON.stringify(toPascalKeys(boards)));
  }

  getActiveSprints(boardId: number): Promise<JiraSprint[]> {
    return this.inner.getActiveSprints(boardId); // never cached
  }

  getBoardIssues(boardId: number, jql?: string): Promise<JiraIssue[]> {
    return this.inner.getBoardIssues(boardId, jql); // never cached
  }

  getQuickFilters(rapidViewId: number): Promise<JiraQuickFilter[]> {
    return this.inner.getQuickFilters(rapidViewId); // never cached
  }
}

/** SQLite JSON blobs keep PascalCase keys (storage-layer.md §8.1). */
function parseBoards(json: string): JiraBoard[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return toCamelKeys<JiraBoard[]>(parsed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CachedMetadataService (§5)
// ---------------------------------------------------------------------------

export interface MetadataServiceLike {
  getProjects(): Promise<string[]>;
  getIssueTypes(): Promise<string[]>;
  getStatuses(): Promise<string[]>;
  getStatusMap(): Promise<Record<string, string>>;
  getPriorities(): Promise<string[]>;
  getResolutions(): Promise<string[]>;
  getFields(): Promise<string[]>;
  getVersions(projectKey: string): Promise<string[]>;
  getComponents(projectKey: string): Promise<string[]>;
  getAssignableUsers(projectKey: string): Promise<string[]>;
  getFieldSuggestions(fieldName: string, query?: string | null): Promise<string[]>;
  resolveFieldId(displayName: string): Promise<string | null>;
  resolveJqlField(displayName: string): Promise<string>;
}

export class CachedMetadataService implements MetadataServiceLike {
  constructor(
    private readonly inner: MetadataServiceLike,
    private readonly repo: MetadataCacheRepo,
    private readonly ttlMs: number = METADATA_TTL_MS,
  ) {}

  private key(suffix: string): string {
    return `${METADATA_KEY_PREFIX}${suffix}`;
  }

  /**
   * Stale-while-revalidate string-list cache; writes only non-empty results.
   * Public so callers can cache extra suffixes from §5 (e.g.
   * `distinct:v2:{projectKey}:{fieldLower}` over issueService.getDistinctIssueField).
   */
  async cachedList(suffix: string, loader: () => Promise<string[]>): Promise<string[]> {
    const cacheKey = this.key(suffix);
    const entry = this.repo.get(cacheKey);
    if (entry) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(entry.json);
      } catch {
        // corrupted entry → treated as a miss
      }
      if (Array.isArray(parsed)) {
        if (Date.now() - entry.updatedUtc.getTime() > this.ttlMs) {
          void this.refresh(cacheKey, loader);
        }
        return parsed as string[];
      }
    }
    const fresh = await loader();
    if (fresh.length > 0) this.repo.set(cacheKey, JSON.stringify(fresh));
    return fresh;
  }

  private async refresh(cacheKey: string, loader: () => Promise<string[]>): Promise<void> {
    try {
      const fresh = await loader();
      if (fresh.length > 0) this.repo.set(cacheKey, JSON.stringify(fresh));
    } catch {
      // background refresh failures are swallowed
    }
  }

  /** Versioned distinct cache; v2 prefers user displayName over login/email. */
  getDistinct(
    projectKey: string,
    fieldName: string,
    loader: () => Promise<string[]>,
  ): Promise<string[]> {
    return this.cachedList(`distinct:v2:${projectKey}:${fieldName.toLowerCase()}`, loader);
  }

  getProjects(): Promise<string[]> {
    return this.cachedList('projects', () => this.inner.getProjects());
  }

  getIssueTypes(): Promise<string[]> {
    return this.cachedList('issuetypes', () => this.inner.getIssueTypes());
  }

  getStatuses(): Promise<string[]> {
    return this.cachedList('statuses', () => this.inner.getStatuses());
  }

  /** Id→name map; small and session-bound — passes through uncached. */
  getStatusMap(): Promise<Record<string, string>> {
    return this.inner.getStatusMap();
  }

  getPriorities(): Promise<string[]> {
    return this.cachedList('priorities', () => this.inner.getPriorities());
  }

  /** Not in the §5 cached-suffix list — passes through. */
  getResolutions(): Promise<string[]> {
    return this.inner.getResolutions();
  }

  getFields(): Promise<string[]> {
    return this.cachedList('fields', () => this.inner.getFields());
  }

  getVersions(projectKey: string): Promise<string[]> {
    return this.cachedList(`versions:${projectKey}`, () => this.inner.getVersions(projectKey));
  }

  getComponents(projectKey: string): Promise<string[]> {
    return this.cachedList(`components:${projectKey}`, () =>
      this.inner.getComponents(projectKey),
    );
  }

  getAssignableUsers(projectKey: string): Promise<string[]> {
    return this.cachedList(`users:${projectKey}`, () =>
      this.inner.getAssignableUsers(projectKey),
    );
  }

  /** Suggestions with a non-empty typed query skip the cache entirely. */
  getFieldSuggestions(fieldName: string, query?: string | null): Promise<string[]> {
    if (query && query.trim().length > 0) {
      return this.inner.getFieldSuggestions(fieldName, query);
    }
    return this.cachedList(`sugg:${fieldName.toLowerCase()}`, () =>
      this.inner.getFieldSuggestions(fieldName, query),
    );
  }

  /** Never cached. */
  resolveFieldId(displayName: string): Promise<string | null> {
    return this.inner.resolveFieldId(displayName);
  }

  /** Never cached. */
  resolveJqlField(displayName: string): Promise<string> {
    return this.inner.resolveJqlField(displayName);
  }
}
