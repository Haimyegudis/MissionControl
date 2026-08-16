// /api/boards + /api/pinned-boards (Task A7).

import { Router } from 'express';
import { BOARDS_CACHE_KEY } from '../jira/cached.js';
import { apiPrefix, jiraFetch } from '../jira/httpClient.js';
import type { PinnedBoard } from '../types.js';
import { h, HttpError, qstr, type AppDeps } from './deps.js';

/** Single-profile deployment — fixed pinned-board profile id. */
export const PINNED_PROFILE_ID = '00000000-0000-0000-0000-000000000000';

function boardId(raw: string): number {
  const id = Number(raw);
  if (!Number.isFinite(id)) throw new HttpError(400, `Invalid board id: ${raw}`);
  return id;
}

export function boardRoutes(deps: AppDeps): Router {
  const router = Router();

  // The client consumes JiraBoard[]; load diagnostics stay server-side.
  router.get(
    '/',
    h(async (req, res) => {
      if (qstr(req.query.force)) deps.repos.metadataCache.delete(BOARDS_CACHE_KEY);
      const result = await deps.boards.getBoards();
      res.json(result.boards);
    }),
  );

  router.get(
    '/:id/sprints',
    h(async (req, res) => {
      res.json(await deps.boards.getActiveSprints(boardId(req.params.id)));
    }),
  );

  router.get(
    '/:id/issues',
    h(async (req, res) => {
      res.json(await deps.boards.getBoardIssues(boardId(req.params.id), qstr(req.query.jql)));
    }),
  );

  router.get(
    '/:id/quickfilters',
    h(async (req, res) => {
      res.json(await deps.boards.getQuickFilters(boardId(req.params.id)));
    }),
  );

  // Raw JQL of a board's saved filter — board mode rewrites it (strip the
  // embedded assignee = currentUser() so the whole team shows).
  router.get(
    '/filter/:filterId/jql',
    h(async (req, res) => {
      const id = boardId(req.params.filterId);
      const prefix = apiPrefix(deps.session.profile?.instanceType ?? 'datacenter');
      const filter = (await jiraFetch(deps.session, `${prefix}/filter/${id}`)) as { jql?: unknown } | null;
      res.json({ jql: typeof filter?.jql === 'string' ? filter.jql : null });
    }),
  );

  return router;
}

export function pinnedBoardRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    h((_req, res) => {
      res.json(deps.repos.pinnedBoards.getForProfile(PINNED_PROFILE_ID));
    }),
  );

  router.post(
    '/',
    h((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const board: PinnedBoard = {
        id: typeof body.id === 'string' ? body.id : '',
        profileId: PINNED_PROFILE_ID,
        boardId: typeof body.boardId === 'number' ? body.boardId : Number(body.boardId ?? NaN),
        name: typeof body.name === 'string' ? body.name : '',
        filterId: typeof body.filterId === 'number' ? body.filterId : null,
      };
      if (!Number.isFinite(board.boardId)) throw new HttpError(400, 'Missing required parameter: boardId');
      res.json(deps.repos.pinnedBoards.upsert(board));
    }),
  );

  router.delete(
    '/:id',
    h((req, res) => {
      deps.repos.pinnedBoards.delete(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
