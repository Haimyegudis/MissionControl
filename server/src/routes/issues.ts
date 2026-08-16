// /api/issues — search, cached-search (MyWork delta semantics), details,
// transitions, comments, labels, worklogs (Task A7; ui-parity-contract.md §2).

import { Router } from 'express';
import type { AdjustEstimate } from '../jira/worklogService.js';
import type { JiraIssue } from '../types.js';
import { h, HttpError, requireString, type AppDeps } from './deps.js';

/** Issue-cache freshness window (ui-parity §2): 1 hour. */
export const CACHE_FRESH_MS = 60 * 60 * 1000;
/** Delta lower bound = last refresh − 2 minutes. */
export const DELTA_SLACK_MS = 2 * 60 * 1000;

/** `yyyy-MM-dd HH:mm` in local time (JQL `updated >=` literal). */
export function formatJqlMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Inject `AND updated >= "yyyy-MM-dd HH:mm"` before a trailing ORDER BY
 * (appended when the JQL has none).
 */
export function injectUpdatedClause(jql: string, since: Date): string {
  const clause = `updated >= "${formatJqlMinute(since)}"`;
  const match = /\border\s+by\b/i.exec(jql);
  if (match) {
    const head = jql.slice(0, match.index).trim();
    const tail = jql.slice(match.index).trim();
    return `${head} AND ${clause} ${tail}`;
  }
  return `${jql.trim()} AND ${clause}`;
}

export function issueRoutes(deps: AppDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.post(
    '/search',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const jql = requireString(body.jql, 'jql');
      const startAt = typeof body.startAt === 'number' ? body.startAt : 0;
      const maxResults = typeof body.maxResults === 'number' ? body.maxResults : 100;
      res.json(await deps.issues.searchIssues(jql, startAt, maxResults));
    }),
  );

  // MyWork delta semantics (ui-parity §2 "Loading / delta fetch").
  router.post(
    '/cached-search',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const cacheKey = requireString(body.cacheKey, 'cacheKey');
      const jql = requireString(body.jql, 'jql');
      const maxResults = typeof body.maxResults === 'number' ? body.maxResults : 200;

      const cached = deps.repos.issueCache.getCached(cacheKey);
      const lastRefresh = deps.repos.issueCache.getLastRefresh(cacheKey);
      const fresh =
        lastRefresh !== null && now().getTime() - lastRefresh.getTime() < CACHE_FRESH_MS;

      let issues: JiraIssue[];
      let totalCount: number;
      let fromCache: boolean;

      if (cached.length > 0 && fresh && lastRefresh) {
        const deltaJql = injectUpdatedClause(
          jql,
          new Date(lastRefresh.getTime() - DELTA_SLACK_MS),
        );
        const delta = await deps.issues.searchIssues(deltaJql, 0, maxResults);
        // Merge by key (ci): updated rows replace in place, new rows append.
        const byKey = new Map<string, JiraIssue>();
        for (const issue of cached) byKey.set(issue.key.toLowerCase(), issue);
        for (const issue of delta.items) byKey.set(issue.key.toLowerCase(), issue);
        issues = [...byKey.values()];
        totalCount = issues.length;
        fromCache = true;
      } else {
        const result = await deps.issues.searchIssues(jql, 0, maxResults);
        issues = result.items;
        totalCount = result.total;
        fromCache = false;
      }

      deps.repos.issueCache.saveCache(cacheKey, issues);
      const refreshed = deps.repos.issueCache.getLastRefresh(cacheKey);
      res.json({
        issues,
        totalCount,
        fromCache,
        lastRefresh: (refreshed ?? now()).toISOString(),
      });
    }),
  );

  router.get(
    '/:key',
    h(async (req, res) => {
      res.json(await deps.issues.getIssueDetails(req.params.key));
    }),
  );

  router.get(
    '/:key/timeline',
    h(async (req, res) => {
      res.json(await deps.issues.getIssueTimeline(req.params.key));
    }),
  );

  router.get(
    '/:key/transitions',
    h(async (req, res) => {
      res.json(await deps.issues.getTransitions(req.params.key));
    }),
  );

  router.get(
    '/:key/transitions/:id/screen',
    h(async (req, res) => {
      res.json(await deps.issues.getTransitionScreen(req.params.key, req.params.id));
    }),
  );

  router.post(
    '/:key/transitions',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = requireString(body.id, 'id');
      const fields =
        body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
          ? (body.fields as Record<string, unknown>)
          : null;
      const comment = typeof body.comment === 'string' ? body.comment : null;
      const assignee = typeof body.assignee === 'string' ? body.assignee : null;
      const timeSpent = typeof body.timeSpent === 'string' ? body.timeSpent : null;

      if (fields || comment || assignee || timeSpent) {
        await deps.issues.performTransitionWithData(
          req.params.key,
          id,
          fields ?? {},
          comment,
          assignee,
          timeSpent,
        );
      } else {
        await deps.issues.performTransition(req.params.key, id);
      }
      // Status changed — cached search results (dashboard, my work) are stale.
      deps.repos.issueCache.clearAll();
      res.status(204).end();
    }),
  );

  router.post(
    '/:key/comments',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await deps.issues.addComment(req.params.key, requireString(body.body, 'body'));
      res.status(204).end();
    }),
  );

  router.post(
    '/:key/labels',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await deps.issues.addLabel(req.params.key, requireString(body.label, 'label'));
      res.status(204).end();
    }),
  );

  router.put(
    '/:key/assignee',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await deps.issues.setAssignee(req.params.key, requireString(body.assignee, 'assignee'));
      res.status(204).end();
    }),
  );

  router.get(
    '/:key/worklogs',
    h(async (req, res) => {
      res.json(await deps.worklogs.getWorklogs(req.params.key));
    }),
  );

  router.post(
    '/:key/worklogs',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const seconds = body.seconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        throw new HttpError(400, 'Missing required parameter: seconds');
      }
      const started = requireString(body.started, 'started');
      const comment = typeof body.comment === 'string' ? body.comment : null;
      const adjustEstimate =
        typeof body.adjustEstimate === 'string' && body.adjustEstimate.length > 0
          ? (body.adjustEstimate as AdjustEstimate)
          : 'auto';
      const adjustValue = typeof body.adjustValue === 'string' ? body.adjustValue : null;
      res.json(
        await deps.worklogs.addWorklog(
          req.params.key,
          seconds,
          started,
          comment,
          adjustEstimate,
          adjustValue,
        ),
      );
    }),
  );

  return router;
}
