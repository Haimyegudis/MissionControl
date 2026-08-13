// /api/lumo/ask — SSE stream over the Lumo agent loop (Task A7/A8).
// Events: `status` {status}, terminal `result` {summary,cards} or `error`
// {message}; the stream always ends after the terminal event.

import { Router } from 'express';
import type { Response } from 'express';
import type { LumoTurn } from '../ai/lumoAgent.js';
import { defaultProjectKey, type AppDeps } from './deps.js';

function parseTurns(raw: unknown): LumoTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: LumoTurn[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const rec = el as Record<string, unknown>;
    const role = rec.role;
    // The client sends {role, text}; accept legacy/alternate {role, content} too.
    const content = typeof rec.content === 'string' ? rec.content : rec.text;
    if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
      out.push({ role, content });
    }
  }
  return out;
}

function sseSend(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function lumoRoutes(deps: AppDeps): Router {
  const router = Router();

  // Cluster picker data for the Lumo context bar (Yaki-style drill-down).
  router.get('/clusters', async (req, res) => {
    try {
      const program = typeof req.query.program === 'string' ? req.query.program : 'kedem';
      const mod = await import('../ai/yaki/configControl.js');
      res.json(mod.listConfigClusters({ program }));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/ask', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // The client sends `messages`; `turns` is accepted as an alias.
    const turns = parseTurns(body.messages ?? body.turns);
    const projectKey =
      typeof body.projectKey === 'string' && body.projectKey.trim().length > 0
        ? body.projectKey.trim()
        : defaultProjectKey(deps);
    let model = typeof body.model === 'string' && body.model.trim().length > 0 ? body.model.trim() : '';
    if (!model) {
      try {
        model = deps.repos.appSettings.get().aiModel ?? '';
      } catch {
        // fall through to the hard default
      }
    }
    // Legacy stored defaults (pre-Sonnet-5) are coerced to the current default.
    const LEGACY_MODELS = new Set(['gpt-4o-mini', 'gpt-4.1', 'claude-sonnet-4.6', 'claude-sonnet-4-5']);
    if (!model || LEGACY_MODELS.has(model)) model = 'claude-sonnet-5[1m]';

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    void deps
      .askLumo({
        turns,
        projectKey,
        model,
        onStatus: (status) => sseSend(res, 'status', { status }),
        signal: abort.signal,
      })
      .then((result) => sseSend(res, 'result', result))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        sseSend(res, 'error', { message });
      })
      .finally(() => res.end());
  });

  return router;
}
