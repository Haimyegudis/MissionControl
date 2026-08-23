// Credential store for the Android shell. Tokens stay out of Preferences;
// they live in AES-GCM Android Keystore storage and enter memory only after a
// successful app unlock.

import type { Credentials, CredentialsPort } from '@mc/core';
import { secureGet, secureRemove, secureSet } from './secureStorage';

export type CredentialProfile = Omit<Credentials, 'jiraPat' | 'testRailApiKey' | 'confluencePat'>;

export interface CredentialSecrets extends Record<string, unknown> {
  jiraPat: string;
  testRailApiKey: string;
  confluencePat: string;
}

const PROFILE_KEY = 'mc.credentials.profile';
const SECRET_KEY = 'mc.credentials.secrets';

export function splitSecrets(c: Credentials): { profile: CredentialProfile; secrets: CredentialSecrets } {
  const { jiraPat, testRailApiKey, confluencePat, ...profile } = c;
  return { profile, secrets: { jiraPat, testRailApiKey, confluencePat } };
}

export function mergeSecrets(
  profile: CredentialProfile,
  secrets: Partial<CredentialSecrets> | null,
  legacyConfluencePat = '',
): Credentials {
  return {
    ...profile,
    jiraPat: secrets?.jiraPat ?? '',
    testRailApiKey: secrets?.testRailApiKey ?? '',
    confluencePat: secrets?.confluencePat ?? legacyConfluencePat,
  };
}

export class KeystoreCredentials implements CredentialsPort {
  private cached: Credentials | null = null;
  private pending: Promise<void> = Promise.resolve();

  /** Read both halves into memory. Call only after a successful unlock. */
  async hydrate(): Promise<void> {
    let profile: CredentialProfile;
    let legacyConfluencePat = '';
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: PROFILE_KEY });
      if (!value) return;
      const parsed = JSON.parse(value) as CredentialProfile & { confluencePat?: string };
      legacyConfluencePat = parsed.confluencePat ?? '';
      const { confluencePat: _legacy, ...safeProfile } = parsed;
      profile = safeProfile;
    } catch {
      return; // no profile stored, or not running in the native shell
    }

    const secrets = await secureGet<Partial<CredentialSecrets>>(SECRET_KEY);

    this.cached = mergeSecrets(profile, secrets, legacyConfluencePat);
    // Remove a Confluence PAT left in Preferences by an older build. It is
    // copied into the secure half once, then the profile is rewritten safely.
    if (legacyConfluencePat) await this.persist(this.cached);
  }

  load(): Credentials | null {
    return this.cached;
  }

  save(credentials: Credentials): void {
    this.cached = credentials;
    this.pending = this.pending.then(() => this.persist(credentials));
  }

  clear(): void {
    this.cached = null;
    this.pending = this.pending.then(() => this.wipe());
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private async persist(credentials: Credentials): Promise<void> {
    const { profile, secrets } = splitSecrets(credentials);
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: PROFILE_KEY, value: JSON.stringify(profile) });
      await secureSet(SECRET_KEY, secrets);
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
      await secureRemove(SECRET_KEY);
    } catch {
      // already absent
    }
  }
}
