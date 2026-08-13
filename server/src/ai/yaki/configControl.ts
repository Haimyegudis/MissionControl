/**
 * Config Control — read-only reader for the press configuration-control
 * tables (port of Yaki's configControl.js). Data files live under
 * <YAKI_ROOT>/data and are never written.
 *
 * CSV files are parsed natively (no dependency). XLSX workbooks are parsed
 * with the 'xlsx' package loaded from YAKI's node_modules — when that is
 * unavailable and only an .xlsx file exists, the tool returns
 * {error:'xlsx unsupported...'} instead of crashing.
 */
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getYakiSecret, requireFromYaki, yakiPath } from './env.js';

type Rec = Record<string, any>;

interface Book {
  key: string;
  label: string;
  local: string;
  source: string;
  hint: string;
}

function books(): Record<string, Book> {
  const dataDir = yakiPath('data');
  return {
    kedem: {
      key: 'kedem',
      label: 'KEDEM Config Control',
      local: getYakiSecret('CONFIG_CONTROL_PATH') || path.join(dataDir, 'config-control.xlsx'),
      source: getYakiSecret('CONFIG_CONTROL_SOURCE'),
      hint: 'Save a copy of the SharePoint "Config control.xlsx"',
    },
    david: {
      key: 'david',
      label: 'DAVID Configuration Control',
      local:
        getYakiSecret('DAVID_CONFIG_CONTROL_PATH') || path.join(dataDir, 'david-config-control.xlsx'),
      source: getYakiSecret('DAVID_CONFIG_CONTROL_SOURCE'),
      hint: 'Export the SharePoint list "David Configuration Control" (Export → Excel/CSV) and save it',
    },
  };
}

function bookFor(program: unknown): Book | null {
  const key = String(program || 'kedem').toLowerCase();
  return books()[key] ?? null;
}

function findLocal(book: Book): string | null {
  const dir = path.dirname(book.local);
  const candidates = [
    book.local,
    book.local.replace(/\.xlsx$/i, '.csv'),
    ...(book.key === 'kedem'
      ? ['Config control.xlsx', 'Copy of Config control.xlsx', 'Config control.csv']
      : ['David Configuration Control.xlsx', 'David Configuration Control.csv']
    ).map((n) => path.join(dir, n)),
  ];
  let best: string | null = null;
  let bestM = -1;
  for (const c of candidates) {
    if (existsSync(c)) {
      const m = statSync(c).mtimeMs;
      if (m > bestM) {
        best = c;
        bestM = m;
      }
    }
  }
  return best;
}

function refreshLocalFromSource(book: Book): void {
  if (!book.source) return;
  try {
    if (!existsSync(book.source)) return;
    const src = statSync(book.source);
    const dest = /\.csv$/i.test(book.source) ? book.local.replace(/\.xlsx$/i, '.csv') : book.local;
    if (!existsSync(dest) || src.mtimeMs > statSync(dest).mtimeMs) {
      copyFileSync(book.source, dest);
    }
  } catch {
    // source refresh is best-effort
  }
}

