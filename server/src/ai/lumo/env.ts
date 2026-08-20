/**
 * Lumo asset root + secret resolution.
 *
 * Lumo's knowledge assets (brain JSONs, vector DBs, config-control workbooks)
 * ship inside Mission Control's own `lumo` directory. LUMO_ROOT may override
 * that location for tests or managed deployments, but no external assistant
 * installation is required. Secrets resolve from process.env first and then
 * the optional <LUMO_ROOT>\.env file.
 * Secret VALUES are never logged.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bundledLumoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', 'lumo');

export function lumoRoot(): string {
  const fromEnv = process.env.LUMO_ROOT;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : bundledLumoRoot;
}

export function lumoPath(...parts: string[]): string {
  return path.join(lumoRoot(), ...parts);
}

// ---------------------------------------------------------------------------
// .env parsing (simple KEY=VALUE lines; quotes stripped; # comments skipped)
// ---------------------------------------------------------------------------

interface EnvFileCache {
  mtimeMs: number;
  values: Record<string, string>;
}

const envFileCache = new Map<string, EnvFileCache>();

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

function readEnvFile(file: string): Record<string, string> {
  try {
    if (!existsSync(file)) return {};
    const mtimeMs = statSync(file).mtimeMs;
    const cached = envFileCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.values;
    const values = parseEnvFile(readFileSync(file, 'utf8'));
    envFileCache.set(file, { mtimeMs, values });
    return values;
  } catch {
    return {};
  }
}

function candidateEnvFiles(): string[] {
  return [lumoPath('.env')];
}

/**
 * Resolve a secret/config value: process.env → <LUMO_ROOT>\.env.
 * Returns '' when nowhere configured. Never logs values.
 */
export function getLumoSecret(name: string): string {
  const fromProc = process.env[name];
  if (fromProc && fromProc.trim().length > 0) return fromProc.trim();
  for (const file of candidateEnvFiles()) {
    const values = readEnvFile(file);
    const v = values[name];
    if (v && v.trim().length > 0) return v.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Loading CommonJS knowledge dependencies bundled with Mission Control
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, unknown | null>();

/**
 * Require a Mission Control knowledge dependency (currently sqlite-vec).
 * Returns null when the package is absent — callers degrade
 * gracefully. Result (including failure) is cached per name.
 */
export function requireFromLumo<T = unknown>(moduleName: string): T | null {
  if (moduleCache.has(moduleName)) return moduleCache.get(moduleName) as T | null;
  let loaded: unknown | null = null;
  try {
    const req = createRequire(import.meta.url);
    loaded = req(moduleName);
  } catch {
    loaded = null;
  }
  moduleCache.set(moduleName, loaded);
  return loaded as T | null;
}

/** Test hook: forget cached env files and modules. */
export function resetLumoEnvCaches(): void {
  envFileCache.clear();
  moduleCache.clear();
}

// ---------------------------------------------------------------------------
// mtime-cached JSON reads (brain bundle files)
// ---------------------------------------------------------------------------

interface JsonCacheEntry {
  mtimeMs: number;
  data: unknown;
}

const jsonCache = new Map<string, JsonCacheEntry>();

/**
 * Read + parse a JSON file with an mtime-keyed cache. Returns null when the
 * file is missing or unparseable. Callers must not mutate the returned value.
 */
export function readJsonCached<T = unknown>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    const mtimeMs = statSync(file).mtimeMs;
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data as T;
    const data = JSON.parse(readFileSync(file, 'utf8')) as T;
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch {
    return null;
  }
}
