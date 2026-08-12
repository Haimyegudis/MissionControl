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

interface AuthStatus {
  connected: boolean;
  user: unknown;
  profile: AuthProfile | null;
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
  };
}

function credentialsFromBody(deps: AppDeps, body: Record<string, unknown>): Credentials {
  return {
    email: typeof body.email === 'string' ? body.email : '',
    jiraBaseUrl: requireString(body.baseUrl, 'baseUrl'),
    jiraPat: requireString(body.pat, 'pat'),
    instanceType: body.instanceType === 'cloud' ? 'cloud' : 'datacenter',
    defaultProjectKey: defaultProjectKey(deps),
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
      deps.credentials.clear();
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
