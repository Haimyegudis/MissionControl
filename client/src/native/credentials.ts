// Credential store for the Android shell. Only jiraPat and testRailApiKey are
// secret; everything else is profile data the login screen pre-fills without
// asking for a fingerprint. Secrets live in the Android Keystore and are held
// in memory only after a successful unlock.

import type { Credentials, CredentialsPort } from '@mc/core';

export type CredentialProfile = Omit<Credentials, 'jiraPat' | 'testRailApiKey'>;

export interface CredentialSecrets {
  jiraPat: string;
  testRailApiKey: string;
}

const PROFILE_KEY = 'mc.credentials.profile';
const SECRET_KEY = 'mc.credentials.secrets';

export function splitSecrets(c: Credentials): { profile: CredentialProfile; secrets: CredentialSecrets } {
  const { jiraPat, testRailApiKey, ...profile } = c;
  return { profile, secrets: { jiraPat, testRailApiKey } };
}

export function mergeSecrets(profile: CredentialProfile, secrets: CredentialSecrets | null): Credentials {
  return { ...profile, jiraPat: secrets?.jiraPat ?? '', testRailApiKey: secrets?.testRailApiKey ?? '' };
}

export class KeystoreCredentials implements CredentialsPort {
  private cached: Credentials | null = null;

  /** Read both halves into memory. Call only after a successful unlock. */
  async hydrate(): Promise<void> {
    let profile: CredentialProfile;
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: PROFILE_KEY });
      if (!value) return;
      profile = JSON.parse(value) as CredentialProfile;
    } catch {
      return; // no profile stored, or not running in the native shell
    }

    let secrets: CredentialSecrets | null = null;
    try {
      const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
      const { value } = await SecureStoragePlugin.get({ key: SECRET_KEY });
      secrets = JSON.parse(value) as CredentialSecrets;
    } catch {
      secrets = null; // profile saved but secrets absent or unreadable
    }

    this.cached = mergeSecrets(profile, secrets);
  }

  load(): Credentials | null {
    return this.cached;
  }

  save(credentials: Credentials): void {
    this.cached = credentials;
    void this.persist(credentials);
  }

  clear(): void {
    this.cached = null;
    void this.wipe();
  }

  private async persist(credentials: Credentials): Promise<void> {
    const { profile, secrets } = splitSecrets(credentials);
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: PROFILE_KEY, value: JSON.stringify(profile) });
      const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
      await SecureStoragePlugin.set({ key: SECRET_KEY, value: JSON.stringify(secrets) });
    } catch {
      // Outside the native shell there is nowhere to persist; the in-memory
      // copy still serves this session.
    }
  }

  private async wipe(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key: PROFILE_KEY });
    } catch {
      // already absent
    }
    try {
      const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
      await SecureStoragePlugin.remove({ key: SECRET_KEY });
    } catch {
      // already absent
    }
  }
}
