// My Work JQL rewrites (ui-parity-contract.md §2) — default/board JQL,
// assignee-filter rewrite, quick-filter clause swap, board route params.
// Pure — unit tested.

export const MY_WORK_ORDER_BY = 'ORDER BY Sprint ASC, updated DESC, created DESC';

/** §2 default JQL (verbatim). */
export function defaultMyWorkJql(project: string): string {
  return `project = ${project} AND assignee = currentUser() AND statusCategory != Done ${MY_WORK_ORDER_BY}`;
}

/** §2 pinned-board JQL (verbatim); fallback when the board has no filter id. */
export function boardModeJql(filterId: number | null | undefined, project: string): string {
  if (filterId !== null && filterId !== undefined) {
    return `filter = ${filterId} AND statusCategory != Done ${MY_WORK_ORDER_BY}`;
  }
  return `project = ${project} AND statusCategory != Done ${MY_WORK_ORDER_BY}`;
}

/** Split a trailing ORDER BY clause off a JQL string. */
export function splitOrderBy(jql: string): { body: string; orderBy: string } {
  const match = /\border\s+by\b/i.exec(jql);
  if (!match) return { body: jql.trim(), orderBy: '' };
  return { body: jql.slice(0, match.index).trim(), orderBy: jql.slice(match.index).trim() };
}

const ASSIGNEE_CLAUSE = /\s+AND\s+assignee\s*=\s*(?:"(?:[^"\\]|\\.)*"|currentUser\(\))/gi;

/**
 * Assignee-filter rewrite (§2): split trailing ORDER BY, strip any existing
 * `AND assignee = ("..."|currentUser())` clause, append the new clause when a
 * user is picked (empty user = no assignee constraint), re-attach ORDER BY.
 */
export function applyAssigneeFilter(jql: string, user: string): string {
  const { body, orderBy } = splitOrderBy(jql);
  let next = body.replace(ASSIGNEE_CLAUSE, '').trim();
  const picked = user.trim();
  if (picked) next += ` AND assignee = "${picked}"`;
  return orderBy ? `${next} ${orderBy}` : next;
}

/**
 * Quick-filter swap (§2): remove the previously appended quick clause
 * (tracked by the caller), then append `AND ({query})` before ORDER BY.
 * `query` null/empty = the "All" chip (remove only).
 */
export function applyQuickFilter(
  jql: string,
  query: string | null,
  previousQuery: string | null,
): string {
  const { body, orderBy } = splitOrderBy(jql);
  let next = body;
  if (previousQuery) {
    const prevClause = ` AND (${previousQuery})`;
    const at = next.lastIndexOf(prevClause);
    if (at >= 0) next = (next.slice(0, at) + next.slice(at + prevClause.length)).trim();
  }
  if (query && query.trim()) next += ` AND (${query.trim()})`;
  return orderBy ? `${next} ${orderBy}` : next;
}

// ---------------------------------------------------------------------------
// Pinned-board route params — `#/mywork?board={id}&filter={fid}&name={name}`
// ---------------------------------------------------------------------------

export interface BoardParams {
  boardId: number;
  filterId: number | null;
  name: string;
}

/** Parse board-mode params from a location hash; null when not in board mode. */
export function parseBoardParams(hash: string): BoardParams | null {
  const qIndex = hash.indexOf('?');
  if (qIndex < 0) return null;
  const route = hash.slice(0, qIndex).replace(/^#\/?/, '').toLowerCase();
  if (route !== 'mywork') return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const board = Number(params.get('board'));
  if (!Number.isFinite(board) || board <= 0) return null;
  const filterRaw = params.get('filter');
  const filterId = filterRaw !== null && filterRaw !== '' ? Number(filterRaw) : null;
  return {
    boardId: board,
    filterId: filterId !== null && Number.isFinite(filterId) ? filterId : null,
    name: params.get('name') ?? '',
  };
}

/** Build the board-mode hash (used by the shell's pinned-board links). */
export function boardHash(boardId: number, filterId: number | null, name: string): string {
  const params = new URLSearchParams();
  params.set('board', String(boardId));
  if (filterId !== null && filterId !== undefined) params.set('filter', String(filterId));
  if (name) params.set('name', name);
  return `#/mywork?${params.toString()}`;
}
