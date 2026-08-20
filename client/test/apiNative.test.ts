import { afterEach, describe, expect, it, vi } from 'vitest';
import { issues, onSessionLost, setNativeDispatch } from '../src/api/client';
import { trApi } from '../src/api/testrail';

afterEach(() => {
  setNativeDispatch(null);
  vi.restoreAllMocks();
});

describe('native dispatch mode', () => {
  it('routes a GET through the dispatcher instead of fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const dispatch = vi.fn(async () => ({ status: 200, body: { key: 'A-1' } }));
    setNativeDispatch(dispatch);

    await expect(issues.details('A-1')).resolves.toEqual({ key: 'A-1' });
    expect(dispatch).toHaveBeenCalledWith('GET', '/api/issues/A-1', undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes the body through as a value rather than a JSON string', async () => {
    const dispatch = vi.fn(async () => ({ status: 200, body: { items: [], total: 0 } }));
    setNativeDispatch(dispatch);

    await issues.search('project = X', 0, 50);
    expect(dispatch).toHaveBeenCalledWith('POST', '/api/issues/search', {
      jql: 'project = X',
      startAt: 0,
      maxResults: 50,
    });
  });

  it('throws ApiError carrying the dispatcher status and message', async () => {
    setNativeDispatch(async () => ({ status: 403, body: { message: 'Forbidden' } }));
    await expect(issues.details('A-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'Forbidden',
    });
  });

  it('falls back to a generic message when the error body carries none', async () => {
    setNativeDispatch(async () => ({ status: 500, body: {} }));
    await expect(issues.details('A-1')).rejects.toMatchObject({ message: 'Request failed (500)' });
  });

  it('resolves undefined for a 204', async () => {
    setNativeDispatch(async () => ({ status: 204, body: undefined }));
    await expect(issues.addComment('A-1', 'hi')).resolves.toBeUndefined();
  });

  it('emits session-lost on a 401, exactly as the HTTP path does', async () => {
    const seen = vi.fn();
    const off = onSessionLost(seen);
    setNativeDispatch(async () => ({ status: 401, body: { message: 'gone' } }));
    await expect(issues.details('A-1')).rejects.toMatchObject({ status: 401 });
    expect(seen).toHaveBeenCalledOnce();
    off();
  });

  it('carries query parameters through in the path', async () => {
    const dispatch = vi.fn(async () => ({ status: 200, body: [] }));
    setNativeDispatch(dispatch);
    await trApi.projects(true);
    expect(dispatch).toHaveBeenCalledWith('GET', '/api/testrail/projects?fresh=1', undefined);
  });

  it('shares the dispatcher with the TestRail client and preserves its error shape', async () => {
    setNativeDispatch(async () => ({
      status: 502,
      body: { error: 'TestRail said no', statusCode: 400, body: 'detail' },
    }));
    await expect(trApi.projects()).rejects.toMatchObject({
      name: 'TrApiError',
      status: 502,
      message: 'TestRail said no',
      trStatus: 400,
      body: 'detail',
    });
  });

  it('a TestRail 401 does not emit session-lost — that means TestRail, not Jira', async () => {
    const seen = vi.fn();
    const off = onSessionLost(seen);
    setNativeDispatch(async () => ({ status: 401, body: { error: 'Not connected to TestRail.' } }));
    await expect(trApi.projects()).rejects.toMatchObject({ status: 401 });
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('falls back to fetch when no dispatcher is installed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ key: 'A-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(issues.details('A-2')).resolves.toEqual({ key: 'A-2' });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('setNativeDispatch(null) restores HTTP mode', async () => {
    setNativeDispatch(async () => ({ status: 200, body: { key: 'native' } }));
    setNativeDispatch(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ key: 'http' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(issues.details('A-3')).resolves.toEqual({ key: 'http' });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
