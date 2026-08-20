// Login page — base URL, email, PAT, instance type (Data Center default).
// [Test] → POST /api/auth/test with inline ✓/error; Sign in enabled only
// after a passing test → POST /api/auth/login.

import { useState, type CSSProperties, type FormEvent } from 'react';
import { isNativeApp } from '../native/platform';
import { JIRA_URL } from '../lib/serviceUrls';
import { auth } from '../api/client';
import { login } from '../stores/session';
import type { InstanceType, JiraUser } from '../types';

const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; user: JiraUser }
  | { kind: 'error'; message: string };

export function LoginPage() {
  // Prefilled on the phone only: typing a long URL on a touch keyboard is
  // painful, and both backends default to this host when the field is blank.
  const [baseUrl, setBaseUrl] = useState(() => (isNativeApp() ? JIRA_URL : ''));
  const [email, setEmail] = useState('');
  const [pat, setPat] = useState('');
  const [instanceType, setInstanceType] = useState<InstanceType>('datacenter');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const payload = { baseUrl: baseUrl.trim(), email: email.trim(), pat, instanceType };
  const canTest = payload.baseUrl.length > 0 && pat.length > 0 && test.kind !== 'testing';
  const canSignIn = test.kind === 'ok' && !signingIn;

  const invalidate = () => {
    if (test.kind !== 'idle') setTest({ kind: 'idle' });
    setSignInError(null);
  };

  const runTest = async () => {
    setTest({ kind: 'testing' });
    setSignInError(null);
    try {
      const user = await auth.test(payload);
      setTest({ kind: 'ok', user });
    } catch (err) {
      setTest({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSignIn) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      await login(payload);
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form className="card" onSubmit={signIn} style={{ width: '100%', maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.06em' }}>
            <span style={{ color: 'var(--accent-cyan)' }}>JIRA</span>
            <span> WEB</span>
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Connect to your Jira instance. Your token stays on this machine.
          </div>
        </div>

        <div style={fieldStyle}>
          <label htmlFor="login-baseurl">JIRA BASE URL</label>
          <input
            id="login-baseurl"
            type="url"
            placeholder="https://jira.example.com"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              invalidate();
            }}
            autoFocus
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="login-email">EMAIL</label>
          <input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              invalidate();
            }}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="login-pat">PERSONAL ACCESS TOKEN</label>
          <input
            id="login-pat"
            type="password"
            placeholder="PAT"
            value={pat}
            onChange={(e) => {
              setPat(e.target.value);
              invalidate();
            }}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="login-instance">INSTANCE TYPE</label>
          <select
            id="login-instance"
            value={instanceType}
            onChange={(e) => {
              setInstanceType(e.target.value as InstanceType);
              invalidate();
            }}
          >
            <option value="datacenter">Data Center (Bearer PAT)</option>
            <option value="cloud">Cloud (email + API token)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn" onClick={runTest} disabled={!canTest}>
            {test.kind === 'testing' ? 'Testing…' : 'Test'}
          </button>
          {test.kind === 'ok' && (
            <span style={{ color: 'var(--accent-green)', fontSize: 12 }}>
              ✓ Connected as {test.user.displayName}
            </span>
          )}
          {test.kind === 'error' && (
            <span style={{ color: 'var(--accent-red)', fontSize: 12, overflowWrap: 'anywhere' }}>{test.message}</span>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={!canSignIn} style={{ justifyContent: 'center', padding: '9px 14px' }}>
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>

        {signInError && <div style={{ color: 'var(--accent-red)', fontSize: 12 }}>{signInError}</div>}
      </form>
    </div>
  );
}