// ---------------------------------------------------------------------------
// Native CSV parsing (quoted cells, embedded commas/newlines, CRLF)
// ---------------------------------------------------------------------------

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // Strip BOM
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // swallow (handled by \n)
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvToObjects(content: string, sheetName: string): Rec[] {
  const rows = parseCsv(content);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h, i) => (h.trim().length > 0 ? h.trim() : `Column${i + 1}`));
  const out: Rec[] = [];
  for (const r of rows.slice(1)) {
    if (r.every((c) => c.trim().length === 0)) continue;
    const obj: Rec = { _sheet: sheetName };
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? '';
    out.push(obj);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading (cached by mtime)
// ---------------------------------------------------------------------------

const cache = new Map<string, { mtimeMs: number; file: string; rows: Rec[] }>();

function load(program: unknown): { rows?: Rec[]; error?: string } {
  const book = bookFor(program);
  if (!book) return { error: `Unknown config-control program "${program}" — use "kedem" or "david".` };

  refreshLocalFromSource(book);
  const file = findLocal(book);
  if (!file) {
    return {
      error:
        `${book.label} data not found. ${book.hint} to ${book.local} ` +
        `(or the .csv equivalent, or set ${book.key === 'david' ? 'DAVID_' : ''}CONFIG_CONTROL_SOURCE ` +
        'in .env to its OneDrive-synced path) and ask again.',
    };
  }
  const mtimeMs = statSync(file).mtimeMs;
  const cached = cache.get(book.key);
  if (cached && cached.mtimeMs === mtimeMs && cached.file === file) return { rows: cached.rows };

  let rows: Rec[];
  if (/\.csv$/i.test(file)) {
    rows = csvToObjects(readFileSync(file, 'utf8'), path.basename(file, path.extname(file)));
  } else {
    const XLSX = requireFromYaki<Rec>('xlsx');
    if (!XLSX) {
      return {
        error:
          'xlsx unsupported — the xlsx parser is not available in this deployment and only an ' +
          `.xlsx copy of ${book.label} exists. Export the table as CSV next to it (same basename) and ask again.`,
      };
    }
    try {
      const wb = XLSX.readFile(file, { cellDates: true });
      rows = [];
      for (const sheetName of wb.SheetNames as string[]) {
        const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' }) as Rec[];
        for (const r of json) rows.push({ _sheet: sheetName, ...r });
      }
    } catch (err) {
      return {
        error: `Failed to parse ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  cache.set(book.key, { mtimeMs, file, rows });
  return { rows };
}

// ---------------------------------------------------------------------------
// Search + listClusters (direct ports)
// ---------------------------------------------------------------------------

/** Normalize a cluster mention: "C12" / "c 12" / "cluster 12" / 12 → "12". */
function clusterNum(v: unknown): string | null {
  const m = String(v ?? '').match(/(\d+)/);
  return m ? m[1] : null;
}

function columnMatch(row: Rec, headerRe: RegExp, want: unknown): boolean {
  const w = String(want).trim().toLowerCase();
  const cells = Object.entries(row).filter(([k]) => headerRe.test(k));
  if (!cells.length) return true; // column absent in this table — don't exclude
  return cells.some(([, v]) => String(v).toLowerCase().includes(w));
}

export function searchConfigControl(args: Rec): Rec {
  const { program, cluster, query, subsystem, cabinet, component } = args;
  if (!cluster && !query && !subsystem && !cabinet && !component) {
    return { error: 'at least one of cluster/query/subsystem/cabinet/component required' };
  }
  const loaded = load(program);
  if (loaded.error) return { error: loaded.error };
  const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 40;

  const wantCluster = clusterNum(cluster);
  const q = String(query || '').trim().toLowerCase();
  const qTerms = q ? q.split(/\s+/).filter((t) => t.length >= 2) : [];

  const matches = (loaded.rows as Rec[]).filter((row) => {
    const cells = Object.entries(row);
    if (wantCluster) {
      const clusterCell = cells.find(([k]) => /cluster/i.test(k));
      const rowCluster = clusterCell ? clusterNum(clusterCell[1]) : null;
      const anyCluster =
        rowCluster ??
        clusterNum((cells.find(([, v]) => /^c\s*\d+$/i.test(String(v).trim())) || [])[1]);
      if (anyCluster !== wantCluster) return false;
    }
    if (subsystem && !columnMatch(row, /sub\s*system/i, subsystem)) return false;
    if (cabinet && !columnMatch(row, /cabinet/i, cabinet)) return false;
    if (component && !columnMatch(row, /component/i, component)) return false;
    if (qTerms.length) {
      const hay = cells
        .map(([, v]) => String(v))
        .join(' | ')
        .toLowerCase();
      if (!qTerms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  return { program: bookFor(program)?.key, total: matches.length, rows: matches.slice(0, limit) };
}

export function listConfigClusters(args: Rec): Rec {
  const loaded = load(args.program);
  if (loaded.error) return { error: loaded.error };
  const found = new Set<string>();
  for (const row of loaded.rows as Rec[]) {
    for (const [k, v] of Object.entries(row)) {
      if (/cluster/i.test(k)) {
        const n = clusterNum(v);
        if (n) found.add(n);
      } else if (/^c\s*\d+$/i.test(String(v).trim())) {
        const n = clusterNum(v);
        if (n) found.add(n);
      }
    }
  }
  return {
    program: bookFor(args.program)?.key,
    clusters: [...found].sort((a, b) => Number(a) - Number(b)).map((n) => `C${n}`),
  };
}
