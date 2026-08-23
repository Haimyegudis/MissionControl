import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSession, issues, onSessionLost, setBootstrapToken } from '../src/api/client';

const TOKEN_401 = JSON.stringify({ status: 401, message: 'Missing or invalid API token' });
const JIRA_401 = JSON.stringify({ status: 401, message: 'You do not have permission.' });

function json(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  setBootstrapToken(null);
  vi.restoreAllMocks();
});

describe('local API token bootstrap', () => {
  it('presents the remembered launcher token when exchanging it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    setBootstrapToken('deadbeef');

    await expect(bootstrapSession()).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('/api/bootstrap', {
      method: 'POST',
      headers: { 'x-mc-token': 'deadbeef' },
    });
  });

  it('reports failure rather than throwing when the server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(bootstrapSession()).resolves.toBe(false);
  });

  it('re-exchanges the token and replays the call once on a token 401', async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/bootstrap') return new Response(null, { status: 204 });
      calls += 1;
      return calls === 1 ? json(TOKEN_401, 401) : json(JSON.stringify({ key: 'A-1' }), 200);
    });
    const lost = vi.fn();
    const off = onSessionLost(lost);

    await expect(issues.details('A-1')).resolves.toEqual({ key: 'A-1' });
    expect(calls).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(lost).not.toHaveBeenCalled();
    off();
  });

  it('gives up after one retry when the gate keeps refusing', async () => {
    let bootstraps = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/bootstrap') {
        bootstraps += 1;
        return new Response(null, { status: 204 });
      }
      return json(TOKEN_401, 401);
    });
    const lost = vi.fn();
    const off = onSessionLost(lost);

    await expect(issues.details('A-1')).rejects.toMatchObject({ status: 401 });
    expect(bootstraps).toBe(1);
    expect(lost).toHaveBeenCalledTimes(1);
    off();
  });

  it('treats a Jira 401 as a lost session without touching the token exchange', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(JIRA_401, 401));
    const lost = vi.fn();
    const off = onSessionLost(lost);

    await expect(issues.details('A-1')).rejects.toMatchObject({
      status: 401,
      message: 'You do not have permission.',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
    off();
  });
});
