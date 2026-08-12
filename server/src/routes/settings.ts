// /api/settings — AppSettings load/merge/save + cache maintenance (Task A7).

import { Router } from 'express';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../types.js';
import { h, type AppDeps } from './deps.js';

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_APP_SETTINGS));

export function settingsRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    h((_req, res) => {
      res.json(deps.repos.appSettings.get());
    }),
  );

  // Load-then-merge-then-save: only known AppSettings keys are applied.
  router.put(
    '/',
    h((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const merged = { ...deps.repos.appSettings.get() } as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        if (KNOWN_KEYS.has(key) && value !== undefined) merged[key] = value;
      }
      const settings = merged as unknown as AppSettings;
      deps.repos.appSettings.save(settings);
      res.json(settings);
    }),
  );

  router.post(
    '/clear-issue-cache',
    h((_req, res) => {
      deps.repos.issueCache.clearAll();
      res.status(204).end();
    }),
  );

  router.post(
    '/hard-refresh',
    h((_req, res) => {
      deps.repos.issueCache.clearAll();
      deps.repos.metadataCache.clearAll();
      deps.createMetaCache.clearAll();
      deps.issues.resetFieldCache();
      res.status(204).end();
    }),
  );

  return router;
}
