// HP OneUID sign-in for the Android shell.
//
// Both Jira and TestRail sit behind the same PingFederate IdP
// (login.external.hp.com). Hitting a protected page while signed out bounces
// through SAML and ends with a session cookie on the service's own host.
//
// The login has to run in an in-app WebView rather than a Custom Tab: Custom
// Tabs use Chrome's cookie jar, which the app cannot read. An in-app WebView
// shares android.webkit.CookieManager, which is the same jar CapacitorHttp
// sends from — so the cookie the login produces is attached to later REST
// calls automatically.

import { flushCookies, readCookies } from './cookieBridge';
import { rememberSession } from './ssoSession';

/** How long to wait for a sign-in before giving up and closing the WebView. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export type SsoTarget = 'jira' | 'testrail';

export interface SsoResult {
  ok: boolean;
  /** Why it failed, for display. 'cancelled' when the user backed out. */
  reason?: string;
}

/** The page to open: protected, so it triggers the IdP redirect when signed out. */
export function entryUrl(target: SsoTarget, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return target === 'testrail'
    ? `${base}/index.php?/auth/redirect_sso/`
    : `${base}/secure/Dashboard.jspa`;
}

/**
 * Ask the API whether we are signed in, sending no Authorization header.
 *
 * Whether the sign-in worked is not something a URL can answer: navigating to
 * the entry page fires a "page loaded" event before the IdP redirect has even
 * happened, which made an earlier version close the window instantly and then
 * fail with "you do not have permission". Asking the API directly is the only
 * honest test, and it doubles as proof that the cookie set inside the login
 * WebView actually reaches native HTTP.
 */
export async function isAuthenticated(target: SsoTarget, baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '');
  const url =
    target === 'testrail' ? `${base}/index.php?/api/v2/get_priorities` : `${base}/rest/api/2/myself`;
  try {
    const cookie = await readCookies(base);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    // Bounded: an unbounded probe wedged the WebView during testing, leaving
    // the sign-in screen with no way forward.
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const text = await res.text();
    // A lapsed session answers with the HTML login page under a 200, so the
    // status alone is not enough — the body has to be JSON.
    const head = text.trimStart();
    return head.startsWith('{') || head.startsWith('[');
  } catch {
    return false;
  }
}

function sameHost(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

/**
 * Open the IdP, wait until the API says we are authenticated, close the
 * WebView. Never rejects: a failed sign-in is a normal outcome the caller
 * reports. Failures carry their reason rather than being flattened into
 * "cancelled", because on a release build that message is the only diagnostic
 * available.
 */
export async function signInWithSso(target: SsoTarget, baseUrl: string): Promise<SsoResult> {
  let plugin: typeof import('@capacitor/inappbrowser');
  try {
    plugin = await import('@capacitor/inappbrowser');
  } catch (e) {
    return { ok: false, reason: `plugin unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { InAppBrowser, DefaultWebViewOptions } = plugin;

  return new Promise<SsoResult>((resolve) => {
    const handles: Array<{ remove: () => Promise<void> }> = [];
    let done = false;

    const finish = (result: SsoResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) void h.remove().catch(() => undefined);
      void InAppBrowser.close().catch(() => undefined);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: 'timed out' }), SIGN_IN_TIMEOUT_MS);

    // After each page settles on the service's own host, ask the API whether
    // we are in yet. Pages on the IdP are skipped: only the return leg can
    // have produced a session.
    void InAppBrowser.addListener('browserPageNavigationCompleted', (data) => {
      if (!sameHost(data?.url ?? '', baseUrl)) return;
      void isAuthenticated(target, baseUrl).then(async (ok) => {
        if (!ok) return;
        await rememberSession(baseUrl);
        await flushCookies();
        finish({ ok: true });
      });
    })
      .then((h) => handles.push(h))
      .catch(() => undefined);

    // Closing by hand usually means cancel, but the sign-in may have completed
    // on a page whose navigation event was missed — so check before giving up.
    void InAppBrowser.addListener('browserClosed', () => {
      void isAuthenticated(target, baseUrl).then(async (ok) => {
        if (ok) {
          await rememberSession(baseUrl);
          await flushCookies();
        }
        finish(
          ok ? { ok: true } : { ok: false, reason: 'signed in, but the cookie did not reach the app' },
        );
      });
    })
      .then((h) => handles.push(h))
      .catch(() => undefined);

    void InAppBrowser.openInWebView({
      url: entryUrl(target, baseUrl),
      options: {
        ...DefaultWebViewOptions,
        showURL: true, // the user should see which host is asking for credentials
        showToolbar: true,
        clearCache: false,
        clearSessionCache: false,
        android: {
          ...DefaultWebViewOptions.android,
          // Load-bearing. The plugin defaults to running its WebView in a
          // separate process (":OSInAppBrowser"), and CookieManager's store is
          // per-process, so a session established during login was invisible to
          // the app — measured on device: after a completed Ping login the app's
          // jar held no session cookie for Jira, TestRail, or even the IdP.
          isIsolated: false,
        },
      },
    }).catch((e) =>
      finish({ ok: false, reason: `could not open: ${e instanceof Error ? e.message : String(e)}` }),
    );
  });
}
