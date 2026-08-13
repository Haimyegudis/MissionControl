import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Schema per docs/reference/storage-layer.md §1, minus the dead Profiles and
 * RecentChanges tables, plus WAL and indexes on the ProfileId filter columns.
 * JSON blob columns (Json, BoardIdsJson, MembersJson) keep PascalCase keys for
 * potential import of an existing command-center.db (storage-layer.md §8.1).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS SavedFilters (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL,
    Description TEXT NULL,
    Jql TEXT NOT NULL,
    IsFavorite INTEGER NOT NULL DEFAULT 0,
    Created TEXT NOT NULL,
    LastUsed TEXT NULL
);

CREATE TABLE IF NOT EXISTS PinnedBoards (
    Id TEXT PRIMARY KEY,
    ProfileId TEXT NOT NULL,
    BoardId INTEGER NOT NULL,
    Name TEXT NOT NULL,
    FilterId INTEGER NULL
);

CREATE TABLE IF NOT EXISTS BoardWorkspaces (
    Id TEXT PRIMARY KEY,
    ProfileId TEXT NOT NULL,
    Name TEXT NOT NULL,
    BoardIdsJson TEXT NOT NULL,
    IsDefault INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS AppSettings (
    Id INTEGER PRIMARY KEY CHECK (Id = 1),
    Json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS IssueCache (
    CacheKey TEXT PRIMARY KEY,
    Json TEXT NOT NULL,
    UpdatedUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS MetadataCache (
    CacheKey TEXT PRIMARY KEY,
    Json TEXT NOT NULL,
    UpdatedUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Teams (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL,
    MembersJson TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS TestRailCache (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS TestRailPeople (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS IX_PinnedBoards_ProfileId ON PinnedBoards (ProfileId);
CREATE INDEX IF NOT EXISTS IX_BoardWorkspaces_ProfileId ON BoardWorkspaces (ProfileId);
`;

/**
 * Open (creating if needed) the SQLite database at the given path and ensure
 * the schema exists. Supports ':memory:' for tests.
 */
export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
