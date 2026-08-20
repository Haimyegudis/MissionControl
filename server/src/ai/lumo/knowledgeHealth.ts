import Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { lumoPath, lumoRoot, requireFromLumo } from './env.js';

interface CollectionHealth {
  name: string;
  sourceRows: number;
  uniqueSources: number;
  embeddedSources: number;
  coveragePct: number;
  ok: boolean;
}

interface DatabaseHealth {
  name: string;
  bytes: number;
  collections: CollectionHealth[];
  ok: boolean;
  error?: string;
}

const DATABASES: Array<{ name: string; include: RegExp }> = [
  { name: 'EmbeddingsDb.db', include: /^(S3|S4|S5|S6|RNDDM-LAB-AT-WEB|WSDPS-RAMON)$/ },
  { name: 'TestRailEmbeddingsDb.db', include: /-TestRail$/ },
  { name: 'CodeEmbeddingsDb.db', include: /-Code$/ },
  { name: 'TmcEmbeddingsDb.db', include: /-TMC-Signals$/ },
  { name: 'PressIssuesEmbeddingsDb.db', include: /^V12-PressIssues$/ },
];

function inspectDatabase(spec: { name: string; include: RegExp }): DatabaseHealth {
  const file = lumoPath('DB', spec.name);
  if (!existsSync(file)) return { name: spec.name, bytes: 0, collections: [], ok: false, error: 'missing' };
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const sqliteVec = requireFromLumo<{ load?: (database: unknown) => void }>('sqlite-vec');
    if (!sqliteVec?.load) throw new Error('sqlite-vec is not bundled');
    sqliteVec.load(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>)
      .map((row) => row.name)
      .filter((name) => !name.startsWith('vec_') && spec.include.test(name));
    const collections = names.map((name): CollectionHealth => {
      const quoted = name.replaceAll('"', '""');
      const source = db.prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT Sampling) AS uniqueSources FROM "${quoted}"`).get() as { rows: number; uniqueSources: number };
      const vector = db.prepare(`SELECT COUNT(DISTINCT Sampling) AS embeddedSources FROM "vec_${quoted}"`).get() as { embeddedSources: number };
      const coveragePct = source.uniqueSources
        ? Math.round((vector.embeddedSources / source.uniqueSources) * 10_000) / 100
        : 100;
      return {
        name,
        sourceRows: source.rows,
        uniqueSources: source.uniqueSources,
        embeddedSources: vector.embeddedSources,
        coveragePct,
        ok: vector.embeddedSources >= source.uniqueSources,
      };
    });
    return {
      name: spec.name,
      bytes: statSync(file).size,
      collections,
      ok: collections.length > 0 && collections.every((collection) => collection.ok),
    };
  } catch (error) {
    return {
      name: spec.name,
      bytes: statSync(file).size,
      collections: [],
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db.close();
  }
}

const REQUIRED_BRAIN = [
  'systems-s3.json', 'systems-s4.json', 'systems-s6.json', 'systems-autonomous.json', 'systems-ramon.json',
  'testrail-knowledge-s3.json', 'testrail-knowledge-s4.json', 'testrail-knowledge-s6.json', 'testrail-knowledge-ramon.json',
  'code-knowledge-s3.json', 'code-knowledge-s4.json', 'code-knowledge-s6.json', 'code-knowledge-ramon.json',
  'tmc-signals-s3.json', 'tmc-signals-s6.json', 'press-issues.json', 'reverse-indexes.json',
];

export function lumoKnowledgeHealth() {
  const databases = DATABASES.map(inspectDatabase);
  const brain = REQUIRED_BRAIN.map((name) => {
    const file = lumoPath('data', 'brain', name);
    return { name, present: existsSync(file), bytes: existsSync(file) ? statSync(file).size : 0 };
  });
  const config = lumoPath('config', 'series-config.json');
  const testBrain = lumoPath('data', 'testbrain.db');
  const manifest = lumoPath('manifest.json');
  const ok = databases.every((database) => database.ok)
    && brain.every((entry) => entry.present)
    && existsSync(config)
    && existsSync(testBrain)
    && existsSync(manifest);
  return {
    ok,
    checkedAt: new Date().toISOString(),
    root: path.resolve(lumoRoot()),
    selfContained: path.basename(path.resolve(lumoRoot())).toLowerCase() === 'lumo',
    databases,
    brain,
    supportingFiles: {
      seriesConfig: existsSync(config),
      manifest: existsSync(manifest),
      testBrain: existsSync(testBrain),
      configControl: existsSync(lumoPath('data', 'config-control.xlsx')),
      davidConfigControl: existsSync(lumoPath('data', 'david-config-control.csv')),
    },
  };
}
