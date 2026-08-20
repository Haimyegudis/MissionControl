import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CredentialsStore, type Credentials } from '../src/config/credentialsStore.js';

const sample: Credentials = {
  email: 'user@example.com',
  jiraBaseUrl: 'https://jira.example.com/',
  jiraPat: 'secret-pat-123',
  instanceType: 'datacenter',
  defaultProjectKey: 'ISW',
  testRailBaseUrl: 'https://testrail.example.com/',
  testRailEmail: 'user@example.com',
  testRailApiKey: 'tr-api-key',
  confluenceBaseUrl: 'https://confluence.example.com/',
  confluencePat: 'confluence-pat',
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiraweb-credstore-'));
  process.env.JIRAWEB_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.JIRAWEB_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// DPAPI is implemented by a short-lived PowerShell process. On a busy Windows
// CI host process startup can exceed Vitest's five-second default.
describe('CredentialsStore', { timeout: 15_000 }, () => {
  it('exists() is false and load() is null when nothing saved', () => {
    const store = new CredentialsStore();
    expect(store.exists()).toBe(false);
    expect(store.load()).toBeNull();
  });

  it('save() then load() round-trips all fields', () => {
    const store = new CredentialsStore();
    store.save(sample);
    expect(store.exists()).toBe(true);
    expect(new CredentialsStore().load()).toEqual(sample);
  });

  it('writes profile JSON with DPAPI-protected secrets', () => {
    const store = new CredentialsStore();
    store.save(sample);
    const file = path.join(tmpDir, 'config.json');
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(raw.email).toBe('user@example.com');
    expect(raw.jiraPat).toBeUndefined();
    expect(raw.testRailApiKey).toBeUndefined();
    expect(raw.confluencePat).toBeUndefined();
    expect(raw.protectedSecrets).toEqual(expect.any(String));
    expect(raw.protectedSecrets).not.toContain('secret-pat-123');
    expect(raw.instanceType).toBe('datacenter');
  });

  it('save() overwrites an existing config', () => {
    const store = new CredentialsStore();
    store.save(sample);
    const updated: Credentials = { ...sample, instanceType: 'cloud', defaultProjectKey: 'ABC' };
    store.save(updated);
    expect(store.load()).toEqual(updated);
  });

  it('clear() removes the file; load() null afterwards; clear() again is a no-op', () => {
    const store = new CredentialsStore();
    store.save(sample);
    store.clear();
    expect(store.exists()).toBe(false);
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('load() defaults integration fields to empty strings for legacy configs', () => {
    const legacy = { ...sample } as Record<string, unknown>;
    delete legacy.testRailBaseUrl;
    delete legacy.testRailEmail;
    delete legacy.testRailApiKey;
    delete legacy.confluenceBaseUrl;
    delete legacy.confluencePat;
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(legacy));
    const store = new CredentialsStore();
    expect(store.load()).toEqual({
      ...sample,
      testRailBaseUrl: '',
      testRailEmail: '',
      testRailApiKey: '',
      confluenceBaseUrl: '',
      confluencePat: '',
    });
  });

  it('migrates legacy plaintext secrets to DPAPI on load', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(sample));
    const store = new CredentialsStore();
    expect(store.load()).toEqual(sample);
    const migrated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    expect(migrated.jiraPat).toBeUndefined();
    expect(migrated.protectedSecrets).toEqual(expect.any(String));
  });

  it('load() returns null on corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{not json');
    const store = new CredentialsStore();
    expect(store.load()).toBeNull();
  });
});
