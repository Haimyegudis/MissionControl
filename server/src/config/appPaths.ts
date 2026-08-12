import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Root data directory: %APPDATA%\JiraWeb, overridable via the JIRAWEB_DATA_DIR
 * environment variable (used by tests to point at a temp dir).
 * Evaluated lazily on every call so an env override set at runtime is honored.
 */
export function dataDir(): string {
  const override = process.env.JIRAWEB_DATA_DIR;
  if (override && override.trim().length > 0) return override;
  const appData =
    process.env.APPDATA && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'JiraWeb');
}

/** Create the directory (recursively) if missing; returns the path. */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Data dir, guaranteed to exist. */
export function ensureDataDir(): string {
  return ensureDir(dataDir());
}

export function configFile(): string {
  return path.join(dataDir(), 'config.json');
}

export function dbFile(): string {
  return path.join(dataDir(), 'jiraweb.db');
}

export function createDefaultsFile(): string {
  return path.join(dataDir(), 'create-defaults.json');
}

export function createMetaCacheFile(): string {
  return path.join(dataDir(), 'create-meta-cache.json');
}
