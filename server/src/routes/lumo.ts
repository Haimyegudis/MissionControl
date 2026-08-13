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

  // Deterministic cluster report — no LLM round-trips, answers in seconds.
  // Release-notes fetches are cached in-memory for 10 minutes.
  const relCache = new Map<string, { at: number; data: any }>();
  const REL_TTL_MS = 10 * 60 * 1000;

  router.get('/cluster-report', async (req, res) => {
    try {
      const program = String(req.query.program || 'kedem').toLowerCase();
      const cluster = String(req.query.cluster || '').trim().toUpperCase();
      const scope = String(req.query.scope || 'ALL').toUpperCase();
      if (!cluster) {
        res.status(400).json({ error: 'cluster required' });
        return;
      }

      const parts: string[] = [];
      const cards: Array<Record<string, unknown>> = [];

      if (scope === 'HW' || scope === 'ALL') {
        const cc = await import('../ai/yaki/configControl.js');
        const hw = cc.searchConfigControl({ program, cluster, limit: 500 }) as Record<string, any>;
        if (hw.error) {
          parts.push(`**HW (Config Control):** ${hw.error}`);
        } else {
          const rows: Array<Record<string, any>> = hw.rows ?? [];
          const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim() || '—';
          parts.push(`**HW CHANGES (CONFIG CONTROL) — ${program} ${cluster}: ${rows.length} rows**`);
          if (rows.length) {
            parts.push('| NO. | IPRG | Feature | WTL | LP1 | LP2 | LP3 | LP4 | Remarks |');
            parts.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
            for (const r of rows) {
              parts.push(
                `| ${cell(r['NO.'])} | ${cell(r['ID'])} | ${cell(r['Feature name'])} | ${cell(r['WTL'])} | ${cell(r['LP1'])} | ${cell(r['LP2'])} | ${cell(r['LP3'])} | ${cell(r['LP4'])} | ${cell(r['Remarks'])} |`,
              );
            }
          }
        }
      }

      if ((scope === 'SW' || scope === 'ALL') && program === 'kedem') {
        const key = `rel:${cluster}`;
        const hit = relCache.get(key);
        let rel: Record<string, any>;
        if (hit && Date.now() - hit.at < REL_TTL_MS) {
          rel = hit.data;
        } else {
          const cf = await import('../ai/yaki/confluence.js');
          rel = (await cf.getClusterReleaseNotes({ cluster })) as Record<string, any>;
          if (!rel.error) relCache.set(key, { at: Date.now(), data: rel });
        }
        if (rel.error) {
          parts.push(`\n**SW (Release Notes):** ${rel.error}`);
        } else {
          const features: Array<Record<string, any>> = rel.features ?? [];
          const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim() || '—';
          parts.push(`\n**SW RELEASE NOTES — ${cluster}: ${features.length} features** ([${cell(rel.title)}](${rel.url}))`);
          if (features.length) {
            parts.push('| Key | Summary | Assignee | Resolution |');
            parts.push('| --- | --- | --- | --- |');
            for (const f of features) {
              parts.push(`| ${cell(f.key)} | ${cell(f.summary)} | ${cell(f.assignee)} | ${cell(f.resolution)} |`);
            }
          }
          if (rel.url) {
            cards.push({
              source: 'confluence',
              title: String(rel.title ?? `Release notes for ${cluster}`),
              url: String(rel.url),
              summary: `SW release notes page for ${cluster} (${features.length} features).`,
              fields: {},
            });
          }
        }
      } else if ((scope === 'SW' || scope === 'ALL') && program !== 'kedem') {
        parts.push(`\n**SW (Release Notes):** available for KEDEM clusters only.`);
      }

      res.json({ summary: parts.join('\n'), cards });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

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

  // ---- fast intents: answered in ~1-2s without any LLM round-trip ----------

  /** "find/get/show ... doc|document|swr|מסמך" → direct vector search. */
  function docIntentQuery(text: string): string | null {
    const t = text.trim();
    if (t.length > 160) return null;
    const docWord = /(docs?|documents?|swr|מסמך|מסמכים|דוקומנט)/i;
    if (!docWord.test(t)) return null;
    const cleaned = t
      .replace(/^(please|can you|could you|find|get|show|open|bring|fetch|search( for)?|תמצא|תביא|תפתח|חפש)\s+/gi, '')
      .replace(/\b(the|me|a|an|of|for|את|לי|של)\b/gi, ' ')
      .replace(docWord, ' ')
      .replace(/[?.!]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 2 ? cleaned : null;
  }

  async function tryFastIntent(text: string): Promise<{ summary: string; cards: unknown[] } | null> {
    const q = docIntentQuery(text);
    if (!q) return null;
    try {
      const vec = await import('../ai/yaki/vectors.js');
      const result = (await vec.searchConfluenceVectors({ query: q })) as unknown;
      const hits: Array<Record<string, any>> = Array.isArray(result)
        ? (result as Array<Record<string, any>>)
        : Array.isArray((result as Record<string, any>)?.results)
          ? (result as Record<string, any>).results
          : [];
      if (!hits.length) return null; // fall through to the LLM
      const top = hits.slice(0, 6);
      const cards = top.map((h) => ({
        source: 'confluence',
        title: String(h.title ?? 'Untitled'),
        url: h.sectionUrl || h.url || null,
        summary: `${h.folder ? `${h.folder} · ` : ''}similarity ${h.similarity ?? ''}`,
        fields: {},
      }));
      const lines = top.map(
        (h, i) => `${i + 1}. [${String(h.title ?? 'Untitled')}](${h.url ?? '#'})${h.section ? ` — ${h.section}` : ''}`,
      );
      return { summary: `**Top documents for "${q}":**\n${lines.join('\n')}`, cards };
    } catch {
      return null;
    }
  }

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
    const LEGACY_MODELS = new Set(['gpt-4o-mini', 'claude-sonnet-4-5', 'claude-sonnet-5', 'claude-sonnet-5[1m]']);
    if (!model || LEGACY_MODELS.has(model)) model = 'claude-sonnet-4.6';

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    // Fast deterministic intents first — only fall back to the LLM when none hit.
    const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
    void (async () => {
      sseSend(res, 'status', { status: 'Lumo is thinking...' });
      const fast = await tryFastIntent(lastUser);
      if (fast) {
        sseSend(res, 'result', fast);
        res.end();
        return true;
      }
      return false;
    })().then((handled) => {
      if (handled) return;
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
  });

  return router;
}
