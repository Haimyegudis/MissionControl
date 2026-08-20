import { describe, expect, it, vi } from 'vitest';
import type { Credentials } from '@mc/core';
import { buildNativeRuntime, type RuntimeDeps } from '../src/native/bootstrap';

const CREDS: Credentials = {
  email: 'a@hp.com',
  jiraBaseUrl: 'https://hp-jira.external.hp.com/',
  jiraPat: 'pat',
  instanceType: 'datacenter',
  defaultProjectKey: 'ISW',
  testRailBaseUrl: 'https://hp-testrail.external.hp.com',
  testRailEmail: 'a@hp.com',
  testRailApiKey: 'key',
  confluenceBaseUrl: '',
  confluencePat: '',
};

function deps(overrides: Partial<RuntimeDeps> = {}, order: string[] = []): RuntimeDeps {
  return {
    kv: {
      hydrate: async () => {
        order.push('kv');
      },
      get: () => null,
      set: () => {},
      delete: () => {},
      clear: () => {},
    },
    people: {
      hydrate: async () => {
        order.push('people');
      },
      all: () => [],
      upsertMany: () => {},
      clear: () => {},
    },
    credentials: {
      hydrate: async () => {
        order.push('credentials');
      },
      load: () => null,
      save: () => {},
      clear: () => {},
    },
    installDispatch: () => {
      order.push('dispatch');
    },
    ...overrides,
  } as RuntimeDeps;
}

describe('buildNativeRuntime', () => {
  it('hydrates every store before installing the dispatcher', async () => {
    const order: string[] = [];
    await buildNativeRuntime(deps({}, order));
    expect(order).toEqual(['kv', 'people', 'credentials', 'dispatch']);
  });

  it('installs a dispatcher that answers the route contract', async () => {
    const installDispatch = vi.fn();
    await buildNativeRuntime(deps({ installDispatch }));
    const dispatch = installDispatch.mock.calls[0][0] as (m: string, p: string) => Promise<unknown>;
    await expect(dispatch('GET', '/api/auth/status')).resolves.toEqual({
      status: 200,
      body: { connected: false, user: null, profile: null },
    });
  });

  it('activates the session when stored credentials carry a PAT', async () => {
    const runtime = await buildNativeRuntime(
      deps({
        credentials: {
          hydrate: async () => {},
          load: () => CREDS,
          save: () => {},
          clear: () => {},
        } as RuntimeDeps['credentials'],
      }),
    );
    expect(runtime.core.session.isConnected).toBe(true);
    expect(runtime.core.session.profile?.jiraBaseUrl).toBe(CREDS.jiraBaseUrl);
  });

  it('leaves the session disconnected when nothing is stored', async () => {
    const runtime = await buildNativeRuntime(deps());
    expect(runtime.core.session.isConnected).toBe(false);
  });

  it('leaves the session disconnected when the stored PAT is blank', async () => {
    const runtime = await buildNativeRuntime(
      deps({
        credentials: {
          hydrate: async () => {},
          load: () => ({ ...CREDS, jiraPat: '   ' }),
          save: () => {},
          clear: () => {},
        } as RuntimeDeps['credentials'],
      }),
    );
    expect(runtime.core.session.isConnected).toBe(false);
  });

  it('reconnects TestRail when a stored API key is present', async () => {
    const connect = vi.fn(async () => ({ id: 1, name: 'Me', email: 'a@hp.com' }));
    const runtime = await buildNativeRuntime(
      deps({
        credentials: {
          hydrate: async () => {},
          load: () => CREDS,
          save: () => {},
          clear: () => {},
        } as RuntimeDeps['credentials'],
      }),
    );
    vi.spyOn(runtime.core.testrail, 'connect').mockImplementation(connect as never);
    await runtime.reconnectTestRail();
    expect(connect).toHaveBeenCalledWith({
      baseUrl: CREDS.testRailBaseUrl,
      email: CREDS.testRailEmail,
      apiKey: CREDS.testRailApiKey,
      cookieAuth: false,
    });
  });

  it('reconnects TestRail under SSO even with no stored API key', async () => {
    // The SAML cookie is the credential in this mode, so an empty key must not
    // short-circuit the reconnect the way it does for token auth.
    const connect = vi.fn(async () => ({ id: 1, name: 'Me', email: 'a@hp.com' }));
    const runtime = await buildNativeRuntime(
      deps({
        credentials: {
          hydrate: async () => {},
          load: () => ({ ...CREDS, testRailApiKey: '', authMode: 'sso' as const }),
          save: () => {},
          clear: () => {},
        } as RuntimeDeps['credentials'],
      }),
    );
    vi.spyOn(runtime.core.testrail, 'connect').mockImplementation(connect as never);
    await runtime.reconnectTestRail();
    expect(connect).toHaveBeenCalledWith({
      baseUrl: CREDS.testRailBaseUrl,
      email: CREDS.testRailEmail,
      apiKey: '',
      cookieAuth: true,
    });
  });

  it('a failing TestRail reconnect leaves the app usable', async () => {
    const runtime = await buildNativeRuntime(
      deps({
        credentials: {
          hydrate: async () => {},
          load: () => CREDS,
          save: () => {},
          clear: () => {},
        } as RuntimeDeps['credentials'],
      }),
    );
    vi.spyOn(runtime.core.testrail, 'connect').mockRejectedValue(new Error('offline'));
    await expect(runtime.reconnectTestRail()).resolves.toBeUndefined();
    expect(runtime.core.session.isConnected).toBe(true);
  });
});
