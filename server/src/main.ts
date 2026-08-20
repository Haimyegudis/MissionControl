// Composition root (Task A7): open the SQLite DB, build the real services,
// auto-activate the saved session, and serve /api + client/dist on 127.0.0.1.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askLumo } from './ai/lumoAgent.js';
import { runCliForModel } from './ai/cliRunner.js';
import { buildLumoTools } from './ai/lumoTools.js';
import { createApp } from './app.js';
import { dbFile, ensureDataDir } from './config/appPaths.js';
import { CredentialsStore, type Credentials } from './config/credentialsStore.js';
import {
  AppSettingsRepo,
  CachedBoardService,
  CachedMetadataService,
  DashboardAggregator,
  IssueCacheRepo,
  JiraBoardService,
  JiraCreateIssueService,
  JiraDashboardService,
  JiraIssueService,
  JiraMetadataService,
  JiraSession,
  JiraWorklogService,
  MetadataCacheRepo,
  TestRailService,
  TimeLoggedService,
  metadataWarmup,
  parsePeople,
  type JiraUser,
  type TestRailPerson,
} from '@mc/core';
import { loadOrCreateApiToken } from './security.js';
import { openDb } from './storage/db.js';
import { CreateDefaultsStore, CreateMetaCache } from './storage/fileStores.js';
import { PinnedBoardRepo, SavedFilterRepo, TeamRepo } from './storage/repositories.js';
import { SqliteKvStore, SqlitePeopleStore } from './storage/sqliteKv.js';
import { ConfluenceService, setIndigoSpaceOverride } from '@mc/core';

/** %APPDATA%\TestRailWeb\people.json — the standalone app's people store. */
function legacyPeople(): TestRailPerson[] | null {
  const appData =
    process.env.APPDATA && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming');
  try {
    const raw = fs.readFileSync(path.join(appData, 'TestRailWeb', 'people.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsePeople(parsed as Record<string, unknown>);
  } catch {
    return null; // missing or unreadable legacy store — nothing to import
  }
}

const dataDir = ensureDataDir();
const db = openDb(dbFile());

const session = new JiraSession();
const credentials = new CredentialsStore();

const kv = new SqliteKvStore(db);
const people = new SqlitePeopleStore(db);

const appSettings = new AppSettingsRepo(kv);
const issueCache = new IssueCacheRepo(kv);
const metadataCache = new MetadataCacheRepo(kv);
const savedFilters = new SavedFilterRepo(db);
const teams = new TeamRepo(db);
const pinnedBoards = new PinnedBoardRepo(db);

const issueService = new JiraIssueService(session);
const worklogService = new JiraWorklogService(session);
const boards = new CachedBoardService(new JiraBoardService(session), metadataCache);
const metadata = new CachedMetadataService(new JiraMetadataService(session), metadataCache);
const dashboards = new JiraDashboardService(session);
const createIssues = new JiraCreateIssueService(session);
const timeLogged = new TimeLoggedService(session, issueService, worklogService);
const aggregator = new DashboardAggregator(session, issueService, timeLogged);
const createDefaults = new CreateDefaultsStore();
const createMetaCache = new CreateMetaCache();
const testRail = new TestRailService(kv, people, undefined, legacyPeople);
setIndigoSpaceOverride(process.env.CONFLUENCE_INDIGO_SPACES);
const confluence = new ConfluenceService(credentials);
testRail.importLegacyPeopleIfEmpty();

/** distinct:{project}:{field} cache over issueService.getDistinctIssueField. */
function getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]> {
  return metadata.getDistinct(projectKey, fieldName, () =>
    issueService.getDistinctIssueField(projectKey, fieldName, maxIssues, metadata),
  );
}

// Composite Lumo tool surface: JiraWeb's own issue service (legacy three
// tools) + the full Lumo tool catalog (brain, vectors, Confluence, TestRail,
// config control, reasoning) reading Lumo's assets in place (LUMO_ROOT).
const lumoTools = {
  searchIssues: issueService.searchIssues.bind(issueService),
  getIssueDetails: issueService.getIssueDetails.bind(issueService),
  getIssueTimeline: issueService.getIssueTimeline.bind(issueService),
  addComment: issueService.addComment.bind(issueService),
  lumo: buildLumoTools({ session, testrail: testRail, confluence }),
};

/** Throwaway session + GET /myself — used by /auth/test|login and boot. */
async function testConnection(creds: Credentials): Promise<JiraUser> {
  const probe = new JiraSession();
  probe.activate(creds, null);
  return new JiraIssueService(probe).getCurrentUser();
}

const apiToken = loadOrCreateApiToken(dataDir);
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5643;

const app = createApp({
  session,
  credentials,
  apiToken,
  apiPort: port,
  testConnection,
  warmup: () => {
    void metadataWarmup({ session, metadata, boards, getDistinct });
  },
  issues: issueService,
  worklogs: worklogService,
  boards,
  metadata,
  getDistinct,
  dashboards,
  createIssues,
  timeLogged,
  aggregator,
  repos: { appSettings, issueCache, metadataCache, savedFilters, teams, pinnedBoards },
  createDefaults,
  createMetaCache,
  testrail: testRail,
  confluence,
  askLumo: (request) =>
    askLumo({ ...request, session, tools: lumoTools, runCli: runCliForModel }),
  staticDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist'),
});

/** Auto-activate from saved credentials; a failed ping stays disconnected. */
async function autoActivate(): Promise<void> {
  const saved = credentials.load();
  if (!saved || saved.jiraPat.trim().length === 0) return;
  try {
    const user = await testConnection(saved);
    session.activate(saved, user);
    console.log(`Session restored: ${saved.jiraBaseUrl} as ${user.displayName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Saved credentials found but the Jira ping failed (${message}); staying disconnected.`);
  }
}

/** Auto-connect TestRail from saved credentials; a failed ping stays disconnected. */
async function autoConnectTestRail(): Promise<void> {
  const saved = credentials.load();
  if (!saved || saved.testRailBaseUrl.trim().length === 0 || saved.testRailApiKey.trim().length === 0) {
    return;
  }
  try {
    const user = await testRail.connect({
      baseUrl: saved.testRailBaseUrl,
      email: saved.testRailEmail,
      apiKey: saved.testRailApiKey,
    });
    console.log(`TestRail session restored: ${saved.testRailBaseUrl} as ${user.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Saved TestRail credentials found but the ping failed (${message}); staying disconnected.`);
  }
}

async function autoConnectConfluence(): Promise<void> {
  if (!confluence.connection()) return;
  try {
    const user = await confluence.connect();
    console.log(`Confluence session restored as ${user.displayName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Saved Confluence credentials found but the ping failed (${message}); staying disconnected.`);
  }
}

app.listen(port, '127.0.0.1', () => {
  console.log(`JiraWeb server listening on http://127.0.0.1:${port} (data: ${dataDir})`);
  void autoActivate();
  void autoConnectTestRail();
  void autoConnectConfluence();
});
