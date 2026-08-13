// Composition root (Task A7): open the SQLite DB, build the real services,
// auto-activate the saved session, and serve /api + client/dist on 127.0.0.1.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askLumo } from './ai/lumoAgent.js';
import { runCopilotCli } from './ai/cliRunner.js';
import { createApp } from './app.js';
import { dbFile, ensureDataDir } from './config/appPaths.js';
import { CredentialsStore, type Credentials } from './config/credentialsStore.js';
import { DashboardAggregator } from './jira/aggregator.js';
import { JiraBoardService } from './jira/boardService.js';
import { CachedBoardService, CachedMetadataService } from './jira/cached.js';
import { JiraCreateIssueService } from './jira/createIssueService.js';
import { JiraDashboardService } from './jira/dashboardService.js';
import { JiraIssueService } from './jira/issueService.js';
import { JiraMetadataService } from './jira/metadataService.js';
import { JiraSession } from './jira/session.js';
import { TimeLoggedService } from './jira/timeLogged.js';
import { metadataWarmup } from './jira/warmup.js';
import { JiraWorklogService } from './jira/worklogService.js';
import { openDb } from './storage/db.js';
import { CreateDefaultsStore, CreateMetaCache } from './storage/fileStores.js';
import { TestRailService } from './testrail/service.js';
import {
  AppSettingsRepo,
  IssueCacheRepo,
  MetadataCacheRepo,
  PinnedBoardRepo,
  SavedFilterRepo,
  TeamRepo,
} from './storage/repositories.js';
import type { JiraUser } from './types.js';

const dataDir = ensureDataDir();
const db = openDb(dbFile());

const session = new JiraSession();
const credentials = new CredentialsStore();

const appSettings = new AppSettingsRepo(db);
const issueCache = new IssueCacheRepo(db);
const metadataCache = new MetadataCacheRepo(db);
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
const testRail = new TestRailService(db);
testRail.importLegacyPeopleIfEmpty();

/** distinct:{project}:{field} cache over issueService.getDistinctIssueField. */
function getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]> {
  return metadata.getDistinct(projectKey, fieldName, () =>
    issueService.getDistinctIssueField(projectKey, fieldName, maxIssues, metadata),
  );
}

/** Throwaway session + GET /myself — used by /auth/test|login and boot. */
async function testConnection(creds: Credentials): Promise<JiraUser> {
  const probe = new JiraSession();
  probe.activate(creds, null);
  return new JiraIssueService(probe).getCurrentUser();
}

const app = createApp({
  session,
  credentials,
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
  askLumo: (request) =>
    askLumo({ ...request, session, tools: issueService, runCli: runCopilotCli }),
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

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5643;
app.listen(port, '127.0.0.1', () => {
  console.log(`JiraWeb server listening on http://127.0.0.1:${port} (data: ${dataDir})`);
  void autoActivate();
  void autoConnectTestRail();
});
