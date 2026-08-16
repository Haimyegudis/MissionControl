// /api/reminders — alerts & reminders config (GET current, PUT apply) plus
// GET /alert-summary consumed by the generated toast scripts for live counts.
// Applying writes reminders.json and creates/removes Windows scheduled tasks,
// so toasts fire even when the app and server are closed.

import { Router } from 'express';
import { applyReminderConfig, loadReminderConfig } from '../reminders.js';
import { defaultProjectKey, h, HttpError, qstr, type AppDeps } from './deps.js';

const SUMMARY_TYPES: Record<string, string> = {
  // Exact status, not statusCategory — the category lumps In Review (and
  // other in-flight statuses) into "In Progress", inflating the count.
  inProgress: 'status = "In Progress"',
  todo: 'statusCategory = "To Do"',
};

export function reminderRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(loadReminderConfig());
  });

  router.put('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { config, error } = applyReminderConfig(body);
    if (error) {
      res.status(500).json({ ...config, error });
      return;
    }
    res.json(config);
  });

  // Live summary for the dynamic toasts: { count, lines: ["KEY — summary"] }.
  router.get(
    '/alert-summary',
    h(async (req, res) => {
      const type = qstr(req.query.type) ?? '';
      const statusClause = SUMMARY_TYPES[type];
      if (!statusClause) throw new HttpError(400, `Invalid type: ${type}`);
      if (!deps.session.isConnected) throw new HttpError(503, 'Not connected to Jira');

      const project = defaultProjectKey(deps);
      const jql =
        `project = ${project} AND assignee = currentUser() AND sprint in openSprints()` +
        ` AND ${statusClause} ORDER BY priority DESC, updated DESC`;
      const page = await deps.issues.searchIssues(jql, 0, 10);
      res.json({
        count: page.total,
        lines: page.items.map((i) => {
          const summary = i.summary.length > 60 ? `${i.summary.slice(0, 57)}...` : i.summary;
          return `${i.key} — ${summary}`;
        }),
      });
    }),
  );

  return router;
}
