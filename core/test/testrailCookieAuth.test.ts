// Cookie-first authentication with API-key fallback.
//
// The phone signs in through HP OneUID and rides the SAML cookie. That cookie
// dies after a few hours, and when it does a background refresh must keep
// working off the stored key rather than surfacing an error.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { TestRailHttp } from '../src/testrail/httpClient.js';

const BASE = 'https://hp-testrail.external.hp.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** TestRail answers a dead session with its HTML login page, not a 401. */
function loginPageResponse(): Response {
  return new Response('<!DOCTYPE html><html><body>Sign in</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function authOf(call: unknown[]): string | undefined {
  const init = call[1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

afterEach(() => vi.unstubAllGlobals());

describe('TestRail cookie authentication', () => {
  it('sends no Authorization header while the cookie is good', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    const http = new TestRailHttp({ baseUrl: BASE, email: 'a@hp.com', apiKey: 'key', cookieAuth: true });
    await http.getJson('get_projects');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authOf(fetchMock.mock.calls[0])).toBeUndefined();
  });

  it('replays on the stored key once the cookie expires', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPageResponse())
      .mockResolvedValue(jsonResponse([{ id: 7 }]));
    vi.stubGlobal('fetch', fetchMock);

    const http = new TestRailHttp({ baseUrl: BASE, email: 'a@hp.com', apiKey: 'key', cookieAuth: true });
    expect(await http.getJson('get_projects')).toEqual([{ id: 7 }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[0])).toBeUndefined();
    expect(authOf(fetchMock.mock.calls[1])).toMatch(/^Basic /);
  });

  it('stops retrying the dead cookie on later calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPageResponse())
      .mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const http = new TestRailHttp({ baseUrl: BASE, email: 'a@hp.com', apiKey: 'key', cookieAuth: true });
    await http.getJson('get_projects');
    await http.getJson('get_projects');

    // 2 for the first call (cookie, then key) + 1 for the second, which goes
    // straight to the key rather than paying for a doomed attempt again.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authOf(fetchMock.mock.calls[2])).toMatch(/^Basic /);
  });

  it('keeps sending the key when cookie auth was never enabled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    // This is the desktop's path: behaviour must be untouched by the new mode.
    const http = new TestRailHttp({ baseUrl: BASE, email: 'a@hp.com', apiKey: 'key' });
    await http.getJson('get_projects');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authOf(fetchMock.mock.calls[0])).toMatch(/^Basic /);
  });
});
