// /api/incidents — dashboard search, filter catalog, dropdown option
// resolution (Task A7; ui-parity-contract.md §3).

import { Router } from 'express';
import { INCIDENT_FILTERS } from '../jira/incidentCatalog.js';
import { buildIncidentJql } from '../jira/jqlBuilder.js';
import type { JiraFilterSelection } from '../types.js';
import { defaultProjectKey, h, HttpError, type AppDeps } from './deps.js';

const INCIDENT_MAX_RESULTS = 200;
const DISTINCT_MAX = 5000;

const PEOPLE_FIELDS = new Set(['assignee', 'reporter', 'primary developer', 'primary tester']);
const VERSION_FIELDS = new Set([
  'fixversion',
  'fix version/s',
  'affectedversion',
  'affects version',
  'affects version/s',
]);
const COMPONENT_FIELDS = new Set(['components', 'component']);

/** C# `.Trim('"')` — strip all leading/trailing double quotes. */
function stripQuotes(s: string): string {
  return s.replace(/^"+/, '').replace(/"+$/, '');
}

function parseSelections(raw: unknown): JiraFilterSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: JiraFilterSelection[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const filterId = (el as Record<string, unknown>).filterId;
    const values = (el as Record<string, unknown>).values;
    if (typeof filterId !== 'string' || filterId.length === 0) continue;
    out.push({
      filterId,
      values: Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [],
    });
  }
  return out;
}

export function incidentRoutes(deps: AppDeps): Router {
  const router = Router();

  // Summary search stays client-side (ui-parity §3); the body's summarySearch
  // is accepted and ignored. Three parallel searches, maxResults 200 each.
  router.post(
    '/search',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const selections = parseSelections(body.selections);
      const jql = buildIncidentJql(INCIDENT_FILTERS, selections, defaultProjectKey(deps));
      const [all, verification, rejected] = await Promise.all([
        deps.issues.searchIssues(jql.main, 0, INCIDENT_MAX_RESULTS),
        deps.issues.searchIssues(jql.verification, 0, INCIDENT_MAX_RESULTS),
        deps.issues.searchIssues(jql.rejected, 0, INCIDENT_MAX_RESULTS),
      ]);
      res.json({ all: all.items, verification: verification.items, rejected: rejected.items });
    }),
  );

  router.get(
    '/definitions',
    h((_req, res) => {
      res.json(INCIDENT_FILTERS);
    }),
  );

  // Dropdown option resolution per ui-parity §3 table. The client consumes a
  // plain string[]; the source-endpoint description is logged server-side.
  router.get(
    '/filter-options/:filterId',
    h(async (req, res) => {
      const filterId = req.params.filterId;
      const def = INCIDENT_FILTERS.find((f) => f.id.toLowerCase() === filterId.toLowerCase());
      if (!def) throw new HttpError(404, `Unknown incident filter: ${filterId}`);

      const field = stripQuotes((def.jiraFieldName ?? def.displayName).trim());
      const lower = field.toLowerCase();
      const project = defaultProjectKey(deps);

      let options: string[];
      let source: string;
      if (PEOPLE_FIELDS.has(lower)) {
        options = await deps.getDistinct(project, field, DISTINCT_MAX);
        source = `distinct issue field "${field}" (max ${DISTINCT_MAX})`;
      } else if (VERSION_FIELDS.has(lower)) {
        options = await deps.getDistinct(project, field, DISTINCT_MAX);
        source = `distinct issue field "${field}"`;
        if (options.length === 0) {
          options = await deps.metadata.getVersions(project);
          source = `project versions (${project})`;
        }
      } else if (COMPONENT_FIELDS.has(lower)) {
        options = await deps.getDistinct(project, field, DISTINCT_MAX);
        source = `distinct issue field "${field}"`;
        if (options.length === 0) {
          options = await deps.metadata.getComponents(project);
          source = `project components (${project})`;
        }
      } else if (lower === 'priority') {
        options = await deps.metadata.getPriorities();
        source = 'metadata priorities';
      } else if (lower === 'status') {
        options = await deps.metadata.getStatuses();
        source = 'metadata statuses';
      } else if (lower === 'issuetype') {
        options = await deps.metadata.getIssueTypes();
        source = 'metadata issue types';
      } else {
        options = await deps.getDistinct(project, field, DISTINCT_MAX);
        source = `distinct issue field "${field}" (max ${DISTINCT_MAX})`;
        if (options.length === 0) {
          options = await deps.metadata.getFieldSuggestions(field);
          source = `field suggestions ("${field}")`;
        }
      }

      deps.log?.(`incidents/filter-options/${def.id}: ${options.length} options via ${source}`);
      res.json(options);
    }),
  );

  return router;
}
