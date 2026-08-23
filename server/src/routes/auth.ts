// /api/auth — connection test, login, logout, status (Task A7).

import { Router } from 'express';
import type { Credentials } from '../config/credentialsStore.js';
import { defaultProjectKey, h, requireString, type AppDeps } from './deps.js';

interface AuthProfile {
  email: string;
  jiraBaseUrl: string;
  instanceType: 'cloud' | 'datacenter';
  defaultProjectKey: string;
}

interface SavedIdentity {
  email: string;
  jiraBaseUrl: string;
  instanceType: 'cloud' | 'datacenter';
}

interface AuthStatus {
  connected: boolean;
  user: unknown;
  profile: AuthProfile | null;
  saved: SavedIdentity | null;
}

/**
 * The identity on disk, minus every secret. Sent even while disconnected so
 * the login form knows who was signed in and only has to ask for a token.
 */
function savedIdentity(deps: AppDeps): SavedIdentity | null {
  const saved = deps.credentials.load();
  if (!saved || saved.email.trim().length === 0) return null;
  return {
    email: saved.email,
    jiraBaseUrl: saved.jiraBaseUrl,
    instanceType: saved.instanceType,
  };
}

/** AuthStatus payload — the PAT never leaves the server. */
export function authStatus(deps: AppDeps): AuthStatus {
  const profile = deps.session.profile;
  return {
    connected: deps.session.isConnected,
    user: deps.session.currentUser,
    profile: profile
      ? {
          email: profile.email,
          jiraBaseUrl: profile.jiraBaseUrl,
          instanceType: profile.instanceType,
          defaultProjectKey: profile.defaultProjectKey,
        }
      : null,
    saved: savedIdentity(deps),
  };
}

/** Fixed HP Jira endpoint — the Settings UI no longer sends a baseUrl;
 *  explicit values (older clients, saved profiles) still win when present. */
const DEFAULT_JIRA_BASE_URL = 'https://hp-jira.external.hp.com';

function credentialsFromBody(deps: AppDeps, body: Record<string, unknown>): Credentials {
  // Preserve saved integrations — a Jira login must not wipe them.
  const saved = deps.credentials.load();
  return {
    email: typeof body.email === 'string' ? body.email : '',
    jiraBaseUrl:
      typeof body.baseUrl === 'string' && body.baseUrl.trim()
        ? body.baseUrl
        : DEFAULT_JIRA_BASE_URL,
    jiraPat: requireString(body.pat, 'pat'),
    instanceType: body.instanceType === 'cloud' ? 'cloud' : 'datacenter',
    defaultProjectKey: defaultProjectKey(deps),
    testRailBaseUrl: saved?.testRailBaseUrl ?? '',
    testRailEmail: saved?.testRailEmail ?? '',
    testRailApiKey: saved?.testRailApiKey ?? '',
    confluenceBaseUrl: saved?.confluenceBaseUrl ?? '',
    confluencePat: saved?.confluencePat ?? '',
  };
}

export function authRoutes(deps: AppDeps): Router {
  const router = Router();

  router.post(
    '/test',
    h(async (req, res) => {
      const credentials = credentialsFromBody(deps, (req.body ?? {}) as Record<string, unknown>);
      const user = await deps.testConnection(credentials);
      res.json(user);
    }),
  );

  router.post(
    '/login',
    h(async (req, res) => {
      const credentials = credentialsFromBody(deps, (req.body ?? {}) as Record<string, unknown>);
      const user = await deps.testConnection(credentials);
      deps.credentials.save(credentials);
      deps.session.activate(credentials, user);
      deps.warmup?.();
      res.json(authStatus(deps));
    }),
  );

  router.post(
    '/logout',
    h((_req, res) => {
      // Disconnect Jira without destroying independent TestRail/Confluence
      // connections saved in the same local configuration file.
      const saved = deps.credentials.load();
      if (saved) {
        deps.credentials.save({ ...saved, email: '', jiraBaseUrl: '', jiraPat: '' });
      } else {
        deps.credentials.clear();
      }
      deps.session.clear();
      res.status(204).end();
    }),
  );

  router.get(
    '/status',
    h((_req, res) => {
      res.json(authStatus(deps));
    }),
  );

  return router;
}
