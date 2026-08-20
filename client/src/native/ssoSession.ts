// Keeps an HP OneUID session usable across app restarts.
//
// Jira and TestRail session cookies carry no expiry, so Android holds them in
// memory only and drops them when the process dies — and this phone kills the
// app often. Without this the user would have to repeat Ping + MFA every time
// Android reclaimed the app, several times a day.
//
// The cookie string is therefore copied into the Android Keystore and replayed
// as a Cookie header when the jar comes back empty. It is still short-lived —
// the server expires the session after a few hours — which is the difference
// between this and storing a permanent API token.

import { readCookies } from './cookieBridge';

const KEY_PREFIX = 'mc.sso.cookie.';

function keyFor(baseUrl: string): string {
  try {
    return KEY_PREFIX + new URL(baseUrl).host;
  } catch {
    return KEY_PREFIX + baseUrl;
  }
}

async function secureStore(): Promise<typeof import('capacitor-secure-storage-plugin') | null> {
  try {
    return await import('capacitor-secure-storage-plugin');
  } catch {
    return null;
  }
}

/** Copy the jar's current cookies for a host into the Keystore. */
export async function rememberSession(baseUrl: string): Promise<void> {
  const cookie = await readCookies(baseUrl);
  if (!cookie) return;
  const mod = await secureStore();
  if (!mod) return;
  try {
    await mod.SecureStoragePlugin.set({ key: keyFor(baseUrl), value: cookie });
  } catch {
    // Nothing to do: the live jar still serves this session.
  }
}

/** The remembered cookie for a host, or '' when there is none. */
export async function recallSession(baseUrl: string): Promise<string> {
  const mod = await secureStore();
  if (!mod) return '';
  try {
    const { value } = await mod.SecureStoragePlugin.get({ key: keyFor(baseUrl) });
    return value ?? '';
  } catch {
    return '';
  }
}

/** Drop a remembered session once the server has rejected it. */
export async function forgetSession(baseUrl: string): Promise<void> {
  const mod = await secureStore();
  if (!mod) return;
  try {
    await mod.SecureStoragePlugin.remove({ key: keyFor(baseUrl) });
  } catch {
    // already absent
  }
}

/**
 * Cookie header for a URL: the live jar first, falling back to what was
 * remembered before the process was killed.
 */
export async function cookiesFor(url: string): Promise<string> {
  const live = await readCookies(url);
  if (live && /JSESSIONID|tr_session|PHPSESSID/i.test(live)) return live;
  const remembered = await recallSession(url);
  if (!remembered) return live;
  return remembered;
}
