// Incidents view pure logic (ui-parity-contract.md §3) — persisted-selection
// JSON handling, selection → server payload, active-filter counting, saved
// value injection and the client-side summary re-slice. Pure — unit tested.

import type { JiraFilterDefinition, JiraFilterSelection, JiraIssue } from '../types';

/** filterId → selected values. Quick pills persist with an empty array. */
export type IncidentSelections = Record<string, string[]>;

/** Parse settings.incidentFiltersJson ({filterId: string[]}); {} on bad data. */
export function parseIncidentFilters(json: string | null | undefined): IncidentSelections {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: IncidentSelections = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!key) continue;
      out[key] = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeIncidentFilters(selections: IncidentSelections): string {
  return JSON.stringify(selections);
}

/** Selections in the POST /api/incidents/search body shape. */
export function toSelectionList(selections: IncidentSelections): JiraFilterSelection[] {
  return Object.entries(selections).map(([filterId, values]) => ({ filterId, values }));
}

/**
 * Active filter count for the header pill: a quick pill counts when present
 * (its values are ignored by the server); a dropdown counts when it has at
 * least one checked value.
 */
export function activeFilterCount(
  selections: IncidentSelections,
  definitions: readonly JiraFilterDefinition[],
): number {
  const quickIds = new Set(definitions.filter((d) => d.isQuickFilter).map((d) => d.id.toLowerCase()));
  let n = 0;
  for (const [id, values] of Object.entries(selections)) {
    if (quickIds.has(id.toLowerCase()) || values.length > 0) n++;
  }
  return n;
}

/** Client-side summary search: Summary OR Key case-insensitive substring. */
export function summaryMatches(issue: Pick<JiraIssue, 'key' | 'summary'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (issue.summary ?? '').toLowerCase().includes(q) || (issue.key ?? '').toLowerCase().includes(q)
  );
}

/** Re-slice a result list through the summary search box. */
export function sliceBySummary<T extends Pick<JiraIssue, 'key' | 'summary'>>(
  issues: readonly T[],
  query: string,
): T[] {
  return issues.filter((i) => summaryMatches(i, query));
}

/**
 * Inject saved (restored) values missing from the fetched option list so a
 * persisted selection is never silently dropped (§3 Persistence). Keeps the
 * fetched order; missing saved values append at the end.
 */
export function mergeSavedIntoOptions(options: readonly string[], saved: readonly string[]): string[] {
  const seen = new Set(options.map((o) => o.toLowerCase()));
  const out = [...options];
  for (const value of saved) {
    if (!value) continue;
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
  }
  return out;
}
