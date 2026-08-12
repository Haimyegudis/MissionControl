// /api/create — createmeta file cache, issue creation, per-type defaults
// (Task A7; storage-layer.md §4.2/§4.3).

import { Router } from 'express';
import type { CreateDefaultsEntry } from '../storage/fileStores.js';
import { h, HttpError, qstr, requireString, type AppDeps } from './deps.js';

/** Createmeta file-cache freshness: 14 days. */
export const CREATE_META_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
export const CREATE_META_TIMEOUT_MS = 15_000;
export const CREATE_META_TIMEOUT_MESSAGE =
  'Jira /createmeta did not respond within 15 seconds. Use "Open in Jira" to fall back to the web form.';

const TIMEOUT = Symbol('timeout');

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createRoutes(deps: AppDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.createMetaTimeoutMs ?? CREATE_META_TIMEOUT_MS;

  router.get(
    '/meta',
    h(async (req, res) => {
      const project = requireString(qstr(req.query.project), 'project');
      const type = requireString(qstr(req.query.type), 'type');
      const key = `${project}:${type}`;

      const entry = deps.createMetaCache.load(key);
      const fresh =
        entry !== null &&
        entry.meta !== null &&
        entry.meta.fields.length > 0 &&
        now().getTime() - entry.savedUtc.getTime() < CREATE_META_FRESH_MS;
      if (fresh && entry?.meta) {
        res.json(entry.meta);
        return;
      }

      const result = await withTimeout(deps.createIssues.getCreateMeta(project, type), timeoutMs);
      if (result === TIMEOUT) {
        // Stale cache beats a timeout; no cache at all → 504 with guidance.
        if (entry?.meta) {
          res.json(entry.meta);
          return;
        }
        throw new HttpError(504, CREATE_META_TIMEOUT_MESSAGE);
      }

      if (result.fields.length > 0) deps.createMetaCache.save(key, result);
      res.json(result);
    }),
  );

  router.post(
    '/issue',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const project = requireString(body.project, 'project');
      const type = requireString(body.type, 'type');
      const fields =
        body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
          ? (body.fields as Record<string, unknown>)
          : {};
      const key = await deps.createIssues.createIssue(project, type, fields);
      res.json({ key });
    }),
  );

  router.get(
    '/defaults',
    h((req, res) => {
      const key = requireString(qstr(req.query.key), 'key');
      res.json(deps.createDefaults.load(key) ?? {});
    }),
  );

  router.put(
    '/defaults',
    h((req, res) => {
      const key = requireString(qstr(req.query.key), 'key');
      const body = (req.body ?? {}) as CreateDefaultsEntry;
      deps.createDefaults.save(key, body);
      res.status(204).end();
    }),
  );

  router.delete(
    '/defaults',
    h((req, res) => {
      const key = requireString(qstr(req.query.key), 'key');
      deps.createDefaults.clear(key);
      res.status(204).end();
    }),
  );

  return router;
}
