/**
 * Confluence tools over direct REST (port of Lumo's confluenceUtils.js +
 * clusterReleaseNotes.js approach). The on-prem host uses a self-signed cert
 * chain, so TLS verification is relaxed by default (CONFLUENCE_VERIFY_TLS=true
 * or NODE_EXTRA_CA_CERTS re-enables it). Auth: Bearer CONFLUENCE_PAT resolved
 * via process.env → %APPDATA%\Lumo\.env → <LUMO_ROOT>\.env. Missing PAT →
 * tools return {error:'confluence not configured'}.
 */
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { getLumoSecret } from './env.js';

type Rec = Record<string, any>;

export function confluenceBaseUrl(): string {
  return (
    getLumoSecret('CONFLUENCE_BASE_URL') || 'https://v-indigo-confluence.inr.rd.hpicorp.net:6443'
  ).replace(/\/+$/, '');
}

const NOT_CONFIGURED = { error: 'confluence not configured' } as const;

// ---------------------------------------------------------------------------
// HTTPS agent with relaxed TLS (Lumo confluenceUtils parity)
// ---------------------------------------------------------------------------

let cachedAgent: https.Agent | null = null;
let cachedKey: string | null = null;

function tlsEnvKey(): string {
  return `${process.env.CONFLUENCE_VERIFY_TLS || ''}|${process.env.NODE_EXTRA_CA_CERTS || ''}`;
}

function confluenceHttpsAgent(): https.Agent {
  const key = tlsEnvKey();
  if (cachedAgent && cachedKey === key) return cachedAgent;
  // Verify by DEFAULT — a PAT travels on this connection. Only an explicit
  // CONFLUENCE_VERIFY_TLS=false opts out (self-signed internal certs; prefer
  // NODE_EXTRA_CA_CERTS with the internal CA instead).
  const verifyTls = process.env.CONFLUENCE_VERIFY_TLS !== 'false';
  const caPath = process.env.NODE_EXTRA_CA_CERTS;
  const opts: https.AgentOptions = { rejectUnauthorized: verifyTls };
  if (caPath) {
    try {
      opts.ca = readFileSync(caPath);
      opts.rejectUnauthorized = true;
    } catch {
      /* keep verifyTls */
    }
  }
  cachedAgent = new https.Agent(opts);
  cachedKey = key;
  return cachedAgent;
}

