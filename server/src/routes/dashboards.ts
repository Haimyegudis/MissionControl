// /api/dashboard/snapshot (KPI aggregator) + /api/dashboards (Jira dashboards).

import { Router } from 'express';
import type { DashboardSnapshot } from '../types.js';
import { h, qstr, type AppDeps } from './deps.js';

/** The snapshot is the most expensive call in the app and the client can
 *  tick it every 15s — serve a 60s in-memory copy; shared in-flight promise
 *  prevents a stampede. `?fresh=1` bypasses. */
const SNAPSHOT_TTL_MS = 60_000;

export function dashboardSnapshotRoutes(deps: AppDeps): Router {
  const router = Router();
  let cached: { at: number; snap: DashboardSnapshot } | null = null;
  let inflight: Promise<DashboardSnapshot> | null = null;

  router.get(
    '/snapshot',
    h(async (req, res) => {
      const fresh = qstr(req.query.fresh) === '1';
      if (!fresh && cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) {
        res.json(cached.snap);
        return;
      }
      if (!inflight) {
        inflight = deps.aggregator
          .buildDashboardSnapshot()
          .then((snap) => {
            cached = { at: Date.now(), snap };
            return snap;
          })
          .finally(() => {
            inflight = null;
          });
      }
      res.json(await inflight);
    }),
  );

  return router;
}

export function dashboardsRoutes(deps: AppDeps): Router {
  const router = Router();
  let listCache: { at: number; list: unknown } | null = null;

  router.get(
    '/',
    h(async (req, res) => {
      const fresh = qstr(req.query.fresh) === '1';
      if (!fresh && listCache && Date.now() - listCache.at < 10 * 60_000) {
        res.json(listCache.list);
        return;
      }
      const list = await deps.dashboards.getDashboards();
      listCache = { at: Date.now(), list };
      res.json(list);
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
