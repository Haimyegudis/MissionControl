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

/**
 * A lapsed SAML session does not answer with a clean 401: TestRail serves the
 * HTML login page with a 200, or redirects to it. Either way the body is not
 * JSON, which is what distinguishes "signed out" from a real API error.
 */
function looksSignedOut(status: number, text: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status >= 300 && status < 400) return true;
  return text.trimStart().startsWith('<');
}

export class TestRailHttp {
  private readonly apiBaseUrl: string;
  private readonly authorization: string;
  private readonly cookieAuth: boolean;
  /** Set once the cookie is seen to be dead, so we stop paying for the retry. */
  private cookieExpired = false;

  constructor(
    connection: TrConnection,
    private readonly timeoutMs: number = 60_000,
  ) {
    this.apiBaseUrl = buildApiBaseUrl(connection.baseUrl);
    const token = base64Utf8(`${connection.email}:${connection.apiKey}`);
    this.authorization = `Basic ${token}`;
    // Only worth trying the cookie when a key exists to fall back to, or when
    // there is no key at all and the cookie is the sole credential.
    this.cookieAuth = connection.cookieAuth === true;
  }

  /** True when the API key is the only thing that can authenticate a request. */
  private get hasKey(): boolean {
    return !this.authorization.endsWith(base64Utf8(':'));
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
    const useCookie = this.cookieAuth && !this.cookieExpired;
    if (useCookie) {
      const viaCookie = await this.attempt(cmd, payload, false);
      if (!viaCookie.signedOut) return this.parse(viaCookie, payload);
      // The session died. Remember it, and let the stored key carry the call
      // so a background refresh does not surface an error the user must fix.
      this.cookieExpired = true;
      if (!this.hasKey) return this.parse(viaCookie, payload);
    }
    return this.parse(await this.attempt(cmd, payload, true), payload);
  }

  private parse(r: { status: number; statusText: string; text: string; ok: boolean }, payload?: unknown): any {
    if (!r.ok) {
      throw new TestRailApiError(`TestRail returned ${r.status} ${r.statusText}.`, r.status, r.text);
    }
    if (r.text.trim().length === 0) return payload !== undefined ? {} : null;
    return JSON.parse(r.text);
  }

  private async attempt(
    cmd: string,
    payload: unknown,
    withAuthHeader: boolean,
  ): Promise<{ status: number; statusText: string; text: string; ok: boolean; signedOut: boolean }> {
    // The base already carries `?/api/v2/` — commands append with plain
    // concatenation (they may hold their own `&param=value` pairs).
    const url = this.apiBaseUrl + cmd;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (withAuthHeader) headers.Authorization = this.authorization;

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
    return {
      status: response.status,
      statusText: response.statusText,
      text,
      ok: response.ok,
      signedOut: looksSignedOut(response.status, text),
    };
  }
}
