// Jira-side repositories over the KvStore port. Behaviour is identical to the
// SQLite versions these replace; only the backing store is injected. The
// camelCase <-> PascalCase key conversion moved here with them, because only
// these three repositories use it (storage-layer.md §8.1 — blobs keep
// PascalCase keys).

import { defaultAppSettings, type AppSettings, type JiraIssue } from '../types.js';
import type { KvStore } from './kv.js';

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

/** The settings blob has always lived under a single row keyed 1. */
const SETTINGS_KEY = '1';

export class AppSettingsRepo {
  constructor(private readonly kv: KvStore) {}

  /** Returns stored settings merged over defaults; full defaults when absent. */
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

  /** Caller passes an already-serialized JSON string. */
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
