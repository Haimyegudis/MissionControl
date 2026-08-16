// /api/metadata (lists, users, versions, components, distinct, suggestions)
// + /api/misc/attachment-proxy (Task A7).

import { Router } from 'express';
import { Readable } from 'node:stream';
import { normalizeBaseUrl } from '../jira/httpClient.js';
import type { JiraUser } from '../types.js';
import { defaultProjectKey, h, HttpError, qstr, requireString, type AppDeps } from './deps.js';

/** The client consumes JiraUser[]; DC assignable-user search yields names. */
function toJiraUser(displayName: string): JiraUser {
  return { accountId: '', displayName, emailAddress: null, avatarUrl: null, active: true };
}

export function metadataRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get('/projects', h(async (_req, res) => res.json(await deps.metadata.getProjects())));
  router.get('/issuetypes', h(async (_req, res) => res.json(await deps.metadata.getIssueTypes())));
  router.get('/statuses', h(async (_req, res) => res.json(await deps.metadata.getStatuses())));
  router.get('/status-map', h(async (_req, res) => res.json(await deps.metadata.getStatusMap())));
  router.get('/priorities', h(async (_req, res) => res.json(await deps.metadata.getPriorities())));
  router.get('/resolutions', h(async (_req, res) => res.json(await deps.metadata.getResolutions())));
  router.get('/fields', h(async (_req, res) => res.json(await deps.metadata.getFields())));

  router.get(
    '/users',
    h(async (req, res) => {
      const project = qstr(req.query.project) ?? defaultProjectKey(deps);
      const names = await deps.metadata.getAssignableUsers(project);
      res.json(names.map(toJiraUser));
    }),
  );

  router.get(
    '/versions',
    h(async (req, res) => {
      res.json(await deps.metadata.getVersions(qstr(req.query.project) ?? defaultProjectKey(deps)));
    }),
  );

  router.get(
    '/components',
    h(async (req, res) => {
      res.json(await deps.metadata.getComponents(qstr(req.query.project) ?? defaultProjectKey(deps)));
    }),
  );

  router.get(
    '/distinct',
    h(async (req, res) => {
      const project = qstr(req.query.project) ?? defaultProjectKey(deps);
      // project is interpolated unquoted into JQL — key charset only.
      if (!/^[A-Z][A-Z0-9_]*$/i.test(project)) throw new HttpError(400, `Invalid project key: ${project}`);
      const field = requireString(qstr(req.query.field), 'field');
      const rawMax = Number(qstr(req.query.max));
      const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 5000;
      res.json(await deps.getDistinct(project, field, max));
    }),
  );

  router.get(
    '/suggestions',
    h(async (req, res) => {
      const field = requireString(qstr(req.query.field), 'field');
      res.json(await deps.metadata.getFieldSuggestions(field, qstr(req.query.query) ?? null));
    }),
  );

  return router;
}

export function miscRoutes(deps: AppDeps): Router {
  const router = Router();

  // Streams a Jira-hosted attachment with the session auth header injected.
  // Only URLs on the Jira base host are allowed (403 otherwise).
  router.get(
    '/attachment-proxy',
    h(async (req, res) => {
      const url = requireString(qstr(req.query.url), 'url');
      const profile = deps.session.profile;
      if (!profile || profile.jiraPat.trim().length === 0) {
        throw new HttpError(401, 'No active Jira session.');
      }

      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new HttpError(400, `Invalid attachment URL: ${url}`);
      }
      const jiraHost = new URL(normalizeBaseUrl(profile.jiraBaseUrl)).host;
      if (target.host !== jiraHost) {
        throw new HttpError(403, 'Attachment URL host does not match the Jira base URL.');
      }
      // The PAT rides on this request — never allow an http downgrade or a
      // redirect chain to carry it elsewhere.
      if (target.protocol !== 'https:') {
        throw new HttpError(400, 'Attachment URL must be https.');
      }

      const authorization =
        profile.instanceType === 'cloud'
          ? `Basic ${Buffer.from(`${profile.email}:${profile.jiraPat}`, 'utf8').toString('base64')}`
          : `Bearer ${profile.jiraPat}`;

      const fetchFn = deps.fetchFn ?? fetch;
      const upstream = await fetchFn(target, {
        headers: { Authorization: authorization },
        redirect: 'manual',
      });

      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      if (upstream.body) {
        Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
      } else {
        res.end();
      }
    }),
  );

  return router;
}
