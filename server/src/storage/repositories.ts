import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { BoardWorkspace, PinnedBoard, SavedFilter, Team } from '@mc/core';

// ---------------------------------------------------------------------------
// ID + date helpers
// ---------------------------------------------------------------------------

/** Lowercase hyphenated UUID (Guid "D" form). */
export function newId(): string {
  return randomUUID();
}

/** 32-hex, no hyphens (Guid "N" form) — used for Team.Id. */
export function newTeamId(): string {
  return randomUUID().replace(/-/g, '');
}

/** ISO-8601 UTC now — DateTime column convention. */
function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// SavedFilterRepo
// ---------------------------------------------------------------------------

interface SavedFilterRow {
  Id: string;
  Name: string;
  Description: string | null;
  Jql: string;
  IsFavorite: number;
  Created: string;
  LastUsed: string | null;
}

export class SavedFilterRepo {
  constructor(private readonly db: Db) {}

  getAll(): SavedFilter[] {
    const rows = this.db
      .prepare('SELECT Id, Name, Description, Jql, IsFavorite, Created, LastUsed FROM SavedFilters ORDER BY Name')
      .all() as SavedFilterRow[];
    return rows.map((r) => ({
      id: r.Id,
      name: r.Name,
      description: r.Description ?? null,
      jql: r.Jql,
      isFavorite: r.IsFavorite === 1,
      created: r.Created,
      lastUsed: r.LastUsed ?? null,
    }));
  }