/** GET a Confluence REST URL with Bearer auth; resolves parsed JSON. */
function confluenceGetJson(url: string, pat: string, timeoutMs = 30_000): Promise<Rec> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        agent: confluenceHttpsAgent(),
        headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`Confluence HTTP ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as Rec);
          } catch {
            reject(new Error('Confluence returned non-JSON response'));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Confluence request timed out after ${timeoutMs} ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// URL parsing + HTML stripping helpers
// ---------------------------------------------------------------------------

/** Extract page id / space+title from any Confluence URL form (Lumo port). */
export function parseConfluenceUrl(url: string): {
  pageId: string | null;
  spaceKey: string | null;
  pageTitle: string | null;
} {
  if (!url) return { pageId: null, spaceKey: null, pageTitle: null };
  const pagesMatch = url.match(/pages\/(\d+)/);
  if (pagesMatch) return { pageId: pagesMatch[1], spaceKey: null, pageTitle: null };
  const paramMatch = url.match(/pageId=(\d+)/);
  if (paramMatch) return { pageId: paramMatch[1], spaceKey: null, pageTitle: null };
  const displayMatch = url.match(/\/display\/([^/]+)\/([^?#]+)/);
  if (displayMatch) {
    return {
      pageId: null,
      spaceKey: displayMatch[1],
      pageTitle: decodeURIComponent(displayMatch[2].replace(/\+/g, ' ')),
    };
  }
  const spaceMatch = url.match(/[?&]spaceKey=([^&#]+)/);
  const titleMatch = url.match(/[?&]title=([^&#]+)/);
  if (spaceMatch && titleMatch) {
    return {
      pageId: null,
      spaceKey: decodeURIComponent(spaceMatch[1]),
      pageTitle: decodeURIComponent(titleMatch[1].replace(/\+/g, ' ')),
    };
  }
  return { pageId: null, spaceKey: null, pageTitle: null };
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pat(): string {
  return getLumoSecret('CONFLUENCE_PAT');
}

async function resolvePageId(documentUri: string, token: string): Promise<string | null> {
  const s = String(documentUri || '').trim();
  if (/^\d+$/.test(s)) return s;
  const parsed = parseConfluenceUrl(s);
  if (parsed.pageId) return parsed.pageId;
  if (parsed.spaceKey && parsed.pageTitle) {
    const base = confluenceBaseUrl();
    const url = `${base}/rest/api/content?spaceKey=${encodeURIComponent(parsed.spaceKey)}&title=${encodeURIComponent(parsed.pageTitle)}&limit=1`;
    const data = await confluenceGetJson(url, token);
    const hit = (data.results || [])[0];
    return hit ? String(hit.id) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** search_confluence — free-text CQL siteSearch. */
export async function searchConfluence(args: Rec): Promise<unknown> {
  const token = pat();
  if (!token) return NOT_CONFIGURED;
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query required' };
  const base = confluenceBaseUrl();
  const cql = `siteSearch ~ "${query.replace(/"/g, ' ')}" AND type = page`;
  try {
    const data = await confluenceGetJson(
      `${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=10&expand=space`,
      token,
    );
    const results = (data.results || []).map((r: Rec) => ({
      pageId: r.id,
      title: r.title,
      space: r.space?.key || null,
      url: `${base}/pages/viewpage.action?pageId=${r.id}`,
    }));
    return results;
  } catch (err) {
    return { error: `Confluence search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** get_confluence_page — page as text (export_view rendering, macros executed). */
export async function getConfluencePage(args: Rec): Promise<unknown> {
  const token = pat();
  if (!token) return NOT_CONFIGURED;
  const documentUri = String(args.documentUri ?? '').trim();
  if (!documentUri) return { error: 'documentUri required' };
  const base = confluenceBaseUrl();
  try {
    const pageId = await resolvePageId(documentUri, token);
    if (!pageId) return { error: `Could not resolve a Confluence page id from "${documentUri}".` };
    const data = await confluenceGetJson(
      `${base}/rest/api/content/${pageId}?expand=body.export_view`,
      token,
      60_000,
    );
    const html = data.body?.export_view?.value || '';
    // Keep link targets visible so "follow inner links" flows still work.
    const links: Array<{ text: string; url: string }> = [];
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = stripHtml(m[2]);
      const href = String(m[1]);
      if (text && links.length < 60) {
        links.push({ text, url: href.startsWith('http') ? href : `${base}${href}` });
      }
    }
    return {
      pageId,
      title: data.title || '',
      url: `${base}/pages/viewpage.action?pageId=${pageId}`,
      content: stripHtml(html).slice(0, 30_000),
      links,
    };
  } catch (err) {
    return { error: `Confluence fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * search_confluence_docs — fetch the given pages and return their content so
 * the agent can extract the answer in the follow-up round. (Lumo delegates
 * this to an MCP LLM; the server-only port returns the page text instead.)
 */
export async function searchConfluenceDocs(args: Rec): Promise<unknown> {
  const token = pat();
  if (!token) return NOT_CONFIGURED;
  const prompt = String(args.prompt ?? '').trim();
  const uris = (Array.isArray(args.documentUris) ? args.documentUris : [])
    .map((u: unknown) => String(u ?? '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!uris.length) return { error: 'documentUris required' };
  const docs: Rec[] = [];
  for (const uri of uris) {
    const page = (await getConfluencePage({ documentUri: uri })) as Rec;
    if (page.error) {
      docs.push({ documentUri: uri, error: page.error });
    } else {
      docs.push({
        documentUri: uri,
        title: page.title,
        url: page.url,
        content: String(page.content || '').slice(0, 8000),
      });
    }
  }
  return {
    prompt,
    documents: docs,
    note: 'Answer the prompt from the document content above; cite the source page as a card.',
  };
}

/** get_cluster_release_notes — KEDEM cluster SW release notes (SQA space). */
export async function getClusterReleaseNotes(args: Rec): Promise<unknown> {
  const token = pat();
  if (!token) return NOT_CONFIGURED;
  const cluster = String(args.cluster ?? '').trim();
  const num = cluster.match(/(\d+)/);
  if (!num) return { error: `Could not read a cluster number from "${cluster}".` };
  const c = `C${num[1]}`;
  const base = confluenceBaseUrl();

  // CQL title search for the "release notes for Cxx" page in SQA space.
  let page: { pageId: string; title: string; url: string };
  try {
    const cql = `space = "SQA" AND type = page AND title ~ "release notes for ${c}"`;
    const data = await confluenceGetJson(
      `${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=10`,
      token,
      15_000,
    );
    const results: Rec[] = data.results || [];
    const clusterRe = new RegExp(`\\b${c}\\b`, 'i');
    const hit = results.find((r) => clusterRe.test(r.title)) || results[0];
    if (!hit) return { error: `No "release notes for ${c}" page found in Confluence space SQA.` };
    page = {
      pageId: hit.id,
      title: hit.title,
      url: `${base}/pages/viewpage.action?pageId=${hit.id}`,
    };
  } catch (err) {
    return { error: `Confluence search failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    // export_view renders the page server-side, executing the Jira-issues
    // macro — the only rendering that returns the actual issue rows.
    const resp = await confluenceGetJson(
      `${base}/rest/api/content/${page.pageId}?expand=body.export_view`,
      token,
      60_000,
    );
    const html: string = resp.body?.export_view?.value || '';
    const strip = (s: string) =>
      s
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const features: Rec[] = [];
    const seen = new Set<string>();
    for (const trMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const tr = trMatch[1];
      const keyMatch = tr.match(/>([A-Z][A-Z0-9]+-\d+)</);
      if (!keyMatch) continue;
      const key = keyMatch[1];
      if (seen.has(key)) continue;
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
      if (!cells.length) continue;
      seen.add(key);
      const href = (tr.match(/href="([^"]*browse\/[A-Z0-9-]+[^"]*)"/) || [])[1] || '';
      features.push({
        key,
        summary: cells[1] || '',
        created: cells[2] || '',
        assignee: cells[3] || '',
        reporter: cells[4] || '',
        resolution: cells[5] || '',
        url: href,
      });
    }

    if (features.length) {
      return { cluster: c, title: page.title, url: page.url, count: features.length, features };
    }
    const text = strip(html);
    if (text.length > 100) {
      return { cluster: c, title: page.title, url: page.url, markdown: text.slice(0, 30_000) };
    }
    return { error: `Found "${page.title}" but could not extract its feature list.`, url: page.url };
  } catch (err) {
    return {
      error: `Failed to fetch "${page.title}": ${err instanceof Error ? err.message : String(err)}`,
      url: page.url,
    };
  }
}
