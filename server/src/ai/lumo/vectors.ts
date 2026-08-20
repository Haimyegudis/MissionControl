/**
 * Vector search over Lumo's sqlite-vec embedding DBs (Confluence, TestRail,
 * press issues) + Ollama embedding client — ports of Lumo's
 * embeddingSearch.js / testrailEmbeddings.js / pressIssuesSearch.js.
 *
 * The sqlite-vec extension is NOT a JiraWeb dependency: it is loaded from
 * Lumo's own node_modules (sqlite-vec package, or the vec0.dll it wraps).
 * When it cannot be loaded, vector tools return {error:'vector search
 * unavailable'} instead of crashing; press-issue search falls back to
 * keyword matching (as Lumo does).
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getLumoSecret, readJsonCached, requireFromLumo, lumoPath } from './env.js';

type Rec = Record<string, any>;

const SAFE_IDENT = /^[A-Za-z0-9_-]+$/;
const CONFLUENCE_SIMILARITY_THRESHOLD = 0.6;
const PRESS_SIMILARITY_THRESHOLD = 0.55;
const PRESS_COLLECTION = 'V12-PressIssues';

function confluenceDbPath(): string {
  const primary = lumoPath('DB', 'EmbeddingsDb.db');
  if (existsSync(primary)) return primary;
  const mcpCopy = lumoPath('mcp', 'ConfluenceMCP', 'EmbeddingsDB.db');
  return existsSync(mcpCopy) ? mcpCopy : primary;
}

const testrailDbPath = (): string => lumoPath('DB', 'TestRailEmbeddingsDb.db');
const codeDbPath = (): string => lumoPath('DB', 'CodeEmbeddingsDb.db');
const tmcDbPath = (): string => lumoPath('DB', 'TmcEmbeddingsDb.db');
const pressDbPath = (): string => lumoPath('DB', 'PressIssuesEmbeddingsDb.db');

// ---------------------------------------------------------------------------
// sqlite-vec loading (from Lumo's node_modules — never a JiraWeb dependency)
// ---------------------------------------------------------------------------

let vecLoadFailed = false;

function loadSqliteVec(db: InstanceType<typeof Database>): boolean {
  if (vecLoadFailed) return false;
  const pkg = requireFromLumo<{ load?: (db: unknown) => void; getLoadablePath?: () => string }>(
    'sqlite-vec',
  );
  try {
    if (pkg && typeof pkg.load === 'function') {
      pkg.load(db);
      return true;
    }
  } catch {
    // fall through to the raw dll
  }
  try {
    const dll = path.join(lumoPath('node_modules', 'sqlite-vec-windows-x64'), 'vec0.dll');
    if (existsSync(dll)) {
      db.loadExtension(dll);
      return true;
    }
  } catch {
    // unavailable
  }
  vecLoadFailed = true;
  return false;
}

// ---------------------------------------------------------------------------
// Pooled read-only DB handles + prepared statements (port of Lumo's pool)
// ---------------------------------------------------------------------------

interface PreparedStmt {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}

interface PooledDb {
  db: InstanceType<typeof Database>;
  stmts: Map<string, PreparedStmt>;
}

const dbPool = new Map<string, PooledDb>();

function getPooledDb(dbPath: string): PooledDb {
  let entry = dbPool.get(dbPath);
  if (!entry) {
    const db = new Database(dbPath, { readonly: true });
    db.pragma('busy_timeout = 5000');
    if (!loadSqliteVec(db)) {
      db.close();
      throw new Error('vector search unavailable (sqlite-vec extension could not be loaded)');
    }
    entry = { db, stmts: new Map() };
    dbPool.set(dbPath, entry);
  }
  return entry;
}

function prep(entry: PooledDb, sql: string): PreparedStmt {
  let stmt = entry.stmts.get(sql);
  if (!stmt) {
    stmt = entry.db.prepare(sql) as unknown as PreparedStmt;
    entry.stmts.set(sql, stmt);
  }
  return stmt;
}

// ---------------------------------------------------------------------------
// Ollama embeddings (staged shrink, port of Lumo's staircase)
// ---------------------------------------------------------------------------

const OLLAMA_URL = (): string => process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = (): string => process.env.EMBEDDING_MODEL || 'mxbai-embed-large:335m';
const EMBED_STAGES = [
  { chars: 900, timeoutMs: 60_000 },
  { chars: 500, timeoutMs: 90_000 },
  { chars: 250, timeoutMs: 120_000 },
];

const embCache = new Map<string, { vec: number[]; at: number }>();
const EMB_TTL_MS = 30_000;
const EMB_MAX = 64;

async function embedOnce(text: string, timeoutMs: number): Promise<number[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${OLLAMA_URL()}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL(),
        prompt: text,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || '24h',
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Ollama embeddings HTTP ${resp.status}`);
    const data = (await resp.json()) as Rec;
    return Array.isArray(data.embedding) ? (data.embedding as number[]) : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Embed text via Ollama; null when Ollama is unreachable / all stages fail. */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const full = String(text || '');
  if (!full.trim()) return null;
  const cacheKey = `${EMBEDDING_MODEL()}::${full.slice(0, EMBED_STAGES[0].chars)}`;
  const hit = embCache.get(cacheKey);
  if (hit && Date.now() - hit.at < EMB_TTL_MS) return hit.vec;

  for (const { chars, timeoutMs } of EMBED_STAGES) {
    try {
      const vec = await embedOnce(full.slice(0, chars), timeoutMs);
      if (vec && vec.length) {
        if (embCache.size >= EMB_MAX) {
          const firstKey = embCache.keys().next().value;
          if (firstKey !== undefined) embCache.delete(firstKey);
        }
        embCache.set(cacheKey, { vec, at: Date.now() });
        return vec;
      }
    } catch {
      // shrink and retry next stage
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// search_confluence_vectors
// ---------------------------------------------------------------------------

export async function searchConfluenceVectors(args: Rec): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  const requestedSeries = String(args.series ?? 'S6').toUpperCase();
  if (!query) return { error: 'query required' };
  if (requestedSeries === 'ALL') {
    const combined: Rec[] = [];
    for (const candidate of ['S3', 'S4', 'S5', 'S6']) {
      const hits = await searchConfluenceVectors({ ...args, series: candidate });
      if (Array.isArray(hits)) combined.push(...hits as Rec[]);
    }
    const unique = new Map<string, Rec>();
    for (const hit of combined.sort((a, b) => Number(b.similarity) - Number(a.similarity))) {
      const key = String(hit.documentId || hit.title);
      if (!unique.has(key)) unique.set(key, hit);
    }
    return [...unique.values()].slice(0, 20);
  }
  const series = requestedSeries;
  if (!SAFE_IDENT.test(series)) return { error: `unsafe series: ${series}` };
  const dbFile = confluenceDbPath();
  if (!existsSync(dbFile)) return { error: 'vector search unavailable (Confluence embeddings DB not found)' };

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return { error: 'vector search unavailable (embedding service unreachable)' };
  }

  try {
    const pooled = getPooledDb(dbFile);
    const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
    const maxResults = 10;
    const vecRows = prep(
      pooled,
      `SELECT Sampling, distance FROM "vec_${series}" WHERE SamplingEmbedding MATCH ? AND k = ? ORDER BY distance`,
    ).all(embeddingBlob, maxResults * 3) as Rec[];

    const results: Rec[] = [];
    const seen = new Set<string>();
    const confluenceBase =
      getLumoSecret('CONFLUENCE_BASE_URL') || 'https://v-indigo-confluence.inr.rd.hpicorp.net:6443';

    for (const vr of vecRows) {
      const similarity = 1.0 - vr.distance;
      if (similarity < CONFLUENCE_SIMILARITY_THRESHOLD) continue;
      const doc = prep(
        pooled,
        `SELECT Sampling, DocumentId, DocumentTitle, DocumentFolder, DocumentMarkdownFilePath FROM "${series}" WHERE Sampling = ?`,
      ).get(vr.Sampling) as Rec | undefined;
      if (!doc) continue;
      if (seen.has(doc.DocumentTitle)) continue;
      seen.add(doc.DocumentTitle);

      const url = `${confluenceBase}/pages/viewpage.action?pageId=${doc.DocumentId || ''}`;
      // The matched sampling is a section heading on the page (unless it is
      // the page title itself) — expose an anchored URL for exact deep links.
      const title = String(doc.DocumentTitle || '');
      const sampling = String(doc.Sampling || '');
      const heading =
        sampling && sampling !== title
          ? sampling.replace(
              new RegExp(`\\s*-\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
              '',
            )
          : null;
      const anchor = heading ? `${url}#${(title + '-' + heading).replace(/\s+/g, '')}` : null;

      results.push({
        series,
        documentId: doc.DocumentId,
        title,
        folder: doc.DocumentFolder,
        similarity: Math.round(similarity * 100) / 100,
        url,
        ...(heading ? { section: heading, sectionUrl: anchor } : {}),
      });
      if (results.length >= maxResults) break;
    }
    return results;
  } catch (err) {
    return { error: `vector search unavailable (${err instanceof Error ? err.message : String(err)})` };
  }
}

// ---------------------------------------------------------------------------
// search_testrail_vectors
// ---------------------------------------------------------------------------

export async function searchTestrailVectors(args: Rec): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  const requestedSeries = String(args.series ?? 'S6').toUpperCase();
  const component = args.component ? String(args.component) : null;
  const maxResults = 10;
  const threshold = 0.55;
  if (!query) return { error: 'query required' };
  if (requestedSeries === 'ALL') {
    const combined: Rec[] = [];
    for (const candidate of ['S3', 'S4', 'S6', 'RAMON']) {
      const hits = await searchTestrailVectors({ ...args, series: candidate });
      if (Array.isArray(hits)) combined.push(...hits as Rec[]);
    }
    const unique = new Map<string, Rec>();
    for (const hit of combined.sort((a, b) => Number(b.similarity) - Number(a.similarity))) {
      const key = `${hit.series}:${hit.caseId}`;
      if (!unique.has(key)) unique.set(key, hit);
    }
    return [...unique.values()].slice(0, 20);
  }
  // S5 shares the S4 TestRail project and embeddings pipeline.
  const series = requestedSeries === 'S5' ? 'S4' : requestedSeries;
  if (!SAFE_IDENT.test(series)) return { error: `unsafe series: ${series}` };
  const dbFile = testrailDbPath();
  if (!existsSync(dbFile)) return { error: 'vector search unavailable (TestRail embeddings DB not found)' };

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return { error: 'vector search unavailable (embedding service unreachable)' };

  try {
    const pooled = getPooledDb(dbFile);
    const collectionName = `${series}-TestRail`;
    const vecTable = `vec_${collectionName}`;
    const tableCheck = prep(
      pooled,
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    ).get(vecTable);
    if (!tableCheck) return { error: `vector table for series ${series} not found` };

    const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);

    // Detect which schema the metadata table uses (external tool vs scanSuite)
    const colInfo = pooled.db.prepare(`PRAGMA table_info("${collectionName}")`).all() as Rec[];
    const colNames = new Set(colInfo.map((c) => c.name));
    const hasDocumentId = colNames.has('DocumentId');
    const hasComponent = colNames.has('Component');

    const fetchK = component ? maxResults * 5 : maxResults * 3;
    const vecRows = prep(
      pooled,
      `SELECT Sampling, distance FROM "${vecTable}" WHERE SamplingEmbedding MATCH ? AND k = ? ORDER BY distance`,
    ).all(embeddingBlob, fetchK) as Rec[];

    const componentMatches: Rec[] = [];
    const otherMatches: Rec[] = [];
    const seen = new Set<string>();

    for (const vr of vecRows) {
      const similarity = 1.0 - vr.distance;
      if (similarity < threshold) continue;

      const selectCols = hasDocumentId
        ? hasComponent
          ? 'DocumentId, DocumentTitle, DocumentFolder, DocumentMarkdownFilePath, Sampling, Component'
          : 'DocumentId, DocumentTitle, DocumentFolder, DocumentMarkdownFilePath, Sampling'
        : hasComponent
          ? 'CaseId, Title, JiraKey, SuiteId, Sampling, StepCount, Component'
          : 'CaseId, Title, JiraKey, SuiteId, Sampling, StepCount';
      const row = prep(
        pooled,
        `SELECT ${selectCols} FROM "${collectionName}" WHERE Sampling = ?`,
      ).get(vr.Sampling) as Rec | undefined;
      if (!row) continue;

      const caseId = hasDocumentId ? row.DocumentId : row.CaseId;
      if (seen.has(String(caseId))) continue;
      seen.add(String(caseId));

      const rowComponent = hasComponent ? row.Component || null : null;
      const confluenceBase =
        getLumoSecret('CONFLUENCE_BASE_URL') || 'https://v-indigo-confluence.inr.rd.hpicorp.net:6443';
      const result: Rec = hasDocumentId
        ? {
            series: requestedSeries,
            caseId,
            title: row.DocumentTitle,
            suiteFolder: row.DocumentFolder,
            // Always link to the real Confluence page — never local markdown paths.
            url: row.DocumentId ? `${confluenceBase}/pages/viewpage.action?pageId=${row.DocumentId}` : null,
            similarity: Math.round(similarity * 100) / 100,
            content: row.Sampling,
            component: rowComponent,
          }
        : {
            series: requestedSeries,
            caseId,
            title: row.Title,
            similarity: Math.round(similarity * 100) / 100,
            content: row.Sampling,
            component: rowComponent,
          };

      const compParts = component ? component.split(',').map((c) => c.trim().toLowerCase()) : [];
      if (component && rowComponent && compParts.includes(String(rowComponent).toLowerCase())) {
        componentMatches.push(result);
      } else {
        otherMatches.push(result);
      }
    }

    // Deduplicate by Jira key — keep only the highest-similarity test per key
    const dedup = (arr: Rec[]): Rec[] => {
      const byKey = new Map<string, Rec>();
      for (const r of arr) {
        const keyMatch = String(r.title || '').match(/([A-Z]+-\d+)/);
        const jiraKey = keyMatch ? keyMatch[1] : String(r.caseId);
        const prev = byKey.get(jiraKey);
        if (!prev || r.similarity > prev.similarity) byKey.set(jiraKey, r);
      }
      return [...byKey.values()];
    };

    const results = [...dedup(componentMatches), ...dedup(otherMatches)].slice(0, maxResults);
    for (const r of results) {
      if (r.caseId && !r.url) {
        r.url = `https://hp-testrail.external.hp.com/index.php?/cases/view/${r.caseId}`;
      }
    }
    await enrichTestrailOwners(results);
    return results;
  } catch (err) {
    return { error: `vector search unavailable (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** Best-effort owner enrichment via the TestRail REST API (Lumo parity). */
async function enrichTestrailOwners(results: Rec[]): Promise<void> {
  try {
    const user = getLumoSecret('TESTRAIL_USER');
    const key = getLumoSecret('TESTRAIL_API_KEY');
    if (!user || !key || results.length === 0) return;
    const baseUrl = (getLumoSecret('TESTRAIL_BASE_URL') || 'https://hp-testrail.external.hp.com').replace(
      /\/+$/,
      '',
    );
    const auth = `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`;
    await Promise.all(
      results.map(async (r) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          try {
            const resp = await fetch(`${baseUrl}/index.php?/api/v2/get_case/${r.caseId}`, {
              headers: { Authorization: auth, 'Content-Type': 'application/json' },
              signal: controller.signal,
            });
            if (!resp.ok) return;
            const c = (await resp.json()) as Rec;
            if (c.created_by_name) r.owner = c.created_by_name;
            else if (c.custom_owner) r.owner = c.custom_owner;
          } finally {
            clearTimeout(timer);
          }
        } catch {
          // best-effort only
        }
      }),
    );
  } catch {
    // best-effort only
  }
}

// ---------------------------------------------------------------------------
// Code and TMC vector knowledge
// ---------------------------------------------------------------------------

async function searchTechnicalCollections(
  dbFile: string,
  query: string,
  collections: string[],
  component?: string | null,
): Promise<unknown> {
  if (!existsSync(dbFile)) return { error: 'vector search unavailable (knowledge DB not found)' };
  const embedding = await generateEmbedding(query);
  if (!embedding) return { error: 'vector search unavailable (embedding service unreachable)' };
  try {
    const pooled = getPooledDb(dbFile);
    const blob = Buffer.from(new Float32Array(embedding).buffer);
    const results: Rec[] = [];
    for (const collection of collections) {
      if (!SAFE_IDENT.test(collection)) continue;
      const vecTable = `vec_${collection}`;
      const exists = prep(pooled, "SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(vecTable);
      if (!exists) continue;
      const rows = prep(
        pooled,
        `SELECT Sampling, distance FROM "${vecTable}" WHERE SamplingEmbedding MATCH ? AND k = ? ORDER BY distance`,
      ).all(blob, 16) as Rec[];
      for (const match of rows) {
        const similarity = 1 - Number(match.distance);
        if (similarity < 0.55) continue;
        const row = prep(
          pooled,
          `SELECT Sampling, DocumentId, DocumentTitle, DocumentFolder, DocumentMarkdownFilePath, Component FROM "${collection}" WHERE Sampling = ?`,
        ).get(match.Sampling) as Rec | undefined;
        if (!row) continue;
        if (component && !String(row.Component ?? '').toLowerCase().includes(component.toLowerCase())) continue;
        results.push({
          collection,
          component: row.Component ?? null,
          title: row.DocumentTitle,
          folder: row.DocumentFolder,
          content: row.Sampling,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
    }
    const seen = new Set<string>();
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .filter((row) => {
        const key = `${row.collection}:${row.title}:${row.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  } catch (err) {
    return { error: `vector search unavailable (${err instanceof Error ? err.message : String(err)})` };
  }
}

function matchingCollections(dbFile: string, suffix: string, requestedSeries: string, program?: string): string[] {
  try {
    const pooled = getPooledDb(dbFile);
    const series = requestedSeries === 'S5' ? 'S4' : requestedSeries;
    const prefixes = series === 'ALL' ? ['S3-', 'S4-', 'S6-', 'RAMON-'] : [`${series}-`];
    return (pooled.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Rec[])
      .map((row) => String(row.name))
      .filter((name) => !name.startsWith('vec_') && name.endsWith(suffix))
      .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
      .filter((name) => !program || name.toLowerCase().includes(`-${program.toLowerCase()}-`));
  } catch {
    return [];
  }
}

export async function searchCodeVectors(args: Rec): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query required' };
  const series = String(args.series ?? 'ALL').toUpperCase();
  if (!SAFE_IDENT.test(series)) return { error: `unsafe series: ${series}` };
  const collections = matchingCollections(codeDbPath(), '-Code', series, args.program ? String(args.program) : undefined);
  if (!collections.length) return { error: `no code embeddings found for ${series}` };
  return searchTechnicalCollections(codeDbPath(), query, collections, args.component ? String(args.component) : null);
}

export async function searchTmcVectors(args: Rec): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query required' };
  const series = String(args.series ?? 'ALL').toUpperCase();
  if (!SAFE_IDENT.test(series)) return { error: `unsafe series: ${series}` };
  const collections = matchingCollections(tmcDbPath(), '-TMC-Signals', series);
  if (!collections.length) return { error: `no TMC signal embeddings found for ${series}` };
  return searchTechnicalCollections(tmcDbPath(), query, collections, args.component ? String(args.component) : null);
}

