import fs from 'node:fs';
import path from 'node:path';
import { createDefaultsFile, createMetaCacheFile } from '../config/appPaths.js';
import { toCamelKeys, toPascalKeys } from './repositories.js';
import type { JiraCreateIssueMeta } from '../types.js';

// ---------------------------------------------------------------------------
// Shared file helpers — corrupt/missing file reads as {}
// ---------------------------------------------------------------------------

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Keys land in plain-object maps — refuse prototype-pollution names. */
export function assertSafeMapKey(key: string): void {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new Error(`Invalid key: ${key}`);
  }
}

function writeJson(filePath: string, value: unknown, indented: boolean): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, indented ? 2 : undefined), 'utf8');
}

// ---------------------------------------------------------------------------
// CreateDefaultsStore — create-defaults.json (storage-layer.md §4.2)
// Shape: { "PROJ:Type": { fieldId: FieldDefault } }, written indented.
// fieldId keys are Jira field ids (dictionary keys) — never case-converted;
// FieldDefault properties are PascalCase on disk and in the API.
// ---------------------------------------------------------------------------

export interface CreateFieldDefault {
  TextValue?: string;
  SelectedValue?: string;
  SelectedItems?: string[];
  DateValue?: string; // ISO
}

export type CreateDefaultsEntry = Record<string, CreateFieldDefault>;

export class CreateDefaultsStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? createDefaultsFile();
  }

  /** Defaults for a "{ProjectKey}:{IssueType}" key, or null when none saved. */
  load(key: string): CreateDefaultsEntry | null {
    const all = readJsonObject(this.filePath);
    const entry = all[key];
    return entry !== undefined && entry !== null && typeof entry === 'object'
      ? (entry as CreateDefaultsEntry)
      : null;
  }

  save(key: string, defaults: CreateDefaultsEntry): void {
    assertSafeMapKey(key);
    const all = readJsonObject(this.filePath);
    all[key] = defaults;
    writeJson(this.filePath, all, true);
  }

  clear(key: string): void {
    const all = readJsonObject(this.filePath);
    if (!(key in all)) return;
    delete all[key];
    writeJson(this.filePath, all, true);
  }
}

// ---------------------------------------------------------------------------
// CreateMetaCache — create-meta-cache.json (storage-layer.md §4.3)
// Shape: { "PROJ:Type": { SavedUtc: string, Meta: JiraCreateIssueMeta|null } },
// not indented; Meta stored with PascalCase keys. clearAll() deletes the file.
// ---------------------------------------------------------------------------

export interface CreateMetaEntry {
  savedUtc: Date;
  meta: JiraCreateIssueMeta | null;
}

interface StoredMetaEntry {
  SavedUtc: string;
  Meta: unknown;
}

export class CreateMetaCache {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? createMetaCacheFile();
  }

  load(key: string): CreateMetaEntry | null {
    const all = readJsonObject(this.filePath);
    const entry = all[key] as StoredMetaEntry | undefined;
    if (!entry || typeof entry !== 'object' || typeof entry.SavedUtc !== 'string') return null;
    const savedUtc = new Date(entry.SavedUtc);
    if (Number.isNaN(savedUtc.getTime())) return null;
    const meta =
      entry.Meta !== null && entry.Meta !== undefined
        ? toCamelKeys<JiraCreateIssueMeta>(entry.Meta)
        : null;
    return { savedUtc, meta };
  }

  save(key: string, meta: JiraCreateIssueMeta | null): void {
    assertSafeMapKey(key);
    const all = readJsonObject(this.filePath);
    const stored: StoredMetaEntry = {
      SavedUtc: new Date().toISOString(),
      Meta: meta !== null ? toPascalKeys(meta) : null,
    };
    all[key] = stored;
    writeJson(this.filePath, all, false);
  }

  clearAll(): void {
    fs.rmSync(this.filePath, { force: true });
  }
}
