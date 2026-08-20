import type { Credentials, JiraInstanceType } from '../config/credentialsStore.js';
import type { JiraSession } from './session.js';

/**
 * Jira HTTP client (jira-rest-layer.md §1).
 * Base URL normalization, api-version prefix by instance type, auth headers,
 * 60 s default timeout, JSON bodies, and error translation.
 */

/** Error surfaced for any non-2xx Jira response. */
export class JiraError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

/** 'cloud' → rest/api/3, 'datacenter' → rest/api/2. */
export function apiPrefix(instanceType: JiraInstanceType): string {
  return instanceType === 'cloud' ? 'rest/api/3' : 'rest/api/2';
}

/** Agile REST prefix (greenhopper paths are hardcoded elsewhere). */
export function agilePrefix(): string {
  return 'rest/agile/1.0';
}

/** Trim and ensure a single trailing slash so relative paths resolve under it. */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new JiraError(400, 'Enter a valid Jira Base URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new JiraError(400, 'Jira Base URL must use HTTPS.');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new JiraError(400, 'Jira Base URL must use HTTPS (HTTP is allowed only for local development).');
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Extract a human-readable message from a Jira 400 body:
 * join `errorMessages[]` strings plus `errors` object entries as
 * "{name}: {value}", separated by newlines. Null when nothing usable.
 */
export function extractErrorMessage(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(obj.errorMessages)) {
    for (const m of obj.errorMessages) {
      if (typeof m === 'string' && m.trim().length > 0) parts.push(m);
    }
  }
  if (obj.errors !== null && typeof obj.errors === 'object' && !Array.isArray(obj.errors)) {
    for (const [name, value] of Object.entries(obj.errors as Record<string, unknown>)) {
      parts.push(`${name}: ${String(value)}`);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function authHeader(profile: Credentials): string {
  if (profile.instanceType === 'cloud') {
    const token = Buffer.from(`${profile.email}:${profile.jiraPat}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }
  return `Bearer ${profile.jiraPat}`;
}

export interface JiraFetchOptions {
  method?: string;
  /** JSON-serializable body (objects are stringified; strings passed through). */
  body?: unknown;
  /** Query-string parameters; undefined/null entries are skipped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Defaults to 60 000 ms. */
  timeoutMs?: number;
}

/**
 * Perform a Jira REST request relative to the session's base URL.
 * Returns parsed JSON (null for an empty body). Throws:
 * - Error("No active Jira session.") when the session is incomplete;
 * - JiraError{status,message} for non-2xx responses per §1 error translation.
 */
export async function jiraFetch(
  session: JiraSession,
  path: string,
  opts: JiraFetchOptions = {},
): Promise<any> {
  const profile = session.profile;
  if (!profile || profile.jiraPat.trim().length === 0 || profile.jiraBaseUrl.trim().length === 0) {
    throw new Error('No active Jira session.');
  }

  const base = normalizeBaseUrl(profile.jiraBaseUrl);
  const relative = path.replace(/^\/+/, '');
  const url = new URL(relative, base);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: authHeader(profile),
  };

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Jira request timed out after ${timeoutMs} ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new JiraError(status, 'You do not have permission to view this Jira resource.');
    }
    if (status === 400) {
      throw new JiraError(status, extractErrorMessage(text) ?? 'Bad request.');
    }
    throw new JiraError(status, `Jira request failed: ${status} ${response.statusText}`);
  }

  const text = await response.text();
  if (text.length === 0) return null;
  return JSON.parse(text);
}
