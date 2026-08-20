import express from 'express';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { securityMiddleware } from '../src/security.js';

const TOKEN = 'a'.repeat(64);
let server: Server | null = null;
let activePort = 0;

async function start(): Promise<string> {
  const app = express();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  activePort = (server.address() as AddressInfo).port;
  app.use(securityMiddleware(TOKEN, { apiPort: activePort }));
  app.get('/', (_req, res) => res.type('html').send('<!doctype html>'));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  return `http://127.0.0.1:${activePort}`;
}

function localHeaders(extra: Record<string, string> = {}): HeadersInit {
  return { Origin: `http://127.0.0.1:${activePort}`, ...extra };
}

async function requestStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = request(url, { headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    req.once('error', reject);
    req.end();
  });
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe('local API security middleware', () => {
  it('does not disclose the API token on a static request', async () => {
    const base = await start();
    const response = await fetch(`${base}/`, { headers: localHeaders() });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('exchanges the launcher token for an HttpOnly strict cookie', async () => {
    const base = await start();
    const denied = await fetch(`${base}/api/bootstrap`, {
      method: 'POST',
      headers: localHeaders({ 'x-mc-token': 'wrong' }),
    });
    expect(denied.status).toBe(401);

    const response = await fetch(`${base}/api/bootstrap`, {
      method: 'POST',
      headers: localHeaders({ 'x-mc-token': TOKEN }),
    });
    expect(response.status).toBe(204);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`mc_token=${TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const authenticated = await fetch(`${base}/api/ping`, {
      headers: localHeaders({ Cookie: `mc_token=${TOKEN}` }),
    });
    expect(authenticated.status).toBe(200);
  });

  it('rejects untrusted hosts and origins', async () => {
    const base = await start();
    const badOrigin = await fetch(`${base}/api/ping`, {
      headers: { Origin: 'https://attacker.example', 'x-mc-token': TOKEN },
    });
    expect(badOrigin.status).toBe(403);

    const badHost = await requestStatus(`${base}/api/ping`, {
      Host: 'attacker.example',
      'x-mc-token': TOKEN,
    });
    expect(badHost).toBe(403);
  });
});
