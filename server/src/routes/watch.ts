// /api/watch — dashboard change feed. GET the feed, POST an ack, GET/PUT the
// config, POST a forced cycle. Config sanitization happens in @mc/core so the
// Android dispatcher applies the identical rules.

import { Router } from 'express';
import { h, type AppDeps } from './deps.js';

export function watchRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get('/feed', (_req, res) => {
    res.json(deps.watch.feed());
  });

  router.post('/ack', (_req, res) => {
    deps.watch.ack();
    res.json(deps.watch.feed());
  });

  router.post('/clear', (_req, res) => {
    deps.watch.clearFeed();
    res.json(deps.watch.feed());
  });

  router.get('/config', (_req, res) => {
    res.json(deps.watch.getConfig());
  });

  router.put('/config', (req, res) => {
    res.json(deps.watch.setConfig(req.body ?? {}));
  });

  // Forced cycle. A Jira failure here is the user's answer to "check now", so
  // unlike the timer it is reported rather than swallowed.
  router.post(
    '/run',
    h(async (_req, res) => {
      const events = await deps.watch.runCycle();
      res.json({ count: events.length, ...deps.watch.feed() });
    }),
  );

  return router;
}
