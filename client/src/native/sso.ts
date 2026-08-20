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

/** How long to wait for a sign-in before giving up and closing the WebView. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export type SsoTarget = 'jira' | 'testrail';

/**
 * A page whose arrival means the SAML round-trip finished. TestRail lands on
 * its own host outside /auth/, Jira on anything that is not the login page.
 */
function isSignedInUrl(target: SsoTarget, url: string, baseUrl: string): boolean {
  let host: string;
  let base: string;
  try {
    host = new URL(url).host;
    base = new URL(baseUrl).host;
  } catch {
    return false;
  }
  if (host !== base) return false; // still at the IdP
  if (target === 'testrail') return !/\/auth\/(login|redirect_sso)/.test(url);
  return !/login\.jsp|\/login\b/.test(url);
}

/** The page to open: protected, so it triggers the IdP redirect when signed out. */
export function entryUrl(target: SsoTarget, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return target === 'testrail'
    ? `${base}/index.php?/auth/redirect_sso/`
    : `${base}/secure/Dashboard.jspa`;
}

/**
 * Open the IdP, wait for the session cookie to land, close the WebView.
 * Resolves true when a signed-in page was reached, false when the user backed
 * out or the wait timed out. Never rejects: a failed sign-in is a normal
 * outcome the caller reports, not an exception.
 */
export async function signInWithSso(target: SsoTarget, baseUrl: string): Promise<boolean> {
  let plugin: typeof import('@capacitor/inappbrowser');
  try {
    plugin = await import('@capacitor/inappbrowser');
  } catch {
    return false; // not the native shell
  }
  const { InAppBrowser, DefaultWebViewOptions } = plugin;

  return new Promise<boolean>((resolve) => {
    const handles: Array<{ remove: () => Promise<void> }> = [];
    let done = false;

    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) void h.remove().catch(() => undefined);
      void InAppBrowser.close().catch(() => undefined);
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), SIGN_IN_TIMEOUT_MS);

    void InAppBrowser.addListener('browserPageNavigationCompleted', (data) => {
      if (isSignedInUrl(target, data?.url ?? '', baseUrl)) finish(true);
    })
      .then((h) => handles.push(h))
      .catch(() => undefined);

    // Closing the window by hand is a cancel — unless a signed-in page was
    // already seen, in which case finish() has run and this is a no-op.
    void InAppBrowser.addListener('browserClosed', () => finish(false))
      .then((h) => handles.push(h))
      .catch(() => undefined);

    void InAppBrowser.openInWebView({
      url: entryUrl(target, baseUrl),
      options: {
        ...DefaultWebViewOptions,
        showURL: true, // the user should see which host is asking for credentials
        showToolbar: true,
        // Never reuse a stale session: a fresh login must actually re-auth.
        clearCache: false,
        clearSessionCache: false,
      },
    }).catch(() => finish(false));
  });
}