// ---------------------------------------------------------------------------
// lookup_press_issue
// ---------------------------------------------------------------------------

function termRe(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

function loadSynonymGroups(): string[][] {
  const parsed = readJsonCached<Rec>(lumoPath('data', 'brain', 'press-synonyms.json'));
  return parsed && Array.isArray(parsed.groups) ? (parsed.groups as string[][]) : [];
}

function expandQuery(query: string): { expanded: string; matchedGroups: string[][] } {
  const q = String(query || '');
  const extra: string[] = [];
  const matchedGroups: string[][] = [];
  for (const group of loadSynonymGroups()) {
    if (group.some((term) => termRe(term).test(q))) {
      matchedGroups.push(group);
      for (const term of group) {
        if (!termRe(term).test(q)) extra.push(term);
      }
    }
  }
  return { expanded: extra.length ? `${q} (${extra.join(', ')})` : q, matchedGroups };
}

/** Read-only feedback boosts from Lumo's press-feedback.json (never written). */
function feedbackBoostsFor(symptom: string): (sol: Rec) => { up: number; down: number } {
  const store = readJsonCached<Rec>(lumoPath('data', 'brain', 'press-feedback.json')) ?? {
    entries: {},
  };
  const solutionKey = (sol: Rec) =>
    `${String(symptom).toLowerCase()}|${String(sol.action || '').toLowerCase()}|${String(
      sol.causePath || '',
    ).toLowerCase()}|${String(sol.partNumber || '').toLowerCase()}`;
  return (sol: Rec) => (store.entries || {})[solutionKey(sol)] || { up: 0, down: 0 };
}

function formatCluster(cluster: Rec, similarity: number | null): Rec {
  const fb = feedbackBoostsFor(cluster.symptom);
  const urlTemplate = getLumoSecret('PRESS_CASE_URL_TEMPLATE');
  const solutions = (cluster.solutions as Rec[]).map((s) => {
    const f = fb(s);
    return {
      rank: s.rank,
      action: s.action || '(no action recorded)',
      causePath: s.causePath || undefined,
      partNumber: s.partNumber || undefined,
      partNumbersMentioned: s.partNumbersMentioned || undefined,
      fixedCases: s.count,
      fixedPercent: Math.round((s.share || 0) * 100),
      confirmedByTechnicians: f.up || undefined,
      rejectedByTechnicians: f.down || undefined,
      sampleNotes: (s.sampleNotes || []).length ? s.sampleNotes : undefined,
      caseNumbers: (s.caseNumbers || []).slice(0, 8),
      caseLinks: urlTemplate
        ? (s.caseNumbers || [])
            .slice(0, 3)
            .map((cn: string) => ({ caseNumber: cn, url: urlTemplate.replace('{caseNumber}', cn) }))
        : undefined,
      _score: (s.count || 0) + (f.up || 0) * 2 - (f.down || 0),
    } as Rec;
  });
  solutions.sort((a, b) => {
    const aReal = a.action !== '(no action recorded)' ? 1 : 0;
    const bReal = b.action !== '(no action recorded)' ? 1 : 0;
    return bReal - aReal || b._score - a._score;
  });
  solutions.forEach((s, i) => {
    s.rank = i + 1;
    delete s._score;
  });
  return {
    symptom: cluster.symptom,
    variants: cluster.variants,
    matchSimilarity: similarity != null ? Math.round(similarity * 100) / 100 : undefined,
    occurrences: cluster.occurrences,
    categories: cluster.categories,
    solutions,
  };
}

function keywordSearchPress(issues: Rec, query: string, maxResults: number): Rec[] {
  const kwTerms = String(query || '')
    .toLowerCase()
    .split(/[\s,_-]+/)
    .filter((t) => t.length >= 3);
  if (!kwTerms.length) return [];
  const scored = (issues.clusters as Rec[])
    .map((cl) => {
      const hay = `${cl.symptom} ${(cl.variants || []).join(' ')} ${(cl.categories || []).join(
        ' ',
      )}`.toLowerCase();
      const hits = kwTerms.filter((t) => hay.includes(t)).length;
      return { cl, score: hits / kwTerms.length };
    })
    .filter((x) => x.score >= 0.5);
  scored.sort((a, b) => b.score - a.score || b.cl.occurrences - a.cl.occurrences);
  return scored.slice(0, maxResults).map((x) => formatCluster(x.cl, null));
}

export async function searchPressIssues(args: Rec): Promise<Rec> {
  const queryInput = args.queries ?? args.query ?? '';
  const queries = (Array.isArray(queryInput) ? queryInput : [queryInput])
    .map((q: unknown) => String(q ?? '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const maxResults = 5;
  if (!queries.length) return { found: false, count: 0, issues: [], note: 'Empty query.' };

  const issues = readJsonCached<Rec>(lumoPath('data', 'brain', 'press-issues.json'));
  if (!issues || !Array.isArray(issues.clusters)) {
    return {
      found: false,
      count: 0,
      issues: [],
      note: 'Press issues knowledge not ingested yet.',
    };
  }

  const expansions = queries.map((q) => expandQuery(q));
  const matchedGroups = [...new Set(expansions.flatMap((e) => e.matchedGroups))];

  if (existsSync(pressDbPath())) {
    try {
      const pooled = getPooledDb(pressDbPath());
      const byCluster = new Map<string, number>();
      let anyEmbedding = false;
      for (const e of expansions) {
        const queryEmbedding = await generateEmbedding(e.expanded);
        if (!queryEmbedding || !queryEmbedding.length) continue;
        anyEmbedding = true;
        const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
        const vecRows = prep(
          pooled,
          `SELECT Sampling, distance FROM "vec_${PRESS_COLLECTION}" WHERE SamplingEmbedding MATCH ? AND k = ? ORDER BY distance`,
        ).all(embeddingBlob, maxResults * 6) as Rec[];
        for (const vr of vecRows) {
          const similarity = 1.0 - vr.distance;
          if (similarity < PRESS_SIMILARITY_THRESHOLD) continue;
          const meta = prep(
            pooled,
            `SELECT DocumentId FROM "${PRESS_COLLECTION}" WHERE Sampling = ? LIMIT 1`,
          ).get(vr.Sampling) as Rec | undefined;
          if (!meta) continue;
          const prev = byCluster.get(meta.DocumentId);
          if (prev == null || similarity > prev) byCluster.set(meta.DocumentId, similarity);
        }
      }

      if (anyEmbedding) {
        const clusterById = new Map((issues.clusters as Rec[]).map((cl) => [cl.id, cl]));
        const kwTerms = queries
          .join(' ')
          .toLowerCase()
          .split(/[\s,()_-]+/)
          .filter((t) => t.length >= 3);
        const clusterHay = (cl: Rec) =>
          `${cl.symptom} ${(cl.variants || []).join(' ')} ${(cl.categories || []).join(' ')}`;
        const kwRatio = (cl: Rec) => {
          if (!kwTerms.length) return 0;
          const hay = clusterHay(cl).toLowerCase();
          return kwTerms.filter((t) => hay.includes(t)).length / kwTerms.length;
        };
        const inSubsystem = (cl: Rec) => {
          if (!matchedGroups.length) return true;
          const hay = clusterHay(cl);
          return matchedGroups.every((group) => group.some((term) => termRe(term).test(hay)));
        };
        const results = [...byCluster.entries()]
          .map(([id, sim]) => ({ cl: clusterById.get(id) as Rec | undefined, sim }))
          .filter((x): x is { cl: Rec; sim: number } => Boolean(x.cl))
          .map((x) => ({
            ...x,
            tier: inSubsystem(x.cl) ? 1 : 0,
            score:
              x.sim +
              0.03 * Math.log2(1 + (x.cl.occurrences || 0)) +
              ((x.cl.solutions as Rec[]).some((s) => s.action) ? 0.02 : 0) +
              0.1 * kwRatio(x.cl),
          }))
          .sort((a, b) => b.tier - a.tier || b.score - a.score)
          .slice(0, maxResults)
          .map((x) => formatCluster(x.cl, x.sim));

        return { found: results.length > 0, count: results.length, issues: results };
      }
    } catch {
      // fall through to keyword search
    }
  }

  const results = keywordSearchPress(issues, expansions.map((e) => e.expanded).join(' '), maxResults);
  return {
    found: results.length > 0,
    count: results.length,
    issues: results,
    note: 'Embedding search unavailable — results from keyword match on known symptoms.',
  };
}
