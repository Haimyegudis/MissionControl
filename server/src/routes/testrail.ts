// /api/testrail — session, cached reference data, case/section/run CRUD,
// prefetch, people (Phase 2 — unified-deck plan T10). Mirrors the standalone
// TestRailWeb API surface (C:\APPS\TestRailWeb\Program.cs): cached GETs honor
// `?fresh=1`; TestRailApiError surfaces as a structured 502; a missing session
// reads as 401.

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Credentials } from '../config/credentialsStore.js';
import { TestRailApiError } from '../testrail/httpClient.js';
import { TestRailNotConnectedError } from '../testrail/service.js';
import type { TrAddCasePayload } from '../testrail/types.js';
import { h, qstr, requireString, HttpError, type AppDeps } from './deps.js';

/** `?fresh=1` (or `true`) bypasses the cache and re-fills it. */
function freshFlag(req: Request): boolean {
  const value = qstr(req.query.fresh);
  return value === '1' || value === 'true';
}

/** Required integer path/body value or 400. */
function requireInt(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(n)) throw new HttpError(400, `Missing or invalid parameter: ${name}`);
  return n;
}

/** Optional integer (query/body) — null when absent or unparsable. */
function optInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(n) ? n : null;
}

function optStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function intArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => optInt(v)).filter((n): n is number => n !== null);
}

function casePayload(body: Record<string, unknown>): TrAddCasePayload {
  return {
    title: requireString(body.title, 'title'),
    typeId: optInt(body.typeId),
    priorityId: optInt(body.priorityId),
    estimate: optStr(body.estimate),
    refs: optStr(body.refs),
    description: optStr(body.description),
    preconds: optStr(body.preconds),
    steps: optStr(body.steps),
    expected: optStr(body.expected),
    ownerId: optInt(body.ownerId),
  };
}

function emptyCredentials(): Credentials {
  return {
    email: '',
    jiraBaseUrl: '',
    jiraPat: '',
    instanceType: 'datacenter',
    defaultProjectKey: 'ISW',
    testRailBaseUrl: '',
    testRailEmail: '',
    testRailApiKey: '',
    confluenceBaseUrl: '',
    confluencePat: '',
  };
}

