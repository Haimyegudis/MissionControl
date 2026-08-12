// CSV building (ui-parity-contract.md §12.10). Pure builder — unit tested;
// `downloadCsv` is the browser-only side effect.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

function escapeCell(raw: unknown): string {
  const s = raw === null || raw === undefined ? '' : String(raw);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * RFC-4180 CSV with a UTF-8 BOM prefix. Columns are expected to already be the
 * visible ones in display order.
 */
export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Filename = grid state key with `.` → `_`, plus `.csv`. */
export function csvFilename(stateKey: string): string {
  return `${stateKey.replace(/\./g, '_')}.csv`;
}

/** Trigger a client-side download of the CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
