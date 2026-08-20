// /api/settings — AppSettings load/merge/save + cache maintenance (Task A7).

import { Router } from 'express';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@mc/core';
import { h, HttpError, type AppDeps } from './deps.js';

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_APP_SETTINGS));

/** mcpServerEnv may hold user-entered tokens — never echo the values. */
function redacted(settings: AppSettings): AppSettings {
  const env = settings.mcpServerEnv ?? {};
  const masked = Object.fromEntries(Object.keys(env).map((k) => [k, '•••']));
  return { ...settings, mcpServerEnv: masked };
}

export function settingsRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/connection-health',
    h(async (_req, res) => {
      const saved = deps.credentials.load();
      const check = async (name: string, configured: boolean, probe: () => Promise<unknown>) => {
        if (!configured) return { name, configured: false, ok: false, latencyMs: null, message: 'Not configured' };
        const started = Date.now();
        try {
          await probe();
          return { name, configured: true, ok: true, latencyMs: Date.now() - started, message: 'Connected' };
        } catch (error) {
          return { name, configured: true, ok: false, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) };
        }
      };
      const [jira, testRail, confluence] = await Promise.all([
        check('Jira', Boolean(saved?.jiraPat), () => deps.testConnection(saved!)),
        check('TestRail', Boolean(saved?.testRailApiKey), () => deps.testrail.requireClient().getCurrentUser()),
        check('Confluence', Boolean(saved?.confluencePat), () => deps.confluence!.test({ baseUrl: saved!.confluenceBaseUrl, pat: saved!.confluencePat })),
      ]);
      res.json({ checkedAt: new Date().toISOString(), services: [jira, testRail, confluence] });
    }),
  );

  router.get(
    '/',
    h((_req, res) => {
      res.json(redacted(deps.repos.appSettings.get()));
    }),
  );

  // Load-then-merge-then-save: only known AppSettings keys are applied.
  router.put(
    '/',
    h((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const merged = { ...deps.repos.appSettings.get() } as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        if (!KNOWN_KEYS.has(key) || value === undefined) continue;
        // defaultProjectKey is interpolated unquoted into JQL all over — keep
        // it a plain Jira project key.
        if (key === 'defaultProjectKey') {
          const v = String(value).trim().toUpperCase();
          if (!/^[A-Z][A-Z0-9_]*$/.test(v)) throw new HttpError(400, `Invalid project key: ${String(value)}`);
          merged[key] = v;
          continue;
        }
        // Round-trip guard: masked env values from GET must not clobber the
        // stored secrets.
        if (key === 'mcpServerEnv' && value !== null && typeof value === 'object') {
          const prev = (merged.mcpServerEnv ?? {}) as Record<string, string>;
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            next[k] = String(v) === '•••' ? (prev[k] ?? '') : String(v);
          }
          merged[key] = next;
          continue;
        }
        merged[key] = value;
      }
      const settings = merged as unknown as AppSettings;
      deps.repos.appSettings.save(settings);
      res.json(redacted(settings));
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

  router.post(
    '/clear-caches',
    h((_req, res) => {
      deps.repos.issueCache.clearAll();
      deps.repos.metadataCache.clearAll();
      deps.createMetaCache.clearAll();
      deps.testrail.clearCache();
      deps.issues.resetFieldCache();
      res.status(204).end();
    }),
  );

  router.post(
    '/disconnect-all',
    h((req, res) => {
      const confirmation = String((req.body as Record<string, unknown> | undefined)?.confirmation ?? '');
      if (confirmation !== 'DISCONNECT') throw new HttpError(400, 'Confirmation must be DISCONNECT.');
      deps.credentials.clear();
      deps.session.clear();
      deps.testrail.disconnect();
      deps.confluence?.disconnect();
      res.status(204).end();
    }),
  );

  return router;
}
