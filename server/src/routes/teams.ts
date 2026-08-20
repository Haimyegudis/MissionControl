// /api/teams — team CRUD (Task A7).

import { Router } from 'express';
import type { Team } from '@mc/core';
import { h, requireString, type AppDeps } from './deps.js';

export function teamRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    h((_req, res) => {
      res.json(deps.repos.teams.getAll());
    }),
  );

  router.post(
    '/',
    h((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const team: Team = {
        id: typeof body.id === 'string' ? body.id : '',
        name: requireString(body.name, 'name'),
        members: Array.isArray(body.members)
          ? body.members.filter((m): m is string => typeof m === 'string')
          : [],
      };
      res.json(deps.repos.teams.upsert(team));
    }),
  );

  router.delete(
    '/:id',
    h((req, res) => {
      deps.repos.teams.delete(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
