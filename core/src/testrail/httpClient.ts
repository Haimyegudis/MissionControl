import type { TrConnection } from './types.js';
import { base64Utf8 } from '../base64.js';

/**
 * TestRail HTTP client (Phase 2 — unified-deck plan T6).
 * Port of TestRailClient.Configure/BuildApiBaseUrl/GetJsonAsync/PostJsonAsync
 * from C:\APPS\TestRailWeb\TestRail\TestRailClient.cs: Basic auth from
 * email:apiKey, base URL normalized to `…/index.php?/api/v2/`, JSON bodies,
 * 60 s default timeout (jira/httpClient.ts convention), and error translation
 * to TestRailApiError.
 */

/** Error surfaced for any non-2xx TestRail response (or a misconfigured URL). */
export class TestRailApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'TestRailApiError';
  }
}

/**
 * EXACT port of C# BuildApiBaseUrl: strip the path at '/index.php'
 * (case-insensitive; trailing slashes trimmed when absent), then
 * `${scheme}://${authority}${appPath}/index.php?/api/v2/`.
 */
export function buildApiBaseUrl(rawUrl: string): string {
  let uri: URL;
  try {
    uri = new URL(rawUrl.trim());
  } catch {
    throw new TestRailApiError('The TestRail URL is not valid.');
  }
  if (!['http:', 'https:'].includes(uri.protocol)) {
    throw new TestRailApiError('The TestRail URL must use HTTPS.');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(uri.hostname.toLowerCase());
  if (uri.protocol !== 'https:' && !loopback) {
    throw new TestRailApiError('The TestRail URL must use HTTPS (HTTP is allowed only for local development).');
  }
  const path = uri.pathname;
  const indexPath = path.toLowerCase().indexOf('/index.php');
  let applicationPath = indexPath >= 0 ? path.slice(0, indexPath) : path.replace(/\/+$/, '');
  if (applicationPath === '/') applicationPath = '';
  const scheme = uri.protocol.replace(/:$/, '');
  // URL.host mirrors Uri.Authority: host plus non-default port.
  return `${scheme}://${uri.host}${applicationPath}/index.php?/api/v2/`;
}

export class TestRailHttp {
  private readonly apiBaseUrl: string;
  private readonly authorization: string;

  constructor(
    connection: TrConnection,
    private readonly timeoutMs: number = 60_000,
  ) {
    this.apiBaseUrl = buildApiBaseUrl(connection.baseUrl);
    const token = base64Utf8(`${connection.email}:${connection.apiKey}`);
    this.authorization = `Basic ${token}`;
  }

  /** GET `…/index.php?/api/v2/{cmd}` → parsed JSON (null for an empty body). */
  getJson(cmd: string): Promise<any> {
    return this.request(cmd);
  }

  /** POST `…/index.php?/api/v2/{cmd}` → parsed JSON ({} for an empty body). */
  postJson(cmd: string, body: unknown): Promise<any> {
    return this.request(cmd, body);
  }

  private async request(cmd: string, payload?: unknown): Promise<any> {
    // The base already carries `?/api/v2/` — commands append with plain
    // concatenation (they may hold their own `&param=value` pairs).
    const url = this.apiBaseUrl + cmd;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authorization,
    };

    let body: string | undefined;
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(payload);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: body !== undefined ? 'POST' : 'GET',
        headers,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TestRailApiError(`TestRail request timed out after ${this.timeoutMs} ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new TestRailApiError(
        `TestRail returned ${response.status} ${response.statusText}.`,
        response.status,
        text,
      );
    }

    if (text.trim().length === 0) return payload !== undefined ? {} : null;
    return JSON.parse(text);
  }
}
