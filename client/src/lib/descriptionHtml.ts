// Description HTML preparation for IssueDetails (ui-parity §10.1).
// - strips scripts/embeds and on* handlers (sanitize before render)
// - rewrites relative img/src + a/href URLs against the browseUrl origin
//   (equivalent of injecting <base href={BrowseUrl}>)
// - routes images that live on the Jira host through the server attachment
//   proxy, which injects the PAT auth header.

import { misc } from '../api/client';

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Sanitize + rewrite the server-provided description HTML.
 * Returns the transformed inner HTML, ready for a scoped container.
 * (SSR-safe: without DOMParser the input is returned unchanged.)
 */
export function prepareDescriptionHtml(html: string, browseUrl: string | null | undefined): string {
  if (typeof DOMParser === 'undefined') return html;

  let origin: string | null = null;
  let host: string | null = null;
  if (browseUrl) {
    try {
      const u = new URL(browseUrl);
      origin = u.origin;
      host = u.host;
    } catch {
      /* unparseable browseUrl — no rewriting */
    }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Sanitize: drop active content and inline handlers.
  for (const el of doc.querySelectorAll('script, iframe, object, embed, form')) el.remove();
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }

  // Anchors: strip javascript:, absolutize relative hrefs, open in new tab.
  for (const a of doc.body.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (/^javascript:/i.test(href.trim())) {
      a.removeAttribute('href');
      continue;
    }
    if (href && origin && !PROTOCOL_RE.test(href)) {
      try {
        a.setAttribute('href', new URL(href, origin).toString());
      } catch {
        /* leave as-is */
      }
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }

  // Images: absolutize relative srcs; Jira-host images go through the proxy.
  for (const img of doc.body.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (!src) continue;
    let abs = src;
    if (origin && !PROTOCOL_RE.test(src)) {
      try {
        abs = new URL(src, origin).toString();
      } catch {
        continue;
      }
    }
    try {
      const u = new URL(abs);
      if (host && u.host === host) {
        img.setAttribute('src', misc.attachmentProxyUrl(abs));
      } else if (abs !== src) {
        img.setAttribute('src', abs);
      }
    } catch {
      /* leave as-is */
    }
  }

  return doc.body.innerHTML;
}

/** Contract CSS for the scoped description container (class name passed in). */
export function descriptionCss(scope: string): string {
  return [
    `.${scope}{font-size:13px;color:var(--text-primary);overflow-wrap:anywhere;}`,
    `.${scope} img{max-width:100%;}`,
    `.${scope} a{color:var(--accent-cyan);}`,
    `.${scope} pre,.${scope} code{background:var(--bg-panel-high);padding:6px;border-radius:4px;}`,
    `.${scope} table{border-collapse:collapse;}`,
    `.${scope} table,.${scope} th,.${scope} td{border:1px solid var(--border-strong);}`,
  ].join('\n');
}
