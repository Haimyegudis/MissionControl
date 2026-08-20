// /api/filters — saved JQL filters (Task A7).

import { Router } from 'express';
import type { SavedFilter } from '@mc/core';
import { h, requireString, type AppDeps } from './deps.js';

export function filterRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    h((_req, res) => {
      res.json(deps.repos.savedFilters.getAll());
    }),
  );

  router.post(
    '/',
    h((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const filter: SavedFilter = {
        id: typeof body.id === 'string' ? body.id : '',
        name: requireString(body.name, 'name'),
        description: typeof body.description === 'string' ? body.description : null,
        jql: requireString(body.jql, 'jql'),
        isFavorite: body.isFavorite === true,
        created: typeof body.created === 'string' ? body.created : '',
        lastUsed: typeof body.lastUsed === 'string' ? body.lastUsed : null,
      };
      res.json(deps.repos.savedFilters.upsert(filter));
    }),
  );

  router.delete(
    '/:id',
    h((req, res) => {
      deps.repos.savedFilters.delete(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
