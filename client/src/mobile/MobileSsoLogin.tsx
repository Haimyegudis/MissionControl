// HP OneUID sign-in, offered above the shared login form on Android.
//
// Sits outside LoginPage deliberately: that component is the desktop's, and
// the desktop must keep rendering it unchanged. Here it is only a banner with
// one button — the PAT form underneath stays available as the fallback.

import { useState } from 'react';
import { auth } from '../api/client';
import { JIRA_URL } from '../lib/serviceUrls';
import { signInWithSso } from '../native/sso';
import { pushToast } from '../stores/toasts';
import { tapReset } from './ui';

export function MobileSsoLogin() {
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      const result = await signInWithSso('jira', JIRA_URL);
      if (!result.ok) {
        pushToast({ title: 'Sign in', body: result.reason ?? 'Cancelled.', severity: 'error' });
        return;
      }
      // No token at all: the SAML cookie in the shared jar is the credential,
      // and the probe behind /api/auth/login proves it works before we commit.
      await auth.login({
        baseUrl: JIRA_URL,
        email: '',
        pat: '',
        instanceType: 'datacenter',
        authMode: 'sso',
      });
      window.location.reload();
    } catch (e) {
      pushToast({
        title: 'Sign in',
        body: e instanceof Error ? e.message : String(e),
        severity: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '20px 16px 0' }}>
      <button
        onClick={() => void signIn()}
        disabled={busy}
        style={{
          ...tapReset,
          width: '100%',
          minHeight: 52,
          borderRadius: 12,
          border: '1px solid var(--accent-cyan)',
          background: 'var(--bg-panel-high)',
          color: 'var(--accent-cyan)',
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {busy ? 'Signing in…' : 'Sign in with HP OneUID'}
      </button>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        Uses your Ping session — no token stored. Expires after a few hours.
      </div>
    </div>
  );
}
