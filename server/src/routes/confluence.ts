import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';
import { render } from 'dom-serializer';
import { appendChild, findAll, removeElement, textContent } from 'domutils';
import type { Element } from 'domhandler';
import { ConfluenceApiError } from '@mc/core';
import type { ConfluenceConnection, ConfluenceSearchOptions } from '@mc/core';
import type { Credentials } from '../config/credentialsStore.js';
import { signProxyUrl } from '../security.js';
import { h, HttpError, qstr, requireString, type AppDeps } from './deps.js';

function emptyCredentials(): Credentials {
  return {
    email: '', jiraBaseUrl: '', jiraPat: '', instanceType: 'datacenter', defaultProjectKey: 'ISW',
    testRailBaseUrl: '', testRailEmail: '', testRailApiKey: '', confluenceBaseUrl: '', confluencePat: '',
  };
}

/** Fixed HP Confluence endpoint — the Settings UI no longer sends a baseUrl;
 *  explicit values (older clients, saved configs) still win when present. */
const DEFAULT_CONFLUENCE_BASE_URL = 'https://v-indigo-confluence.inr.rd.hpicorp.net:6443';

function connection(body: Record<string, unknown>): ConfluenceConnection {
  return { baseUrl: opt(body.baseUrl) ?? DEFAULT_CONFLUENCE_BASE_URL, pat: requireString(body.pat, 'pat') };
}

