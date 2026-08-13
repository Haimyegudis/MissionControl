// /api/copilot — in-app GitHub Copilot CLI login (device flow) so Lumo can be
// used without a manual terminal session.
// POST /login starts `copilot login`, scrapes the one-time code + device URL
// from its output and auto-answers the "press Enter" prompt; GET /login/state
// polls progress; GET /status reports whether the CLI already has credentials.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { resolveCopilotExe } from '../ai/cliRunner.js';

interface LoginState {
  active: boolean;
  code: string | null;
  url: string | null;
  done: boolean;
  error: string | null;
}

const state: LoginState = { active: false, code: null, url: null, done: false, error: null };
let child: ChildProcess | null = null;

function copilotAuthFileExists(): boolean {
  const local = process.env.LOCALAPPDATA ?? '';
  const home = process.env.USERPROFILE ?? '';
  const candidates = [
    path.join(local, 'github-copilot', 'apps.json'),
    path.join(local, 'github-copilot', 'hosts.json'),
    path.join(home, '.config', 'github-copilot', 'apps.json'),
    path.join(home, '.config', 'github-copilot', 'hosts.json'),
    path.join(home, '.copilot', 'config.json'),
  ];
  return candidates.some((c) => c && existsSync(c));
}

export function copilotAuthRoutes(): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({ loggedIn: copilotAuthFileExists(), loginActive: state.active });
  });

  router.get('/login/state', (_req, res) => {
    res.json(state);
  });

  router.post('/login', (_req, res) => {
    if (state.active) {
      res.json(state);
      return;
    }
    let exe: string;
    try {
      exe = resolveCopilotExe();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    state.active = true;
    state.code = null;
    state.url = null;
    state.done = false;
    state.error = null;

    const isBatch = /\.(cmd|bat)$/i.test(exe);
    child = isBatch
      ? spawn(`"${exe}" login`, { windowsHide: true, shell: true })
      : spawn(exe, ['login'], { windowsHide: true });

    let buffer = '';
    let entered = false;
    const onChunk = (chunk: string) => {
      buffer += chunk;
      const codeMatch = buffer.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
      if (codeMatch) state.code = codeMatch[1];
      const urlMatch = buffer.match(/https?:\/\/\S*github\.com\/login\/device\S*/i);
      if (urlMatch) state.url = urlMatch[0].replace(/[.,)]+$/, '');
      else if (/github\.com\/login\/device/i.test(buffer) && !state.url) state.url = 'https://github.com/login/device';
      // Auto-answer any "press Enter" style prompt once the code is visible.
      if (state.code && !entered) {
        entered = true;
        try {
          child?.stdin?.write('\n');
        } catch {
          /* stdin may be closed */
        }
      }
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.stdin?.on('error', () => {});
    child.on('error', (err) => {
      state.active = false;
      state.error = `Failed to start copilot login: ${err.message}`;
    });
    child.on('exit', (code) => {
      state.active = false;
      state.done = code === 0;
      if (code !== 0 && !state.error) {
        state.error = `copilot login exited ${code}. ${buffer.slice(-300).trim()}`;
      }
      child = null;
    });

    // Safety: kill a stuck login after 10 minutes.
    setTimeout(() => {
      if (child) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
    }, 10 * 60 * 1000).unref();

    res.json(state);
  });

  return router;
}
