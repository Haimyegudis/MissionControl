// Express app factory (Task A7). All wiring is injected via AppDeps so tests
// can pass plain mock objects; main.ts builds the real composition root.

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { JiraError } from '@mc/core';
import { authRoutes } from './routes/auth.js';
import { boardRoutes, pinnedBoardRoutes } from './routes/boards.js';
import { createRoutes } from './routes/create.js';
import { dashboardSnapshotRoutes, dashboardsRoutes } from './routes/dashboards.js';
import { HttpError, type AppDeps } from './routes/deps.js';
import { filterRoutes } from './routes/filters.js';
import { incidentRoutes } from './routes/incidents.js';
import { issueRoutes } from './routes/issues.js';
import { lumoRoutes } from './routes/lumo.js';
import { metadataRoutes, miscRoutes } from './routes/misc.js';
import { settingsRoutes } from './routes/settings.js';
import { teamRoutes } from './routes/teams.js';
import { testrailRoutes } from './routes/testrail.js';
import { timeloggedRoutes } from './routes/timelogged.js';
import { confluenceRoutes } from './routes/confluence.js';
import { reminderRoutes } from './routes/reminders.js';
import { copilotAuthRoutes } from './routes/copilotAuth.js';
import { securityMiddleware } from './security.js';

export type { AppDeps } from './routes/deps.js';

/**
 * Map any thrown error to the wire shape `{status, message}`.
 * JiraError keeps its upstream status (401 passes through so the client can
 * drop to the login page); "No active Jira session." reads as 401 too.
 */
export function translateError(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err instanceof JiraError) {
    const status = err.status >= 400 && err.status <= 599 ? err.status : 502;
    return { status, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'No active Jira session.') return { status: 401, message };
  // body-parser & friends attach statusCode/status to their errors.
  const anyErr = err as { status?: unknown; statusCode?: unknown };
  const attached =
    typeof anyErr?.statusCode === 'number'
      ? anyErr.statusCode
      : typeof anyErr?.status === 'number'
        ? anyErr.status
        : null;
  if (attached !== null && attached >= 400 && attached <= 599) {
    return { status: attached, message };
  }
  return { status: 500, message: message || 'Internal server error' };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Host/Origin allow-list + per-install API token (empty token in tests
  // keeps the auth check off while Host/Origin still apply).
  app.use(securityMiddleware(deps.apiToken ?? '', { apiPort: deps.apiPort }));
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.use('/auth', authRoutes(deps));
  api.use('/issues', issueRoutes(deps));
  api.use('/boards', boardRoutes(deps));
  api.use('/pinned-boards', pinnedBoardRoutes(deps));
  api.use('/dashboard', dashboardSnapshotRoutes(deps));
  api.use('/dashboards', dashboardsRoutes(deps));
  api.use('/timelogged', timeloggedRoutes(deps));
  api.use('/incidents', incidentRoutes(deps));
  api.use('/settings', settingsRoutes(deps));
  api.use('/filters', filterRoutes(deps));
  api.use('/teams', teamRoutes(deps));
  api.use('/create', createRoutes(deps));
  api.use('/metadata', metadataRoutes(deps));
  api.use('/misc', miscRoutes(deps));
  api.use('/lumo', lumoRoutes(deps));
  api.use('/testrail', testrailRoutes(deps));
  api.use('/confluence', confluenceRoutes(deps));
  api.use('/reminders', reminderRoutes(deps));
  api.use('/copilot', copilotAuthRoutes());
  api.use((req: Request, res: Response) => {
    res.status(404).json({ status: 404, message: `Not found: ${req.method} /api${req.path}` });
  });
  app.use('/api', api);

  // Static SPA (client/dist) + fallback: any non-/api GET serves index.html.
  const staticDir = deps.staticDir;
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    const indexHtml = path.join(staticDir, 'index.html');
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- express requires 4 args
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = translateError(err);
    deps.log?.(`api error ${status}: ${message}`);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({ status, message });
  });

  return app;
}
