// Boards Search pure logic (ui-parity §4): Indigo-only restriction, live
// client-side search, and the diagnostics line format from BoardLoadResult.

import type { JiraBoard } from '../types';

/** Board-load diagnostics (mirror of server BoardLoadResult, counts optional). */
export interface BoardDiagnostics {
  fromGreenhopper: number | null;
  fromAgile: number | null;
  greenhopperError: string | null;
  agileError: string | null;
  total: number;
  indigoCount: number;
}

/**
 * §4: restrict to Indigo-related boards only — the HP DC instance returns
 * thousands of unrelated rapid views.
 */
export function filterIndigoBoards(boards: readonly JiraBoard[]): JiraBoard[] {
  return boards.filter((b) => b.name.toLowerCase().includes('indigo'));
}

/** Live search: Name OR FilterName, case-insensitive substring. */
export function searchBoards(boards: readonly JiraBoard[], query: string): JiraBoard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...boards];
  return boards.filter(
    (b) => b.name.toLowerCase().includes(q) || (b.filterName?.toLowerCase().includes(q) ?? false),
  );
}

/**
 * Diagnostics line, format verbatim from the WPF BoardSearchViewModel:
 * `Greenhopper: {n}[ (err)]  |  Agile: {n}[ (err)]  |  All: {total}  |  Indigo only: {n}`.
 * When the server response carried no source split (current /api/boards returns
 * the bare board list), the Greenhopper/Agile segments are omitted.
 */
export function formatBoardDiagnostics(d: BoardDiagnostics): string {
  const parts: string[] = [];
  if (d.fromGreenhopper !== null) {
    parts.push(`Greenhopper: ${d.fromGreenhopper}${d.greenhopperError === null ? '' : ` (${d.greenhopperError})`}`);
  }
  if (d.fromAgile !== null) {
    parts.push(`Agile: ${d.fromAgile}${d.agileError === null ? '' : ` (${d.agileError})`}`);
  }
  parts.push(`All: ${d.total}`);
  parts.push(`Indigo only: ${d.indigoCount}`);
  return parts.join('  |  ');
}
