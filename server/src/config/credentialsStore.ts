import fs from 'node:fs';
import path from 'node:path';
import { configFile, ensureDir } from './appPaths.js';

export type JiraInstanceType = 'cloud' | 'datacenter';

export interface Credentials {
  email: string;
  jiraBaseUrl: string;
  jiraPat: string;
  instanceType: JiraInstanceType;
  defaultProjectKey: string;
}

/**
 * Plain-JSON credential store: %APPDATA%\JiraWeb\config.json (camelCase keys).
 * Path resolved lazily per call so JIRAWEB_DATA_DIR overrides apply; an
 * explicit filePath can also be injected for tests.
 */
export class CredentialsStore {
  constructor(private readonly filePath?: string) {}

  private get file(): string {
    return this.filePath ?? configFile();
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  load(): Credentials | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return null; // missing file
    }
    try {
      const parsed = JSON.parse(raw) as Partial<Credentials> | null;
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        email: typeof parsed.email === 'string' ? parsed.email : '',
        jiraBaseUrl: typeof parsed.jiraBaseUrl === 'string' ? parsed.jiraBaseUrl : '',
        jiraPat: typeof parsed.jiraPat === 'string' ? parsed.jiraPat : '',
        instanceType: parsed.instanceType === 'cloud' ? 'cloud' : 'datacenter',
        defaultProjectKey:
          typeof parsed.defaultProjectKey === 'string' && parsed.defaultProjectKey.trim().length > 0
            ? parsed.defaultProjectKey
            : 'ISW',
      };
    } catch {
      return null; // corrupt JSON
    }
  }

  save(credentials: Credentials): void {
    const file = this.file;
    ensureDir(path.dirname(file));
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(credentials, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}