function opt(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Builds a proxied asset URL, signed with HMAC(apiToken, url) when a token is
 *  supplied so the sandboxed render iframe (no cookies) can fetch it without
 *  session auth; the signature binds the request to this exact upstream URL. */
function signedProxyUrl(selfOrigin: string, absolute: string, apiToken: string): string {
  const sig = apiToken ? `&sig=${signProxyUrl(apiToken, absolute)}` : '';
  return `${selfOrigin}/api/confluence/proxy?url=${encodeURIComponent(absolute)}${sig}`;
}

/** Rewrites `url(...)` and `@import` refs inside a CSS body so relative font/image
 *  paths resolve against the CSS's own upstream URL instead of the proxy path the
 *  browser actually fetched the stylesheet from — otherwise AUI icon fonts 404 and
 *  render as missing-glyph squares. `data:` URIs pass through untouched. */
export function rewriteCssUrls(css: string, cssUrl: string, makeProxyUrl: (absUrl: string) => string): string {
  const resolve = (raw: string): string | null => {
    const value = raw.trim();
    if (!value || /^data:/i.test(value)) return null;
    try {
      return new URL(value, cssUrl).toString();
    } catch {
      return null;
    }
  };

  // Handle @import first (it may itself contain a url(...) form) so the generic
  // url() pass below never re-rewrites an already-rewritten @import reference.
  const out = css.replace(
    /@import\s+(?:url\(\s*(['"]?)([^)'"]*)\1\s*\)|(['"])([^'"]*)\3)|url\(\s*(['"]?)([^)'"]*)\5\s*\)/gi,
    (match, _urlQuote: string, urlRef: string | undefined, _strQuote: string, strRef: string | undefined, _quote: string, raw: string | undefined) => {
      const isImport = urlRef !== undefined || strRef !== undefined;
      const absolute = resolve((urlRef ?? strRef ?? raw ?? ''));
      if (!absolute) return match;
      return isImport ? `@import url("${makeProxyUrl(absolute)}")` : `url("${makeProxyUrl(absolute)}")`;
    },
  );

  return out;
}

function proxyAssetTag(tag: string, pageUrl: string, selfOrigin = '', apiToken = ''): string {
  return tag.replace(/\b(href|src)=(['"])([^'"]+)\2/gi, (match, attribute: string, quote: string, raw: string) => {
    if (/^(?:data:|blob:|javascript:|#)/i.test(raw)) return match;
    try {
      const absolute = new URL(raw, pageUrl).toString();
      return `${attribute}=${quote}${signedProxyUrl(selfOrigin, absolute, apiToken)}${quote}`;
    } catch {
      return match;
    }
  });
}

function sanitizeConfluenceBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'span', 'details', 'summary', 'figure', 'figcaption', 'section', 'article',
      'time', 'mark', 'del', 'ins', 'u', 'colgroup', 'col', 'tbody', 'thead', 'tfoot',
    ]),
    allowedAttributes: {
      '*': ['id', 'class', 'title', 'role', 'aria-*', 'data-*', 'style'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      col: ['span', 'width'],
      time: ['datetime'],
    },
    // Safe inline-style subset only: excludes position/visibility/opacity/z-index/content/
    // top|left|right|bottom so inline styles can't overlay or hide surrounding chrome.
    allowedStyles: {
      '*': {
        color: [/^.*$/], 'background-color': [/^.*$/], background: [/^.*$/],
        width: [/^.*$/], 'min-width': [/^.*$/], 'max-width': [/^.*$/], height: [/^.*$/],
        'font-size': [/^.*$/], 'font-weight': [/^.*$/], 'font-style': [/^.*$/], 'font-family': [/^.*$/],
        'text-align': [/^.*$/], 'text-decoration': [/^.*$/], 'letter-spacing': [/^.*$/], 'line-height': [/^.*$/],
        'vertical-align': [/^.*$/], 'white-space': [/^.*$/], display: [/^.*$/],
        padding: [/^.*$/], margin: [/^.*$/],
        border: [/^.*$/], 'border-color': [/^.*$/], 'border-width': [/^.*$/], 'border-style': [/^.*$/],
        'border-top': [/^.*$/], 'border-bottom': [/^.*$/], 'border-left': [/^.*$/], 'border-right': [/^.*$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: { ...attrs, rel: 'noopener noreferrer' },
      }),
      img: (_tag, attrs) => ({ tagName: 'img', attribs: { ...attrs, loading: 'lazy' } }),
    },
  });
}

/** draw.io diagram macros render an empty viewer div plus a `<script>` that boots the
 *  viewer client-side — but we strip scripts, so the diagram would render blank. The
 *  script always embeds a static PNG export URL (`readerOpts.imageUrl`, built from a
 *  simple string concatenation) and sometimes a `readerOpts.width`; swap the empty
 *  viewer content for an `<img>` of that export before sanitizing away the script.
 *  The extracted src is a raw upstream-relative path — sanitize/proxyAssetTag downstream
 *  handle signing it, same as any other asset. */
export function inlineDrawioImages(html: string): string {
  const doc = parseDocument(html);
  const macros = findAll(
    (el) => el.attribs?.['data-macro-name'] === 'drawio' || el.attribs?.['data-macro-name'] === 'drawio-sketch',
    doc.children,
  );
  for (const macro of macros) {
    const scripts = findAll((el) => el.name === 'script', macro.children);
    let imageUrl: string | null = null;
    let width: string | null = null;
    for (const script of scripts) {
      const text = textContent(script);
      const urlMatch = /readerOpts\.imageUrl\s*=\s*([^;]+);/.exec(text);
      if (urlMatch) {
        const segments = [...urlMatch[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)];
        if (segments.length) imageUrl = segments.map((m) => m[1] ?? m[2] ?? '').join('');
      }
      const widthMatch = /readerOpts\.width\s*=\s*['"](\d+)['"]/.exec(text);
      if (widthMatch) width = widthMatch[1];
      if (imageUrl) break;
    }
    if (!imageUrl) continue;
    const imgHtml = `<img class="drawio-exported" src="${escapeHtml(imageUrl)}" alt="drawio diagram"${width ? ` width="${width}"` : ''} />`;
    for (const child of macro.children.slice()) removeElement(child);
    const [imgNode] = parseDocument(imgHtml).children;
    if (imgNode) appendChild(macro, imgNode as Element);
  }
  return render(doc);
}

function hasClassToken(el: Element, token: string): boolean {
  const value = el.attribs?.class;
  return typeof value === 'string' && value.split(/\s+/).includes(token);
}

function tableRowSignature(table: Element): string | null {
  const rows = findAll((el) => el.name === 'tr', table.children);
  if (rows.length === 0) return null;
  const cells = findAll((el) => el.name === 'td' || el.name === 'th', rows[0].children);
  return cells.map((cell) => textContent(cell).trim()).join('');
}

function isBlankNode(node: { type: string; data?: string }): boolean {
  return node.type === 'text' ? !node.data?.trim() : node.type === 'comment';
}

/** Table Filter plugin wrappers hold N source tables that its JS merges into one at
 *  render time; since we strip scripts, merge server-side: when every table in a
 *  wrapper shares the same first-row (header) cell text, keep the first table and
 *  append every other table's non-header rows to it, dropping the emptied tables. */
export function mergeTableFilterTables(html: string): string {
  const doc = parseDocument(html);
  const wrappers = findAll((el) => el.name === 'div' && hasClassToken(el, 'tablefilter-outer-wrapper'), doc.children);
  for (const wrapper of wrappers) {
    const tables = findAll((el) => el.name === 'table', wrapper.children);
    if (tables.length < 2) continue;
    const signature = tableRowSignature(tables[0]);
    if (signature === null) continue;
    if (!tables.every((table) => tableRowSignature(table) === signature)) continue;

    const targetRows = findAll((el) => el.name === 'tr', tables[0].children);
    const targetBody = (targetRows[0].parent as Element | null) ?? tables[0];

    for (const table of tables.slice(1)) {
      const rows = findAll((el) => el.name === 'tr', table.children);
      for (const row of rows.slice(1)) appendChild(targetBody, row);
      const shell = table.parent as Element | null;
      removeElement(table);
      if (shell?.type === 'tag' && hasClassToken(shell, 'table-wrap') && shell.children.every((child) => isBlankNode(child))) {
        removeElement(shell);
      }
    }
  }
  return render(doc);
}

export function originalPageDocument(page: Awaited<ReturnType<NonNullable<AppDeps['confluence']>['requirePage']>>, baseUrl: string, upstreamHtml: string, nonce = '', selfOrigin = '', apiToken = ''): string {
  const pageUrl = new URL(page.url ?? '/', `${baseUrl}/`).toString();
  const toggleScript = `<script nonce="${nonce}">
document.addEventListener('click',function(event){
  var control=event.target.closest('.expand-control');if(!control)return;
  var container=control.closest('.expand-container');var content=container&&container.querySelector('.expand-content');if(!content)return;
  var opening=content.classList.contains('expand-hidden');content.classList.toggle('expand-hidden',!opening);control.setAttribute('aria-expanded',String(opening));
  var icon=control.querySelector('.expand-icon');if(icon){icon.classList.toggle('aui-iconfont-chevron-right',!opening);icon.classList.toggle('aui-iconfont-chevron-down',opening);}
});
</script>`;
  const stylesheets = (upstreamHtml.match(/<link\b[^>]*>/gi) ?? [])
    .filter((tag) => /\bstylesheet\b/i.test(tag))
    .map((tag) => proxyAssetTag(tag, pageUrl, selfOrigin, apiToken))
    .join('\n');
  const author = page.lastModifiedBy ? ` by ${escapeHtml(page.lastModifiedBy)}` : '';
  const modified = page.lastModifiedAt ? new Date(page.lastModifiedAt).toLocaleString('en-US') : '';
  const safeBody = mergeTableFilterTables(sanitizeConfluenceBody(inlineDrawioImages(page.viewBody || page.storageBody)));
  const content = proxyAssetTag(
    `<div id="jiraweb-confluence-page" class="page view"><h1 id="title-heading" class="pagetitle"><span id="title-text">${escapeHtml(page.title)}</span></h1><div class="page-metadata">Last updated ${escapeHtml(modified)}${author} · Version ${page.version}</div><main id="main-content" class="wiki-content">${safeBody}</main></div>`,
    pageUrl,
    selfOrigin,
    apiToken,
  );
  return `<!doctype html>
<html><head><meta charset="utf-8"><base href="${escapeHtml(pageUrl)}">
${stylesheets}
<style>
html,body{margin:0!important;min-height:100%;background:#fff!important;color:#172b4d!important;color-scheme:light!important}
body{padding:0!important;font-family:Arial,"Helvetica Neue",sans-serif!important;font-size:14px!important;line-height:1.42857143!important}
#jiraweb-confluence-page{box-sizing:border-box!important;width:100%!important;max-width:none!important;margin:0!important;padding:32px 44px 80px!important}
#title-heading,#title-heading #title-text{display:block!important;visibility:visible!important;opacity:1!important;height:auto!important;color:#172b4d!important}
.wiki-content{overflow-wrap:anywhere}.wiki-content img{max-width:100%;height:auto}
.wiki-content table{max-width:100%}.wiki-content .expand-hidden{display:none!important}.wiki-content .expand-control{cursor:pointer}
.wiki-content .contentLayout2{display:block!important;clear:both!important;width:100%!important;max-width:none!important}
.wiki-content .contentLayout2 .columnLayout{display:table!important;table-layout:fixed!important;width:100%!important;max-width:none!important;margin:0 0 20px!important;border-collapse:separate!important;border-spacing:0!important}
.wiki-content .contentLayout2 .cell{display:table-cell!important;box-sizing:border-box!important;min-width:0!important;padding:0 0 0 20px!important;vertical-align:top!important}
.wiki-content .contentLayout2 .cell:first-child{padding-left:0!important}
.wiki-content .contentLayout2 .columnLayout.single>.cell{width:100%!important}
.wiki-content .contentLayout2 .columnLayout.two-equal>.cell{width:50%!important}
.wiki-content .contentLayout2 .columnLayout.three-equal>.cell{width:33.3333%!important}
.wiki-content .contentLayout2 .columnLayout .cell.aside{width:30%!important}
.wiki-content .contentLayout2 .columnLayout .cell.sidebars{width:20%!important}
.wiki-content .contentLayout2 .columnLayout.three-with-sidebars>.cell.normal{width:60%!important}
.wiki-content .table-wrap{display:block!important;max-width:100%!important;margin:10px 0!important;overflow-x:auto!important}
.wiki-content table.confluenceTable{display:table!important;width:auto!important;max-width:100%!important;border-collapse:collapse!important;border-spacing:0!important;background:#fff!important;color:#172b4d!important}
.wiki-content .confluenceTh,.wiki-content .confluenceTd{display:table-cell!important;border:1px solid #c1c7d0!important;padding:7px 10px!important;text-align:left!important;vertical-align:top!important}
.wiki-content .confluenceTh{background:#f4f5f7!important;font-weight:600!important}
@media(max-width:720px){#jiraweb-confluence-page{padding:22px 20px 60px!important}}
@media(max-width:720px){.wiki-content .contentLayout2 .columnLayout{display:block!important}.wiki-content .contentLayout2 .cell{display:block!important;width:100%!important;padding:0!important;margin-bottom:16px!important}}
/* Table Filter plugin's CSS hides its wrapper (visibility:hidden) until its own JS
   runs to reveal it — we strip scripts, so force the content visible and hide the
   now-inert filter buttons/menus that would otherwise render as dead chrome. */
.wiki-content .tablefilter-outer-wrapper[data-id]{visibility:visible!important;padding:0!important}
.wiki-content .tablefilter-outer-wrapper .tf-floating-btn-container,
.wiki-content .tablefilter-outer-wrapper .tfac-menu,
.wiki-content .tablefilter-outer-wrapper .tableFilterCbStyle,
.wiki-content .tablefilter-outer-wrapper .tf-shower-wrapper,
.wiki-content .tablefilter-pagination,
.wiki-content .aui-dropdown2{display:none!important}
</style></head>
<body id="com-atlassian-confluence" class="theme-default aui-layout aui-theme-default">${content}${toggleScript}</body></html>`;
}

export function confluenceRoutes(deps: AppDeps): Router {
  const router = Router();
  const service = deps.confluence;
  if (!service) {
    router.use((_req, _res, next) => next(new HttpError(503, 'Confluence service is unavailable.')));
    return router;
  }

  router.get('/status', h((_req, res) => res.json(service.status())));

  router.post('/test', h(async (req, res) => {
    res.json(await service.test(connection((req.body ?? {}) as Record<string, unknown>)));
  }));

  router.put('/connection', h(async (req, res) => {
    const next = connection((req.body ?? {}) as Record<string, unknown>);
    const user = await service.test(next);
    deps.credentials.save({ ...(deps.credentials.load() ?? emptyCredentials()), confluenceBaseUrl: next.baseUrl.trim().replace(/\/+$/, ''), confluencePat: next.pat.trim() });
    service.disconnect();
    await service.connect();
    res.json({ ...service.status(), user });
  }));

  router.delete('/connection', h((_req, res) => {
    const saved = deps.credentials.load();
    if (saved) deps.credentials.save({ ...saved, confluenceBaseUrl: '', confluencePat: '' });
    service.disconnect();
    res.status(204).end();
  }));

  router.get('/spaces', h(async (req, res) => {
    res.json(await service.spaces(qstr(req.query.fresh) === '1'));
  }));

  router.get('/spaces/:key/pages', h(async (req, res) => {
    const startAt = Math.max(0, Number.parseInt(qstr(req.query.start) ?? '0', 10) || 0);
    const limit = Math.min(200, Math.max(1, Number.parseInt(qstr(req.query.limit) ?? '200', 10) || 200));
    res.json(await service.pages(req.params.key, startAt, limit));
  }));

  router.get('/spaces/:key/tree', h(async (req, res) => {
    res.json(await service.treeRoots(req.params.key));
  }));

  router.get('/pages/:id/children', h(async (req, res) => {
    res.json(await service.children(req.params.id));
  }));

  router.get('/pages/:id/render', h(async (req, res) => {
    const page = await service.requirePage(req.params.id);
    const client = service.client();
    const pageUrl = new URL(page.url ?? '/', `${client.baseUrl}/`).toString();
    let upstreamHtml = '';
    try {
      const upstream = await client.proxy(pageUrl);
      if (upstream.ok && (upstream.headers.get('content-type') ?? '').includes('text/html')) upstreamHtml = await upstream.text();
    } catch {
      // The REST-rendered body remains a complete safe fallback.
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    const nonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; frame-ancestors 'self'; sandbox allow-scripts allow-popups`);
    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    res.send(originalPageDocument(page, client.baseUrl, upstreamHtml, nonce, selfOrigin, deps.apiToken ?? ''));
  }));

  router.get('/pages/:id', h(async (req, res) => {
    res.json(await service.requirePage(req.params.id));
  }));

  router.get('/resolve', h(async (req, res) => {
    res.json(await service.resolvePage(requireString(qstr(req.query.spaceKey), 'spaceKey'), requireString(qstr(req.query.title), 'title')));
  }));

  router.get('/search', h(async (req, res) => {
    const options: ConfluenceSearchOptions = {
      query: opt(req.query.query), title: opt(req.query.title), body: opt(req.query.body),
      creator: opt(req.query.creator), contributor: opt(req.query.contributor), label: opt(req.query.label),
      spaceKey: opt(req.query.spaceKey), createdAfter: opt(req.query.createdAfter), createdBefore: opt(req.query.createdBefore),
      modifiedAfter: opt(req.query.modifiedAfter), modifiedBefore: opt(req.query.modifiedBefore),
      sort: ['modified', 'created', 'title'].includes(String(req.query.sort)) ? req.query.sort as ConfluenceSearchOptions['sort'] : 'modified',
      limit: Number.parseInt(String(req.query.limit ?? '100'), 10),
    };
    res.json(await service.search(options));
  }));

  router.post('/pages', h(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const spaceKey = requireString(body.spaceKey, 'spaceKey');
    await service.requireSpace(spaceKey);
    const parentId = opt(body.parentId);
    if (parentId) {
      const parent = await service.requirePage(parentId);
      if (parent.spaceKey.toLowerCase() !== spaceKey.toLowerCase()) throw new HttpError(400, 'The parent page must be in the selected space.');
    }
    const page = await service.client().createPage(spaceKey, requireString(body.title, 'title'), requireString(body.storageBody, 'storageBody'), parentId);
    res.status(201).json(page);
  }));

  router.put('/pages/:id', h(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const current = await service.requirePage(req.params.id);
    const expected = Number(body.version);
    if (Number.isFinite(expected) && expected !== current.version) throw new HttpError(409, `This page changed in Confluence (version ${current.version}). Reload before saving.`);
    const parentId = body.parentId === null ? null : opt(body.parentId);
    if (parentId) {
      const parent = await service.requirePage(parentId);
      if (parent.spaceKey.toLowerCase() !== current.spaceKey.toLowerCase()) throw new HttpError(400, 'The parent page must be in the same space.');
    }
    res.json(await service.client().updatePage(current, requireString(body.title, 'title'), requireString(body.storageBody, 'storageBody'), body.parentId === undefined ? undefined : parentId));
  }));

  router.delete('/pages/:id', h(async (req, res) => {
    await service.requirePage(req.params.id); // 404 before delete
    await service.client().deletePage(req.params.id);
    res.status(204).end();
  }));

  router.get('/proxy', h(async (req, res) => {
    const rawUrl = requireString(qstr(req.query.url), 'url');
    const client = service.client();
    const upstream = await client.proxy(rawUrl);
    if (!upstream.ok) throw new ConfluenceApiError(upstream.status, `Confluence file returned ${upstream.status}.`);
    const type = upstream.headers.get('content-type');
    if (type) res.setHeader('Content-Type', type);
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) res.setHeader('Content-Disposition', disposition);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (type?.includes('text/css')) {
      const cssUrl = new URL(rawUrl, `${client.baseUrl}/`).toString();
      const apiToken = deps.apiToken ?? '';
      const selfOrigin = `${req.protocol}://${req.get('host')}`;
      const css = rewriteCssUrls(await upstream.text(), cssUrl, (absolute) => signedProxyUrl(selfOrigin, absolute, apiToken));
      res.send(css);
      return;
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }));

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(err instanceof ConfluenceApiError)) return next(err);
    // A Confluence auth failure is not an expired Jira session.
    const status = err.status === 401 ? 403 : err.status >= 400 && err.status < 500 ? err.status : 502;
    res.status(status).json({ status, message: err.message });
  });
  return router;
}
