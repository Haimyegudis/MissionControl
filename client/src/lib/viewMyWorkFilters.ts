// My Work column-filter model (ui-parity-contract.md §2 "Filtering model").
// Pure — unit tested. Four column filters (Type / Status / Priority /
// Assignee); a filter with zero checked options = no constraint; dropdown
// options cascade from rows passing all *other* filters.

import type { JiraIssue } from '../types';

export type MyWorkFilterKey = 'type' | 'status' | 'priority' | 'assignee';

export const MY_WORK_FILTER_KEYS: MyWorkFilterKey[] = ['type', 'status', 'priority', 'assignee'];

/** Checked option names per column (empty array = no constraint). */
export type MyWorkFilters = Record<MyWorkFilterKey, string[]>;

export function emptyMyWorkFilters(): MyWorkFilters {
  return { type: [], status: [], priority: [], assignee: [] };
}

type FilterableRow = Pick<JiraIssue, 'key' | 'summary' | 'issueType' | 'status' | 'priority' | 'assignee'>;

/** The row's display value for a filter column ('' when unset). */
export function rowValue(row: FilterableRow, key: MyWorkFilterKey): string {
  switch (key) {
    case 'type':
      return row.issueType ?? '';
    case 'status':
      return row.status ?? '';
    case 'priority':
      return row.priority ?? '';
    case 'assignee':
      return row.assignee ?? '';
  }
}

function checkedSet(filters: MyWorkFilters, key: MyWorkFilterKey): Set<string> {
  return new Set(filters[key].map((v) => v.toLowerCase()));
}

/**
 * Row passes every column filter (optionally ignoring one — the cascade's
 * "exclude own constraint"). Empty checked set = matches all.
 */
export function matchesFilters(
  row: FilterableRow,
  filters: MyWorkFilters,
  excludeKey?: MyWorkFilterKey,
): boolean {
  for (const key of MY_WORK_FILTER_KEYS) {
    if (key === excludeKey) continue;
    if (filters[key].length === 0) continue;
    if (!checkedSet(filters, key).has(rowValue(row, key).toLowerCase())) return false;
  }
  return true;
}

/**
 * Distinct option names for one dropdown, rebuilt from rows passing all
 * *other* filters (§16 gotcha 6). Sorted ci; blanks dropped.
 */
export function buildOptions(
  rows: readonly FilterableRow[],
  filters: MyWorkFilters,
  excludeKey: MyWorkFilterKey,
): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!matchesFilters(row, filters, excludeKey)) continue;
    const value = rowValue(row, excludeKey);
    if (!value) continue;
    const lower = value.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Free-text filter: Key OR Summary case-insensitive substring. */
export function matchesFreeText(row: Pick<JiraIssue, 'key' | 'summary'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (row.key ?? '').toLowerCase().includes(q) || (row.summary ?? '').toLowerCase().includes(q)
  );
}

/** View = free-text AND all four column filters. */
export function filterRows<T extends FilterableRow>(
  rows: readonly T[],
  filters: MyWorkFilters,
  freeText: string,
): T[] {
  return rows.filter((r) => matchesFreeText(r, freeText) && matchesFilters(r, filters));
}
