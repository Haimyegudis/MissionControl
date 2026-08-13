// Connections — THE one place for all user identity / secrets. Four uniform
// blocks (Jira, TestRail, Confluence, GitHub Copilot), each with status dot +
// status text, the hardcoded service URL (read-only — lib/serviceUrls; the
// server routes default to the same values) and only the fields we truly
// need: Jira email+PAT, TestRail API key (email defaults to the Jira email),
// Confluence PAT, Copilot device-flow login.

import { useEffect, useState } from 'react';
import { confluence } from '../../api/client';
import { trApi } from '../../api/testrail';
import { CONFLUENCE_URL, JIRA_URL, TESTRAIL_URL } from '../../lib/serviceUrls';
import { login, logout, sessionStore } from '../../stores/session';
import {
  connectTestRail,
  disconnectTestRail,
  initTestRail,
  trStore,
} from '../../stores/testrail';
import { pushToast } from '../../stores/toasts';
import { useStore } from '../../stores/useStore';
import type { ConfluenceStatus } from '../../types';
import { ConfirmDialog, errText, type ConfirmSpec } from '../testrail/common';
import { ConnBlock, ConnNote, Field, Section } from './common';

const wide: React.CSSProperties = { width: '100%' };

/** Jira — shared identity (email) + PAT rotation via the saved profile. */
function JiraConnection() {
  const session = useStore(sessionStore);
  const [email, setEmail] = useState('');
  const [newToken, setNewToken] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill the shared identity once the session profile is known.
  useEffect(() => {
    if (session.profile?.email && !email) setEmail(session.profile.email);
  }, [session.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateToken = async () => {
    setStatus('');
    if (!newToken.trim()) {
      setStatus('✕ Enter a token first.');
      return;
    }
    const profile = sessionStore.get().profile;
    setBusy(true);
    try {
      // Validates the token against /myself server-side, persists it and
      // re-activates the session (POST /api/auth/login; the URL is fixed).
      await login({
        baseUrl: profile?.jiraBaseUrl || JIRA_URL,
        email: email.trim() || profile?.email || '',
        pat: newToken,
        instanceType: profile?.instanceType ?? 'datacenter',
      });
      setNewToken('');
      setStatus('✓ Token updated.');
    } catch (err) {
      setStatus(`✕ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    if (!window.confirm('Disconnect from Jira and clear the stored token?')) return;
    await logout();
  };

  const connected = session.phase === 'connected';
  return (
    <ConnBlock
      name="Jira"
      url={JIRA_URL}
      ok={connected}
      statusText={
        connected ? (
          <>
            connected as <b>{session.user?.displayName ?? session.profile?.email ?? ''}</b>
          </>
        ) : (
          'not connected'
        )
      }
    >
      <Field label="Email" hint="Shared identity — TestRail below defaults to it.">
        <input value={email} placeholder="you@company.com" onChange={(e) => setEmail(e.target.value)} style={wide} />
      </Field>
      <Field label="Personal access token" hint="Validated against Jira, then stored on this machine.">
        <input
          type="password"
          value={newToken}
          placeholder="New personal access token"
          onChange={(e) => setNewToken(e.target.value)}
          style={wide}
        />
        <div className="conn-actions">
          <button className="btn btn-primary" onClick={() => void updateToken()} disabled={busy}>
            {busy ? 'Updating…' : 'Update'}
          </button>
          <button className="btn" onClick={() => void doLogout()}>
            Log out
          </button>
        </div>
        <ConnNote text={status} />
      </Field>
    </ConnBlock>
  );
}

/** TestRail — API key only; the email defaults to the shared Jira identity
 *  and an override input hides behind a "Use a different email" link. */
function TestRailConnection() {
  const st = useStore(trStore);
  const session = useStore(sessionStore);
  const [customEmail, setCustomEmail] = useState('');
  const [useDifferent, setUseDifferent] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  useEffect(() => {
    void initTestRail();
  }, []);

  const defaultEmail = session.profile?.email ?? st.session?.email ?? '';
  const effectiveEmail = useDifferent ? customEmail.trim() : defaultEmail;

  const showDifferent = () => {
    setCustomEmail(st.session?.email ?? defaultEmail);
    setUseDifferent(true);
  };

  const connect = async () => {
    setStatus('');
    if (!apiKey.trim()) {
      setStatus('✕ Enter your TestRail API key.');
      return;
    }
    if (!effectiveEmail) {
      setStatus('✕ No email available — use "Use a different email" to enter one.');
      return;
    }
    setBusy(true);
    try {
      await connectTestRail(TESTRAIL_URL, effectiveEmail, apiKey.trim());
      const user = trStore.get().session?.user;
      setApiKey('');
      setStatus(`✓ Connected as ${user?.name ?? effectiveEmail}`);
      pushToast({ title: 'TestRail', body: `Connected as ${user?.name ?? effectiveEmail}.` });
    } catch (err) {
      setStatus(`✕ ${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () =>
    setConfirm({
      title: 'Disconnect TestRail',
      message: 'Remove the saved TestRail credentials from this machine and sign out?',
      confirmLabel: 'Disconnect',
      onConfirm: async () => {
        await disconnectTestRail();
        setStatus('Disconnected.');
      },
    });

  const clearCache = async () => {
    try {
      await trApi.clearCache();
      pushToast({ title: 'TestRail', body: 'TestRail cache cleared (disk).' });
    } catch (err) {
      pushToast({ title: 'Clear cache failed', body: errText(err) });
    }
  };

  const connected = st.phase === 'connected' && Boolean(st.session?.connected);
  return (
    <ConnBlock
      name="TestRail"
      url={TESTRAIL_URL}
      ok={connected}
      statusText={
        connected ? (
          <>
            connected as <b>{st.session?.user?.name ?? st.session?.email ?? ''}</b>
          </>
        ) : (
          'not connected'
        )
      }
    >
      <Field
        label="API key"
        hint={`Signs in as ${effectiveEmail || '(no email yet)'} with your personal API key.`}
      >
        <input
          type="password"
          value={apiKey}
          placeholder="personal API key"
          onChange={(e) => setApiKey(e.target.value)}
          style={wide}
        />
        {useDifferent ? (
          <input
            value={customEmail}
            placeholder="you@company.com"
            onChange={(e) => setCustomEmail(e.target.value)}
            style={wide}
          />
        ) : (
          <button type="button" className="conn-link" onClick={showDifferent}>
            Use a different email
          </button>
        )}
        <div className="conn-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
            {busy ? '…' : 'Connect / Test'}
          </button>
          {connected ? (
            <button className="btn" onClick={disconnect}>
              Disconnect
            </button>
          ) : null}
          <button className="btn" onClick={() => void clearCache()}>
            Clear TestRail cache
          </button>
        </div>
        <ConnNote text={status} />
      </Field>
      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </ConnBlock>
  );
}

/** Confluence (Indigo) — PAT only; test / save & connect / disconnect. */
function ConfluenceConnection() {
  const [status, setStatus] = useState<ConfluenceStatus | null>(null);
  const [pat, setPat] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void confluence
      .status()
      .then(setStatus)
      .catch((e) => setNote(`✕ ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const run = async (save: boolean) => {
    setBusy(true);
    setNote('');
    try {
      if (!pat.trim()) throw new Error('Enter the Confluence personal access token.');
      if (save) {
        const next = await confluence.connect(CONFLUENCE_URL, pat);
        setStatus(next);
        setPat('');
        setNote('✓ Connected. Only Indigo spaces will be shown.');
      } else {
        const user = await confluence.test(CONFLUENCE_URL, pat);
        setNote(`✓ Connection successful as ${user.displayName}.`);
      }
    } catch (e) {
      setNote(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Confluence and remove its stored token?')) return;
    setBusy(true);
    setNote('');
    try {
      await confluence.disconnect();
      setStatus({ configured: false, connected: false, baseUrl: null, user: null });
      setPat('');
      setNote('Confluence disconnected.');
    } catch (e) {
      setNote(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);
  return (
    <ConnBlock
      name="Confluence"
      url={CONFLUENCE_URL}
      ok={connected}
      statusText={
        connected ? (
          <>
            connected as <b>{status?.user?.displayName ?? 'user'}</b>
          </>
        ) : (
          'not connected'
        )
      }
    >
      <Field
        label="Personal access token"
        hint="The token stays on this computer. Browsing, search, create and edit are server-limited to Indigo spaces."
      >
        <input
          type="password"
          value={pat}
          placeholder={status?.configured ? 'Enter token to replace connection' : 'Confluence PAT'}
          onChange={(e) => setPat(e.target.value)}
          style={wide}
        />
        <div className="conn-actions">
          <button className="btn" onClick={() => void run(false)} disabled={busy}>
            Test
          </button>
          <button className="btn btn-primary" onClick={() => void run(true)} disabled={busy}>
            {busy ? 'Connecting…' : 'Save & connect'}
          </button>
          {status?.configured ? (
            <button className="btn" onClick={() => void disconnect()} disabled={busy}>
              Disconnect
            </button>
          ) : null}
        </div>
        <ConnNote text={note} />
      </Field>
    </ConnBlock>
  );
}

/** In-app GitHub Copilot CLI login (device flow) — powers Lumo. No fields. */
function CopilotConnection() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState('');

  const refreshStatus = () => {
    fetch('/api/copilot/status')
      .then((r) => r.json())
      .then((s) => setLoggedIn(s.loggedIn === true))
      .catch(() => setLoggedIn(null));
  };
  useEffect(refreshStatus, []);

  const startLogin = async () => {
    setMsg('');
    setCode(null);
    setUrl(null);
    try {
      const r = await fetch('/api/copilot/login', { method: 'POST' });
      const s = await r.json();
      if (!r.ok || s?.error) throw new Error(String(s?.error ?? `HTTP ${r.status}`));
      setActive(true);
      const poll = setInterval(async () => {
        try {
          const st = await fetch('/api/copilot/login/state').then((x) => x.json());
          if (st.code) setCode(st.code);
          if (st.url) setUrl(st.url);
          if (!st.active) {
            clearInterval(poll);
            setActive(false);
            if (st.done) {
              setMsg('✓ Copilot connected — Lumo is ready.');
              setCode(null);
              refreshStatus();
            } else if (st.error) {
              setMsg(`✕ ${st.error}`);
            }
          }
        } catch {
          clearInterval(poll);
          setActive(false);
        }
      }, 2000);
    } catch (e) {
      setMsg(`✕ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <ConnBlock
      name="GitHub Copilot"
      ok={loggedIn === true}
      statusText={loggedIn ? 'Copilot CLI connected — Lumo engine' : loggedIn === false ? 'not connected — Lumo engine' : 'checking…'}
    >
      <Field label="Device-flow login" hint="Signs the bundled Copilot CLI into GitHub; no token to paste.">
        <div className="conn-actions">
          <button className="btn btn-primary" disabled={active} onClick={() => void startLogin()}>
            {active ? 'Waiting for GitHub…' : loggedIn ? 'Re-login' : 'Login to Copilot'}
          </button>
        </div>
        {code ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Enter this code:</span>
            <code
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 2,
                padding: '4px 10px',
                background: 'var(--bg-panel-high)',
                borderRadius: 8,
              }}
            >
              {code}
            </code>
            <a className="btn" href={url ?? 'https://github.com/login/device'} target="_blank" rel="noreferrer">
              Open github.com/login/device ↗
            </a>
          </div>
        ) : null}
        <ConnNote text={msg} />
      </Field>
    </ConnBlock>
  );
}

export function ConnectionsSection() {
  return (
    <Section id="set-connections" label="Connections">
      <JiraConnection />
      <TestRailConnection />
      <ConfluenceConnection />
      <CopilotConnection />
    </Section>
  );
}