export function testrailRoutes(deps: AppDeps): Router {
  const router = Router();
  const service = deps.testrail;

  // ---- Session ----

  router.get(
    '/session',
    h((_req, res) => {
      res.json(service.status());
    }),
  );

  router.post(
    '/session',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Fixed HP TestRail endpoint — the Settings UI no longer sends a
      // baseUrl; explicit values (older clients, saved configs) still win.
      const baseUrl =
        typeof body.baseUrl === 'string' && body.baseUrl.trim()
          ? body.baseUrl
          : 'https://hp-testrail.external.hp.com';
      const email = requireString(body.email, 'email');
      const apiKey = requireString(body.apiKey, 'apiKey');
      const user = await service.connect({ baseUrl, email, apiKey });
      const saved = deps.credentials.load() ?? emptyCredentials();
      deps.credentials.save({
        ...saved,
        testRailBaseUrl: baseUrl,
        testRailEmail: email,
        testRailApiKey: apiKey,
      });
      res.json({ connected: true, user });
    }),
  );

  router.delete(
    '/session',
    h((_req, res) => {
      service.disconnect();
      const saved = deps.credentials.load();
      if (saved) {
        deps.credentials.save({ ...saved, testRailBaseUrl: '', testRailEmail: '', testRailApiKey: '' });
      }
      res.status(204).end();
    }),
  );

  // ---- Reference data ----

  router.get(
    '/meta',
    h(async (req, res) => {
      const projectId = optInt(qstr(req.query.projectId));
      const key = `meta:${projectId ?? ''}`;
      res.json(await service.cachedJson(key, () => service.fetchMeta(projectId), freshFlag(req)));
    }),
  );

  router.get(
    '/projects',
    h(async (req, res) => {
      res.json(
        await service.cachedJson('projects', () => service.requireClient().getProjects(), freshFlag(req)),
      );
    }),
  );

  // ---- Suites / sections / cases ----

  router.get(
    '/projects/:id/suites',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      res.json(
        await service.cachedJson(`suites:${pid}`, () => service.requireClient().getSuites(pid), freshFlag(req)),
      );
    }),
  );

  router.get(
    '/projects/:id/sections',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      const suiteId = optInt(qstr(req.query.suiteId));
      res.json(
        await service.cachedJson(
          `sections:${pid}:${suiteId ?? ''}`,
          () => service.requireClient().getSections(pid, suiteId),
          freshFlag(req),
        ),
      );
    }),
  );

  router.get(
    '/projects/:id/cases',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      const suiteId = optInt(qstr(req.query.suiteId));
      const sectionId = optInt(qstr(req.query.sectionId));
      res.json(
        await service.cachedJson(
          `cases:${pid}:${suiteId ?? ''}:${sectionId ?? ''}`,
          () => service.requireClient().getCases(pid, suiteId, sectionId),
          freshFlag(req),
        ),
      );
    }),
  );

  router.post(
    '/projects/:id/sections',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(
        await service.requireClient().addSection(pid, {
          suiteId: optInt(body.suiteId),
          parentId: optInt(body.parentId),
          name: requireString(body.name, 'name'),
          description: optStr(body.description),
        }),
      );
    }),
  );

  router.put(
    '/sections/:id',
    h(async (req, res) => {
      const sectionId = requireInt(req.params.id, 'sectionId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(
        await service
          .requireClient()
          .updateSection(sectionId, requireString(body.name, 'name'), optStr(body.description)),
      );
    }),
  );

  router.delete(
    '/sections/:id',
    h(async (req, res) => {
      await service.requireClient().deleteSection(requireInt(req.params.id, 'sectionId'));
      res.status(204).end();
    }),
  );

  router.post(
    '/sections/:id/move',
    h(async (req, res) => {
      const sectionId = requireInt(req.params.id, 'sectionId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      await service.requireClient().moveSection(sectionId, optInt(body.parentId), optInt(body.afterId));
      res.status(204).end();
    }),
  );

  router.post(
    '/sections/:id/cases',
    h(async (req, res) => {
      const sectionId = requireInt(req.params.id, 'sectionId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await service.requireClient().addCase(sectionId, casePayload(body)));
    }),
  );

  router.put(
    '/cases/:id',
    h(async (req, res) => {
      const caseId = requireInt(req.params.id, 'caseId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await service.requireClient().updateCase(caseId, casePayload(body)));
    }),
  );

  router.delete(
    '/cases/:id',
    h(async (req, res) => {
      await service.requireClient().deleteCase(requireInt(req.params.id, 'caseId'));
      res.status(204).end();
    }),
  );

  router.post(
    '/cases/copy',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await service
        .requireClient()
        .copyCasesToSection(requireInt(body.targetSectionId, 'targetSectionId'), intArray(body.caseIds));
      res.status(204).end();
    }),
  );

  router.post(
    '/cases/move',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await service
        .requireClient()
        .moveCasesToSection(
          requireInt(body.targetSectionId, 'targetSectionId'),
          optInt(body.targetSuiteId),
          intArray(body.caseIds),
        );
      res.status(204).end();
    }),
  );

  // ---- Runs / tests / results ----

  router.get(
    '/projects/:id/runs',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      res.json(
        await service.cachedJson(`runs:${pid}`, () => service.requireClient().getRuns(pid), freshFlag(req)),
      );
    }),
  );

  router.get(
    '/projects/:id/planruns',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      res.json(
        await service.cachedJson(
          `planruns:${pid}`,
          () => service.requireClient().getPlanRuns(pid),
          freshFlag(req),
        ),
      );
    }),
  );

  router.post(
    '/projects/:id/runs',
    h(async (req, res) => {
      const pid = requireInt(req.params.id, 'projectId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const includeAll = body.includeAll === true;
      res.json(
        await service.requireClient().addRun(pid, {
          suiteId: optInt(body.suiteId),
          name: requireString(body.name, 'name'),
          description: optStr(body.description),
          refs: optStr(body.refs),
          assignedToId: optInt(body.assignedToId),
          includeAll,
          caseIds: includeAll ? undefined : intArray(body.caseIds),
        }),
      );
    }),
  );

  router.put(
    '/runs/:id',
    h(async (req, res) => {
      const runId = requireInt(req.params.id, 'runId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(
        await service.requireClient().updateRun(runId, {
          name: optStr(body.name),
          description: optStr(body.description),
          refs: optStr(body.refs),
        }),
      );
    }),
  );

  router.post(
    '/runs/:id/close',
    h(async (req, res) => {
      await service.requireClient().closeRun(requireInt(req.params.id, 'runId'));
      res.status(204).end();
    }),
  );

  router.delete(
    '/runs/:id',
    h(async (req, res) => {
      await service.requireClient().deleteRun(requireInt(req.params.id, 'runId'));
      res.status(204).end();
    }),
  );

  router.get(
    '/runs/:id/tests',
    h(async (req, res) => {
      const runId = requireInt(req.params.id, 'runId');
      res.json(
        await service.cachedJson(
          `tests:${runId}`,
          () => service.requireClient().getTests(runId),
          freshFlag(req),
        ),
      );
    }),
  );

  router.get(
    '/runs/:id/results',
    h(async (req, res) => {
      const runId = requireInt(req.params.id, 'runId');
      res.json(
        await service.cachedJson(
          `runresults:${runId}`,
          () => service.requireClient().getResultsForRun(runId),
          freshFlag(req),
        ),
      );
    }),
  );

  router.get(
    '/tests/:id/results',
    h(async (req, res) => {
      res.json(await service.requireClient().getResultsForTest(requireInt(req.params.id, 'testId')));
    }),
  );

  router.post(
    '/tests/:id/results',
    h(async (req, res) => {
      const testId = requireInt(req.params.id, 'testId');
      const body = (req.body ?? {}) as Record<string, unknown>;
      await service.requireClient().addResultExtended(testId, {
        statusId: requireInt(body.statusId, 'statusId'),
        comment: optStr(body.comment),
        defects: optStr(body.defects),
        elapsed: optStr(body.elapsed),
        version: optStr(body.version),
      });
      res.status(204).end();
    }),
  );

  // ---- Cache / prefetch ----

  router.post(
    '/prefetch',
    h((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(service.prefetch(intArray(body.projectIds)));
    }),
  );

  router.get(
    '/prefetch/status',
    h((_req, res) => {
      res.json(service.prefetchStatus());
    }),
  );

  router.delete(
    '/cache',
    h((_req, res) => {
      service.clearCache();
      res.status(204).end();
    }),
  );

  // ---- People (id -> display name) ----

  router.get(
    '/people',
    h((_req, res) => {
      res.json(service.getPeople());
    }),
  );

  router.put(
    '/people',
    h((req, res) => {
      const body = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'People payload must be an object of id -> name.');
      }
      service.setPeople(body as Record<string, unknown>);
      res.status(204).end();
    }),
  );

  // Surface TestRail failures as structured 502s; a missing session as 401.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof TestRailNotConnectedError) {
      res.status(401).json({ error: err.message });
      return;
    }
    if (err instanceof TestRailApiError) {
      res.status(502).json({ error: err.message, statusCode: err.status ?? null, body: err.body ?? null });
      return;
    }
    next(err);
  });

  return router;
}
