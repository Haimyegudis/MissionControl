// JQL builder — port of MissionControl JqlBuilder + IncidentDashboardViewModel
// JQL assembly. docs/reference/jira-rest-layer.md §6.

import type { JiraFilterDefinition, JiraFilterSelection } from '../types.js';

export interface IncidentJql {
  main: string;
  verification: string;
  rejected: string;
}

/**
 * JqlBuilder's own quote variant — escapes `\` and `"` but does NOT strip
 * control characters (unlike jqlQuote / JqlEscape.Quote).
 */
export function quoteValue(v: string): string {
  if (!v) return '""';
  const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function joinValues(values: readonly string[]): string {
  return values.map(quoteValue).join(', ');
}

function buildDefault(field: string, values: readonly string[], multi: boolean): string {
  // Wrap the field name in double quotes so JQL accepts custom field labels
  // with spaces and weird casing; already-quoted names are kept as-is.
  const quoted = field.startsWith('"') ? field : `"${field}"`;
  if (values.length === 1 && !multi) return `${quoted} = ${quoteValue(values[0]!)}`;
  return `${quoted} in (${joinValues(values)})`;
}

function buildFragment(def: JiraFilterDefinition, sel: JiraFilterSelection): string {
  if (sel.values.length === 0 && def.controlType !== 'quickButton') return '';

  if (def.controlType === 'quickButton') {
    return def.jqlTemplate ?? ''; // verbatim; values ignored
  }

  if (!def.jqlTemplate) {
    if (!def.jiraFieldName) return '';
    return buildDefault(def.jiraFieldName, sel.values, def.supportsMultiSelect);
  }

  if (def.jqlTemplate.includes('{values}')) {
    return def.jqlTemplate.replaceAll('{values}', joinValues(sel.values));
  }
  if (def.jqlTemplate.includes('{value}')) {
    return def.jqlTemplate.replaceAll('{value}', quoteValue(sel.values[0] ?? ''));
  }
  return def.jqlTemplate;
}

/**
 * Combine metadata-driven filter selections into a single JQL string.
 * The project clause (when a default project key is given) comes first and is
 * intentionally unquoted/unescaped.
 */
export function buildFromFilters(
  definitions: readonly JiraFilterDefinition[],
  selections: readonly JiraFilterSelection[],
  defaultProjectKey: string | null | undefined,
): string {
  const defs = new Map<string, JiraFilterDefinition>();
  for (const d of definitions) defs.set(d.id.toLowerCase(), d);

  const clauses: string[] = [];
  if (defaultProjectKey && defaultProjectKey.trim().length > 0) {
    clauses.push(`project = ${defaultProjectKey}`);
  }

  for (const sel of selections) {
    const def = defs.get(sel.filterId.toLowerCase());
    if (!def) continue;
    const fragment = buildFragment(def, sel);
    if (fragment) clauses.push(fragment);
  }

  return clauses.join(' AND ');
}

/** Quote a list for `in (...)` — comma-joined, NO space, only `"` escaped. */
export function quoteList(values: readonly string[]): string {
  return values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');
}

/**
 * Extract a JQL person-scope clause from the active filter selections.
 * Honors reporter + assignee pickers and the "my issues" / "reported by me"
 * toggles. Returns null when no person filter is active.
 */
export function getReporterClause(selections: readonly JiraFilterSelection[]): string | null {
  const byId = new Map<string, JiraFilterSelection>();
  for (const s of selections) byId.set(s.filterId.toLowerCase(), s);

  const people: string[] = [];
  const seen = new Set<string>();
  const meAlias = byId.has('reported-by-me') || byId.has('my-issues');
  for (const id of ['reporter', 'assignee']) {
    const s = byId.get(id);
    if (!s) continue;
    for (const v of s.values) {
      if (v && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        people.push(v);
      }
    }
  }

  if (people.length === 0 && !meAlias) return null;
  const parts: string[] = [];
  if (meAlias) {
    parts.push('reporter = currentUser()');
    parts.push('assignee = currentUser()');
  }
  if (people.length > 0) {
    const quoted = quoteList(people);
    parts.push(`reporter in (${quoted})`);
    parts.push(`assignee in (${quoted})`);
  }
  return '(' + parts.join(' OR ') + ')';
}

/** Sticky Verification/Rejected panel JQL. */
export function buildStickyJql(
  project: string,
  status: string,
  reporterClause: string | null | undefined,
): string {
  let jql = `project = ${project} AND issuetype in (Incident, Bug, Defect) AND status = "${status}"`;
  if (reporterClause) jql += ` AND ${reporterClause}`;
  return jql + ' ORDER BY priority DESC, updated DESC';
}

const PERSON_FILTER_IDS = new Set(['reporter', 'assignee', 'reported-by-me', 'my-issues']);

/**
 * Incident dashboard JQL assembly (exact 6-step ordering):
 * 1. base = buildFromFilters without the person filters
 * 2. default issuetype scope when absent
 * 3. person clause (explicit selection or currentUser fallback)
 * 4. statusCategory != Done when no status mention/selection
 * 5. exclude sticky-panel statuses
 * 6. ORDER BY priority DESC, updated DESC
 */
export function buildIncidentJql(
  definitions: readonly JiraFilterDefinition[],
  selections: readonly JiraFilterSelection[],
  project: string,
): IncidentJql {
  const nonPersonSelections = selections.filter(
    (s) => !PERSON_FILTER_IDS.has(s.filterId.toLowerCase()),
  );

  let jql = buildFromFilters(definitions, nonPersonSelections, project);
  if (!jql.toLowerCase().includes('issuetype')) {
    jql += ' AND issuetype in (Incident, Bug, Defect)';
  }
  const personClause =
    getReporterClause(selections) ?? '(reporter = currentUser() OR assignee = currentUser())';
  jql += ` AND ${personClause}`;
  const hasStatusSelection = selections.some((s) => s.filterId.toLowerCase() === 'status');
  if (!jql.toLowerCase().includes('status') && !hasStatusSelection) {
    jql += ' AND statusCategory != Done';
  }
  // Rejected + Verification have dedicated sticky panels; hide from main grid.
  jql += ' AND status not in (Rejected, Verification)';
  jql += ' ORDER BY priority DESC, updated DESC';

  // Sticky panels respect an explicit person filter, otherwise default to "my" scope.
  const stickyClause =
    getReporterClause(selections) ?? '(reporter = currentUser() OR assignee = currentUser())';
  return {
    main: jql,
    verification: buildStickyJql(project, 'Verification', stickyClause),
    rejected: buildStickyJql(project, 'Rejected', stickyClause),
  };
}
