import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { restrictToOwner } from '../security.js';
import { configFile, ensureDir } from './appPaths.js';

export type JiraInstanceType = 'cloud' | 'datacenter';

export interface Credentials {
  email: string;
  jiraBaseUrl: string;
  jiraPat: string;
  instanceType: JiraInstanceType;
  defaultProjectKey: string;
  testRailBaseUrl: string;
  testRailEmail: string;
  testRailApiKey: string;
  confluenceBaseUrl: string;
  confluencePat: string;
}

interface ProtectedSecrets {
  jiraPat: string;
  testRailApiKey: string;
  confluencePat: string;
}

interface StoredCredentials extends Omit<Credentials, keyof ProtectedSecrets> {
  /** Windows DPAPI CurrentUser ciphertext containing all three secret fields. */
  protectedSecrets?: string;
  /** Legacy plaintext fields are read only for one-time migration. */
  jiraPat?: string;
  testRailApiKey?: string;
  confluencePat?: string;
}

const DPAPI_PROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$cipher = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($cipher))
`;

const DPAPI_UNPROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$encoded = [Console]::In.ReadToEnd().Trim()
$cipher = [Convert]::FromBase64String($encoded)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
`;

function runDpapi(script: string, input: string): string {
  if (process.platform !== 'win32') {
    throw new Error('Secure credential storage requires Windows DPAPI.');
  }
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw result.error ?? new Error(result.stderr.trim() || `DPAPI exited ${result.status}`);
  }
  return result.stdout.trim();
}

export function protectSecrets(value: ProtectedSecrets): string {
  return runDpapi(DPAPI_PROTECT, JSON.stringify(value));
}

export function unprotectSecrets(ciphertext: string): ProtectedSecrets {
  const parsed = JSON.parse(runDpapi(DPAPI_UNPROTECT, ciphertext)) as Partial<ProtectedSecrets>;
  return {
    jiraPat: typeof parsed.jiraPat === 'string' ? parsed.jiraPat : '',
    testRailApiKey: typeof parsed.testRailApiKey === 'string' ? parsed.testRailApiKey : '',
    confluencePat: typeof parsed.confluencePat === 'string' ? parsed.confluencePat : '',
  };
}

/**
 * Credential store: non-secret profile data stays as JSON while PAT/API-key
 * fields are one Windows DPAPI CurrentUser ciphertext. Legacy plaintext JSON
 * is migrated on first successful load.
 * Path resolved lazily per call so JIRAWEB_DATA_DIR overrides apply; an
 * explicit filePath can also be injected for tests.
 */
export class CredentialsStore {
  private cached: { mtimeMs: number; value: Credentials; protectedSecrets: string } | null = null;

  constructor(private readonly filePath?: string) {}

  private get file(): string {
    return this.filePath ?? configFile();
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  load(): Credentials | null {
    try {
      const mtimeMs = fs.statSync(this.file).mtimeMs;
      if (this.cached?.mtimeMs === mtimeMs) return structuredClone(this.cached.value);
    } catch {
      this.cached = null;
      return null;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return null; // missing file
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredCredentials> | null;
      if (!parsed || typeof parsed !== 'object') return null;
      const hasProtected = typeof parsed.protectedSecrets === 'string' && parsed.protectedSecrets.length > 0;
      const secrets = hasProtected
        ? unprotectSecrets(parsed.protectedSecrets!)
        : {
            jiraPat: typeof parsed.jiraPat === 'string' ? parsed.jiraPat : '',
            testRailApiKey: typeof parsed.testRailApiKey === 'string' ? parsed.testRailApiKey : '',
            confluencePat: typeof parsed.confluencePat === 'string' ? parsed.confluencePat : '',
          };
      const credentials: Credentials = {
        email: typeof parsed.email === 'string' ? parsed.email : '',
        jiraBaseUrl: typeof parsed.jiraBaseUrl === 'string' ? parsed.jiraBaseUrl : '',
        jiraPat: secrets.jiraPat,
        instanceType: parsed.instanceType === 'cloud' ? 'cloud' : 'datacenter',
        defaultProjectKey:
          typeof parsed.defaultProjectKey === 'string' && parsed.defaultProjectKey.trim().length > 0
            ? parsed.defaultProjectKey
            : 'ISW',
        testRailBaseUrl: typeof parsed.testRailBaseUrl === 'string' ? parsed.testRailBaseUrl : '',
        testRailEmail: typeof parsed.testRailEmail === 'string' ? parsed.testRailEmail : '',
        testRailApiKey: secrets.testRailApiKey,
        confluenceBaseUrl: typeof parsed.confluenceBaseUrl === 'string' ? parsed.confluenceBaseUrl : '',
        confluencePat: secrets.confluencePat,
      };
      if (!hasProtected && (secrets.jiraPat || secrets.testRailApiKey || secrets.confluencePat)) {
        // Do not activate plaintext legacy secrets unless migration to DPAPI
        // succeeds. A failure leaves the source file intact for recovery.
        this.save(credentials);
        return credentials;
      }
      try {
        this.cached = {
          mtimeMs: fs.statSync(this.file).mtimeMs,
          value: structuredClone(credentials),
          protectedSecrets: hasProtected ? parsed.protectedSecrets! : '',
        };
      } catch {
        this.cached = null;
      }
      return credentials;
    } catch {
      return null; // corrupt JSON
    }
  }

  save(credentials: Credentials): void {
    const file = this.file;
    ensureDir(path.dirname(file));
    const tmp = `${file}.tmp`;
    const { jiraPat, testRailApiKey, confluencePat, ...profile } = credentials;
    const previous = this.cached?.value;
    const protectedSecrets = previous
      && previous.jiraPat === jiraPat
      && previous.testRailApiKey === testRailApiKey
      && previous.confluencePat === confluencePat
      && this.cached!.protectedSecrets
      ? this.cached!.protectedSecrets
      : protectSecrets({ jiraPat, testRailApiKey, confluencePat });
    const stored: StoredCredentials = {
      ...profile,
      protectedSecrets,
    };
    fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    // Ciphertext and identity metadata are still owner-only.
    if (!restrictToOwner(file)) {
      throw new Error('Could not restrict the credential file to the current Windows user.');
    }
    this.cached = {
      mtimeMs: fs.statSync(file).mtimeMs,
      value: structuredClone(credentials),
      protectedSecrets,
    };
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
    this.cached = null;
  }
}
