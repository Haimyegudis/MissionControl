// Local-API hardening. The server binds 127.0.0.1, but that alone leaves the
// API open to (a) any other process/user on the machine, (b) DNS-rebinding
// pages in the user's browser, and (c) cross-site request forgery. Defenses:
//   1. Host allow-list — kills DNS rebinding (attacker's hostname never
//      matches) on every request, static included.
//   2. Origin allow-list — a browser page from any other origin cannot call
//      /api even with simple no-preflight requests.
//   3. Bearer token on /api — random per-install token stored owner-only in
//      the data dir; the browser gets it as a SameSite=Strict cookie when the
//      app shell is served, native callers (toast scripts) read the file.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'mc_token';
const HEADER_NAME = 'x-mc-token';

const HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** Restrict a file to the owning user (best-effort; NTFS only). */
export function restrictToOwner(filePath: string): void {
  try {
    const user = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (!user) return;
    spawnSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:F`], { windowsHide: true });
  } catch {
    /* ACL tightening is best-effort */
  }
}

/** Load (or mint) the per-install API token, stored owner-only. */
export function loadOrCreateApiToken(dataDir: string): string {
  const file = path.join(dataDir, 'api-token');
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9]{32,}$/i.test(existing)) return existing;
    }
  } catch {
    /* fall through to mint */
  }
  const token = randomBytes(32).toString('hex');
  try {
    writeFileSync(file, token, 'utf8');
    restrictToOwner(file);
  } catch {
    /* in-memory token still protects this run */
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
export function securityMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = req.headers.host ?? '';
    if (!HOST_RE.test(host)) {
      res.status(403).json({ status: 403, message: 'Forbidden host' });
      return;
    }
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== '' && !ORIGIN_RE.test(origin)) {
      res.status(403).json({ status: 403, message: 'Forbidden origin' });
      return;
    }

    // Browser bootstrap: any non-API GET (the app shell / static assets)
    // refreshes the token cookie. SameSite=Strict keeps it first-party only.
    if (token && req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; SameSite=Strict`);
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
