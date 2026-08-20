import { describe, expect, it, vi } from 'vitest';
import { createCore, type CorePorts } from '../src/composition.js';
import { MemoryKvStore, MemoryPeopleStore } from '../src/storage/kv.js';
import type { Credentials } from '../src/types.js';

const CREDS: Credentials = {
  email: 'me@hp.com',
  jiraBaseUrl: 'https://hp-jira.external.hp.com/',
  jiraPat: 'pat',
  instanceType: 'datacenter',
  defaultProjectKey: 'ISW',
  testRailBaseUrl: 'https://hp-testrail.external.hp.com',
  testRailEmail: 'me@hp.com',
  testRailApiKey: 'key',
  confluenceBaseUrl: '',
  confluencePat: '',
};

function ports(): CorePorts {
  let stored: Credentials | null = null;
  return {
    kv: new MemoryKvStore(),
    people: new MemoryPeopleStore(),
    credentials: {
      load: () => stored,
      save: (c: Credentials) => {
        stored = c;
      },
      clear: () => {
        stored = null;
      },
    },
  };
}

describe('createCore', () => {
  it('builds a disconnected graph when no credentials are stored', () => {
    const core = createCore(ports());
    expect(core.session.isConnected).toBe(false);
    expect(core.testrail.isConnected).toBe(false);
  });

  it('exposes every service the dispatcher needs', () => {
    const core = createCore(ports());
    for (const key of [
      'session',
      'issues',
      'worklogs',
      'boards',
      'metadata',
      'timeLogged',
      'testrail',
      'settings',
      'issueCache',
      'credentials',
    ] as const) {
      expect(core[key], key).toBeDefined();
    }
  });

  it('backs settings with the injected KV store', () => {
    const p = ports();
    const core = createCore(p);
    core.settings.save({ ...core.settings.get(), theme: 'Light' });
    expect(createCore(p).settings.get().theme).toBe('Light');
  });

  it('shares one session across the Jira services', () => {
    const core = createCore(ports());
    core.session.activate(CREDS, null);
    expect(core.session.isConnected).toBe(true);
  });

  it('testConnection probes with a throwaway session, leaving the live one alone', async () => {
    const core = createCore(ports());
    const probe = vi.fn(async () => ({ displayName: 'Me' }));
    const user = await core.testConnection(CREDS, probe as never);
    expect(user).toEqual({ displayName: 'Me' });
    expect(core.session.isConnected).toBe(false);
  });

  it('getDistinct caches through the metadata service', async () => {
    const core = createCore(ports());
    const inner = vi.spyOn(core.issues, 'getDistinctIssueField').mockResolvedValue(['a', 'b']);
    expect(await core.getDistinct('ISW', 'Severity', 500)).toEqual(['a', 'b']);
    expect(await core.getDistinct('ISW', 'Severity', 500)).toEqual(['a', 'b']);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
