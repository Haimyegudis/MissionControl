/**
 * Cookie source for cookie-authenticated requests.
 *
 * Measured on device: the native HTTP layer does not attach the WebView's
 * cookie jar to requests aimed at Jira or TestRail — the same call returns 401
 * without a Cookie header and 200 with one. So the header has to be set
 * explicitly, and only the Android shell can read the jar (HttpOnly session
 * cookies are invisible to JavaScript, and Capacitor's cookie API omits them).
 *
 * Core therefore takes the reader as an injected hook rather than importing
 * anything native. Nothing registers it on the desktop, where the provider
 * stays null and no Cookie header is ever produced.
 */
export type CookieProvider = (url: string) => Promise<string>;

let provider: CookieProvider | null = null;

/** Install the reader. Called once by the Android bootstrap. */
export function setCookieProvider(fn: CookieProvider | null): void {
  provider = fn;
}

/**
 * The Cookie header value for a URL, or '' when there is no provider or the
 * lookup fails. A failure must not break the request: it falls through to an
 * unauthenticated call, which the caller already handles as a lapsed session.
 */
export async function cookieHeaderFor(url: string): Promise<string> {
  if (provider === null) return '';
  try {
    return await provider(url);
  } catch {
    return '';
  }
}
