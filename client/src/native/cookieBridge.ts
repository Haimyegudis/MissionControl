// Reads the WebView cookie jar through the app's own native plugin.
//
// Needed because HttpOnly session cookies — which is what a Jira or TestRail
// session is — are invisible to JavaScript and omitted by Capacitor's cookie
// API. android.webkit.CookieManager has no such restriction.

import { registerPlugin } from '@capacitor/core';

interface CookieBridgePlugin {
  get(options: { url: string }): Promise<{ cookie: string }>;
  clear(options: { url: string }): Promise<void>;
  clearAll(): Promise<void>;
  flush(): Promise<void>;
}

const CookieBridge = registerPlugin<CookieBridgePlugin>('CookieBridge');

/** The Cookie header value for a URL; '' when unavailable. */
export async function readCookies(url: string): Promise<string> {
  try {
    const { cookie } = await CookieBridge.get({ url });
    return cookie ?? '';
  } catch {
    return '';
  }
}

/** Persist in-memory cookies so a session survives the process being killed. */
export async function flushCookies(): Promise<void> {
  try {
    await CookieBridge.flush();
  } catch {
    // Nothing to flush outside the native shell.
  }
}

/** Remove cookies for one configured corporate service. */
export async function clearCookies(url: string): Promise<void> {
  try {
    await CookieBridge.clear({ url });
  } catch {
    // Already absent, unsupported host, or not running in the native shell.
  }
}

/** Strict variant used by security-sensitive disconnect flows. */
export async function clearCookiesStrict(url: string): Promise<void> {
  await CookieBridge.clear({ url });
}

/** Remove the entire WebView cookie jar during full app sign-out. */
export async function clearAllCookies(): Promise<void> {
  try {
    await CookieBridge.clearAll();
  } catch {
    // Already absent or not running in the native shell.
  }
}

/** Strict variant used by full app sign-out. */
export async function clearAllCookiesStrict(): Promise<void> {
  await CookieBridge.clearAll();
}