  /** Insert or update by Id; Created is deliberately NOT updated on conflict. */
  upsert(filter: SavedFilter): SavedFilter {
    const stored: SavedFilter = {
      ...filter,
      id: filter.id && filter.id.length > 0 ? filter.id : newId(),
      created: filter.created && filter.created.length > 0 ? filter.created : nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO SavedFilters (Id, Name, Description, Jql, IsFavorite, Created, LastUsed)
         VALUES (@id, @name, @description, @jql, @isFavorite, @created, @lastUsed)
         ON CONFLICT(Id) DO UPDATE SET
           Name = excluded.Name,
           Description = excluded.Description,
           Jql = excluded.Jql,
           IsFavorite = excluded.IsFavorite,
           LastUsed = excluded.LastUsed`,
      )
      .run({
        id: stored.id,
        name: stored.name,
        description: stored.description ?? null,
        jql: stored.jql,
        isFavorite: stored.isFavorite ? 1 : 0,
        created: stored.created,
        lastUsed: stored.lastUsed ?? null,
      });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM SavedFilters WHERE Id = @id').run({ id });
  }
}

// ---------------------------------------------------------------------------
// PinnedBoardRepo
// ---------------------------------------------------------------------------

interface PinnedBoardRow {
  Id: string;
  ProfileId: string;
  BoardId: number;
  Name: string;
  FilterId: number | null;
}

export class PinnedBoardRepo {
  constructor(private readonly db: Db) {}

  getForProfile(profileId: string): PinnedBoard[] {
    const rows = this.db
      .prepare('SELECT Id, ProfileId, BoardId, Name, FilterId FROM PinnedBoards WHERE ProfileId = @pid ORDER BY Name')
      .all({ pid: profileId }) as PinnedBoardRow[];
    return rows.map((r) => ({
      id: r.Id,
      profileId: r.ProfileId,
      boardId: r.BoardId,
      name: r.Name,
      filterId: r.FilterId ?? null,
    }));
  }

  upsert(board: PinnedBoard): PinnedBoard {
    const stored: PinnedBoard = { ...board, id: board.id && board.id.length > 0 ? board.id : newId() };
    this.db
      .prepare(
        `INSERT INTO PinnedBoards (Id, ProfileId, BoardId, Name, FilterId)
         VALUES (@id, @profileId, @boardId, @name, @filterId)
         ON CONFLICT(Id) DO UPDATE SET
           ProfileId = excluded.ProfileId,
           BoardId = excluded.BoardId,
           Name = excluded.Name,
           FilterId = excluded.FilterId`,
      )
      .run({
        id: stored.id,
        profileId: stored.profileId,
        boardId: stored.boardId,
        name: stored.name,
        filterId: stored.filterId ?? null,
      });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM PinnedBoards WHERE Id = @id').run({ id });
  }
}

// ---------------------------------------------------------------------------
// BoardWorkspaceRepo
// ---------------------------------------------------------------------------

interface BoardWorkspaceRow {
  Id: string;
  ProfileId: string;
  Name: string;
  BoardIdsJson: string;
  IsDefault: number;
}

export class BoardWorkspaceRepo {
  private readonly setDefaultTx: (id: string, profileId: string) => void;

  constructor(private readonly db: Db) {
    const clear = db.prepare('UPDATE BoardWorkspaces SET IsDefault = 0 WHERE ProfileId = @pid');
    const set = db.prepare('UPDATE BoardWorkspaces SET IsDefault = 1 WHERE Id = @id');
    this.setDefaultTx = db.transaction((id: string, profileId: string) => {
      clear.run({ pid: profileId });
      set.run({ id });
    });
  }

  getForProfile(profileId: string): BoardWorkspace[] {
    const rows = this.db
      .prepare(
        'SELECT Id, ProfileId, Name, BoardIdsJson, IsDefault FROM BoardWorkspaces WHERE ProfileId = @pid ORDER BY Name',
      )
      .all({ pid: profileId }) as BoardWorkspaceRow[];
    return rows.map((r) => ({
      id: r.Id,
      profileId: r.ProfileId,
      name: r.Name,
      boardIds: parseIntArray(r.BoardIdsJson),
      isDefault: r.IsDefault === 1,
    }));
  }

  upsert(ws: BoardWorkspace): BoardWorkspace {
    const stored: BoardWorkspace = { ...ws, id: ws.id && ws.id.length > 0 ? ws.id : newId() };
    this.db
      .prepare(
        `INSERT INTO BoardWorkspaces (Id, ProfileId, Name, BoardIdsJson, IsDefault)
         VALUES (@id, @profileId, @name, @boardIdsJson, @isDefault)
         ON CONFLICT(Id) DO UPDATE SET
           ProfileId = excluded.ProfileId,
           Name = excluded.Name,
           BoardIdsJson = excluded.BoardIdsJson,
           IsDefault = excluded.IsDefault`,
      )
      .run({
        id: stored.id,
        profileId: stored.profileId,
        name: stored.name,
        boardIdsJson: JSON.stringify(stored.boardIds ?? []),
        isDefault: stored.isDefault ? 1 : 0,
      });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM BoardWorkspaces WHERE Id = @id').run({ id });
  }

  /** Clears IsDefault for the profile then sets it on one row — in a transaction. */
  setDefault(id: string, profileId: string): void {
    this.setDefaultTx(id, profileId);
  }
}

function parseIntArray(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// TeamRepo
// ---------------------------------------------------------------------------

interface TeamRow {
  Id: string;
  Name: string;
  MembersJson: string;
}

export class TeamRepo {
  constructor(private readonly db: Db) {}

  getAll(): Team[] {
    const rows = this.db
      .prepare('SELECT Id, Name, MembersJson FROM Teams ORDER BY Name COLLATE NOCASE')
      .all() as TeamRow[];
    return rows.map(mapTeam);
  }

  getById(id: string | null | undefined): Team | null {
    if (!id) return null;
    const row = this.db.prepare('SELECT Id, Name, MembersJson FROM Teams WHERE Id = @id').get({ id }) as
      | TeamRow
      | undefined;
    return row ? mapTeam(row) : null;
  }

  upsert(team: Team): Team {
    const stored: Team = { ...team, id: team.id && team.id.length > 0 ? team.id : newTeamId() };
    this.db
      .prepare(
        `INSERT INTO Teams (Id, Name, MembersJson) VALUES (@id, @name, @membersJson)
         ON CONFLICT(Id) DO UPDATE SET Name = excluded.Name, MembersJson = excluded.MembersJson`,
      )
      .run({ id: stored.id, name: stored.name, membersJson: JSON.stringify(stored.members ?? []) });
    return stored;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM Teams WHERE Id = @id').run({ id });
  }
}

function mapTeam(row: TeamRow): Team {
  let members: string[];
  try {
    const parsed = JSON.parse(row.MembersJson);
    members = Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    members = [];
  }
  return { id: row.Id, name: row.Name, members };
}
