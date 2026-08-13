// TestRail settings cards (Phase 3 — unified-deck plan T16): connection
// (baseUrl/email/apiKey + connect/test + status + disconnect + clear cache).
// People names load automatically from the server store — no manual editor.

import { useEffect, useState } from 'react';
import { trApi } from '../../api/testrail';
import { pushToast } from '../../stores/toasts';
import {
  connectTestRail,
  disconnectTestRail,
  initTestRail,
  trStore,
} from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import { ConfirmDialog, errText, type ConfirmSpec } from './common';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700 }}>{title}</h3>
      {children}
    </div>
  );
}

export function TestRailSettings() {
  const st = useStore(trStore);
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  useEffect(() => {
    void initTestRail();
  }, []);

  // Prefill saved connection fields once the session status is known.
  useEffect(() => {
    if (st.session?.baseUrl && !baseUrl) setBaseUrl(st.session.baseUrl);
    if (st.session?.email && !email) setEmail(st.session.email);
  }, [st.session]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setStatus('');
    if (!baseUrl.trim() || !email.trim() || !apiKey.trim()) {
      setStatus('All three fields are required.');
      return;
    }
    setBusy(true);
    try {
      await connectTestRail(baseUrl.trim(), email.trim(), apiKey.trim());
      const user = trStore.get().session?.user;
      setApiKey('');
      setStatus(`✓ Connected as ${user?.name ?? email.trim()}`);
      pushToast({ title: 'TestRail', body: `Connected as ${user?.name ?? email.trim()}.` });
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

  const connected = st.phase === 'connected' && st.session?.connected;

  return (
    <>
      <Card title="TestRail">
        <div style={{ fontSize: 12.5 }}>
          Status:{' '}
          {connected ? (
            <span style={{ color: 'var(--accent-green)' }}>
              connected as <b>{st.session?.user?.name ?? st.session?.email ?? ''}</b>
            </span>
          ) : (
            <span className="muted">not connected</span>
          )}
        </div>
        <label style={fieldCol}>
          TestRail URL
          <input
            value={baseUrl}
            placeholder="https://your-instance.testrail.com"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label style={fieldCol}>
          Email
          <input value={email} placeholder="you@company.com" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={fieldCol}>
          API key
          <input
            type="password"
            value={apiKey}
            placeholder="personal API key"
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <div style={row}>
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
        {status ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }} className={status.startsWith('✕') ? '' : 'muted'}>
            {status}
          </div>
        ) : null}
      </Card>

      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  );
}
