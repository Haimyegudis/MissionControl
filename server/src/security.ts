// Local-API hardening. The server binds 127.0.0.1, but that alone leaves the
// API open to (a) any other process/user on the machine, (b) DNS-rebinding
// pages in the user's browser, and (c) cross-site request forgery. Defenses:
//   1. Host allow-list — kills DNS rebinding (attacker's hostname never
//      matches) on every request, static included.
//   2. Origin allow-list — a browser page from any other origin cannot call
//      /api even with simple no-preflight requests.
//   3. Bearer token on /api — random per-install token stored owner-only in
//      the data dir. The native launcher passes it in the URL fragment (which
//      is never sent to the server); the client exchanges it once for an
//      HttpOnly SameSite cookie at /api/bootstrap. Native callers read the
//      owner-only file and use the header directly.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'mc_token';
const HEADER_NAME = 'x-mc-token';

const HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i;
const ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i;

/** Restrict a file to the owning user (best-effort; NTFS only). */
export function restrictToOwner(filePath: string): boolean {
  try {
    const user = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (!user) return false;
    const result = spawnSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:F`], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

/** Load (or mint) the per-install API token, stored owner-only. */
export function loadOrCreateApiToken(dataDir: string): string {
  const file = path.join(dataDir, 'api-token');
  if (existsSync(file)) {
    try {
      const existing = readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9]{32,}$/i.test(existing)) {
        if (!restrictToOwner(file)) throw new Error('Could not secure the local API token file.');
        return existing;
      }
      rmSync(file, { force: true });
    } catch (error) {
      throw new Error('Could not securely read the local API token file.', { cause: error });
    }
  }
  const token = randomBytes(32).toString('hex');
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, token, { encoding: 'utf8', mode: 0o600 });
    if (!restrictToOwner(tmp)) throw new Error('Could not secure the local API token file.');
    renameSync(tmp, file);
    if (!restrictToOwner(file)) throw new Error('Could not secure the local API token file.');
  } catch (error) {
    rmSync(tmp, { force: true });
    rmSync(file, { force: true });
    throw new Error('Could not create a secure local API token.', { cause: error });
  }
  return token;
}

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Express middleware enforcing the three defenses. Mount FIRST. When `token`
 * is empty (unit tests) the auth check is skipped but Host/Origin still apply.
 */
export interface SecurityOptions {
  /** Production API port; Vite's 5173 proxy is also allowed for development. */
  apiPort?: number;
}

function portAllowed(match: RegExpMatchArray, token: string, apiPort: number): boolean {
  // Unit tests disable token auth and listen on ephemeral ports.
  if (!token) return true;
  const port = Number(match[2] || (match[0].startsWith('https:') ? 443 : 80));
  return port === apiPort || port === 5173;
}

function setSecurityHeaders(res: Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

export function securityMiddleware(token: string, options: SecurityOptions = {}) {
  const apiPort = options.apiPort ?? 5643;
  return (req: Request, res: Response, next: NextFunction): void => {
    setSecurityHeaders(res);
    if (!req.path.startsWith('/api')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; frame-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
      );
    }
    const host = req.headers.host ?? '';
    const hostMatch = host.match(HOST_RE);
    if (!hostMatch || !portAllowed(hostMatch, token, apiPort)) {
      res.status(403).json({ status: 403, message: 'Forbidden host' });
      return;
    }
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== '') {
      const originMatch = origin.match(ORIGIN_RE);
      if (!originMatch || !portAllowed(originMatch, token, apiPort)) {
        res.status(403).json({ status: 403, message: 'Forbidden origin' });
        return;
      }
    }

    // One-time browser bootstrap. Unlike the former static-GET bootstrap, an
    // arbitrary local process cannot obtain the token merely by requesting /.
    if (token && req.path === '/api/bootstrap') {
      const presented = req.headers[HEADER_NAME];
      if (req.method !== 'POST' || presented !== token) {
        res.status(401).json({ status: 401, message: 'Missing or invalid bootstrap token' });
        return;
      }
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
      );
      res.status(204).end();
      return;
    }

    if (token && req.path.startsWith('/api')) {
      const presented = req.headers[HEADER_NAME] ?? cookieValue(req, COOKIE_NAME);
      if (presented !== token) {
        res.status(401).json({ status: 401, message: 'Missing or invalid API token' });
        return;
      }
    }
    next();
  };
}
