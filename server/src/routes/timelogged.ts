// /api/timelogged — period, sprint and range reports (Task A7).

import { Router } from 'express';
import { jqlQuote } from '../jira/jqlEscape.js';
import type { TimeLoggedPeriod } from '../jira/timeLogged.js';
import { defaultProjectKey, h, HttpError, qstr, type AppDeps } from './deps.js';

const PERIODS: ReadonlySet<string> = new Set([
  'today',
  'yesterday',
  'thisWeek',
  'previousWeek',
  'thisMonth',
  'customRange',
]);

function parseDate(value: string | undefined, name: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Invalid date for ${name}: ${value}`);
  return d;
}

export function timeloggedRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    h(async (req, res) => {
      const period = qstr(req.query.period) ?? 'thisWeek';
      if (!PERIODS.has(period)) throw new HttpError(400, `Invalid period: ${period}`);
      const from = parseDate(qstr(req.query.from), 'from');
      const to = parseDate(qstr(req.query.to), 'to');

      // extraJql replaces the default JQL scope; ?user= composes the same
      // default scope pinned to that assignee (client sends one or the other).
      let extraJql = qstr(req.query.extraJql) ?? null;
      const user = qstr(req.query.user);
      if (!extraJql && user) {
        const project = defaultProjectKey(deps);
        extraJql =
          `project = ${project} AND sprint in openSprints() AND assignee = ${jqlQuote(user)}` +
          ' AND issuetype != Incident ORDER BY updated DESC';
      }

      res.json(await deps.timeLogged.buildReport(period as TimeLoggedPeriod, from, to, extraJql));
    }),
  );

  router.get(
    '/sprint',
    h(async (req, res) => {
      res.json(await deps.timeLogged.buildReportForSprint(qstr(req.query.name) ?? ''));
    }),
  );

  router.get(
    '/range',
    h(async (req, res) => {
      const from = parseDate(qstr(req.query.from), 'from');
      const to = parseDate(qstr(req.query.to), 'to');
      if (!from || !to) throw new HttpError(400, 'Both from and to are required.');
      res.json(await deps.timeLogged.buildReportForRange(from, to));
    }),
  );

  return router;
}
