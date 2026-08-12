// /api/dashboard/snapshot (KPI aggregator) + /api/dashboards (Jira dashboards).

import { Router } from 'express';
import { h, type AppDeps } from './deps.js';

export function dashboardSnapshotRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/snapshot',
    h(async (_req, res) => {
      res.json(await deps.aggregator.buildDashboardSnapshot());
    }),
  );

  return router;
}

export function dashboardsRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    h(async (_req, res) => {
      res.json(await deps.dashboards.getDashboards());
    }),
  );

  router.get(
    '/:id',
    h(async (req, res) => {
      res.json(await deps.dashboards.getDashboardDetails(req.params.id));
    }),
  );

  return router;
}
