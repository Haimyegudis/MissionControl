import { describe, expect, it } from 'vitest';
import type { Credentials } from '@mc/core';
import { KeystoreCredentials, mergeSecrets, splitSecrets } from '../src/native/credentials';

const FULL: Credentials = {
  email: 'a@hp.com',
  jiraBaseUrl: 'https://hp-jira.external.hp.com/',
  jiraPat: 'JIRA-SECRET',
  instanceType: 'datacenter',
  defaultProjectKey: 'ISW',
  testRailBaseUrl: 'https://hp-testrail.external.hp.com',
  testRailEmail: 'a@hp.com',
  testRailApiKey: 'TR-SECRET',
  confluenceBaseUrl: '',
  confluencePat: 'CONF-SECRET',
};

describe('credential splitting', () => {
  it('keeps every token out of the non-secret half', () => {
    const { profile } = splitSecrets(FULL);
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain('JIRA-SECRET');
    expect(serialized).not.toContain('TR-SECRET');
    expect(serialized).not.toContain('CONF-SECRET');
  });

  it('keeps the profile fields the login screen pre-fills from', () => {
    const { profile } = splitSecrets(FULL);
    expect(profile.jiraBaseUrl).toBe(FULL.jiraBaseUrl);
    expect(profile.email).toBe(FULL.email);
    expect(profile.testRailBaseUrl).toBe(FULL.testRailBaseUrl);
    expect(profile.instanceType).toBe('datacenter');
  });

  it('round-trips through split and merge', () => {
    const { profile, secrets } = splitSecrets(FULL);
    expect(mergeSecrets(profile, secrets)).toEqual(FULL);
  });

  it('merges to empty secrets when the keystore half is missing', () => {
    const { profile } = splitSecrets(FULL);
    const merged = mergeSecrets(profile, null);
    expect(merged.jiraPat).toBe('');
    expect(merged.testRailApiKey).toBe('');
    expect(merged.confluencePat).toBe('');
  });
});

describe('KeystoreCredentials', () => {
  it('returns null before hydrate, so a locked app exposes nothing', () => {
    expect(new KeystoreCredentials().load()).toBeNull();
  });

  it('serves the merged credentials immediately after a save', () => {
    const creds = new KeystoreCredentials();
    creds.save(FULL);
    expect(creds.load()).toEqual(FULL);
  });

  it('drops everything on clear', () => {
    const creds = new KeystoreCredentials();
    creds.save(FULL);
    creds.clear();
    expect(creds.load()).toBeNull();
  });

  it('hydrate outside the native shell leaves the store empty rather than throwing', async () => {
    const creds = new KeystoreCredentials();
    await expect(creds.hydrate()).resolves.toBeUndefined();
    expect(creds.load()).toBeNull();
  });
});
