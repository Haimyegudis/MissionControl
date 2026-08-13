// TestRail settings cards (Phase 3 — unified-deck plan T16): connection
// (baseUrl/email/apiKey + connect/test + status + disconnect + clear cache)
// and the people editor (id → name rows, add row, bulk "id=name" import).

import { useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { pushToast } from '../../stores/toasts';
import {
  connectTestRail,
  disconnectTestRail,
  initTestRail,
  savePeople,
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

  // People editor state.
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [bulk, setBulk] = useState('');

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

  // Ids to show: known people plus ids collected from loaded cases/runs.
  const peopleIds = useMemo(() => {
    const ids = new Set<number>(Object.keys(st.people).map(Number));
    for (const list of Object.values(st.cases)) {
      for (const c of list ?? []) {
        if (c.ownerId) ids.add(c.ownerId);
        if (c.createdBy) ids.add(c.createdBy);
        if (c.assignedToId) ids.add(c.assignedToId);
      }
    }
    for (const r of st.runs) {
      if (r.createdBy) ids.add(r.createdBy);
    }
    return [...ids].sort((a, b) => a - b);
  }, [st.people, st.cases, st.runs]);

  const setPersonName = (id: number, name: string) => {
    const next = { ...st.people };
    if (name.trim()) next[String(id)] = name.trim();
    else delete next[String(id)];
    savePeople(next);
  };

  const addPerson = () => {
    const id = Number(newId.trim());
    if (!id || !newName.trim()) {
      pushToast({ title: 'TestRail', body: 'Need id + name.' });
      return;
    }
    savePeople({ ...st.people, [String(id)]: newName.trim() });
    setNewId('');
    setNewName('');
  };

  const importBulk = () => {
    const next = { ...st.people };
    let added = 0;
    for (const line of bulk.split('\n')) {
      const m = line.match(/^\s*(\d+)\s*[=,\t]\s*(.+?)\s*$/);
      if (m) {
        next[m[1]] = m[2];
        added++;
      }
    }
    if (!added) {
      pushToast({ title: 'TestRail', body: 'No valid lines (format: id=name).' });
      return;
    }
    savePeople(next);
    setBulk('');
    pushToast({ title: 'TestRail', body: `Imported ${added} names.` });
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

      <Card title="TestRail People">
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          TestRail blocks the user list for non-admin accounts, so ids appear as "user N". Give them names here —
          used everywhere (owner, assigned to, results).
        </p>
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {peopleIds.map((id) => (
            <div key={id} style={row}>
              <span className="muted" style={{ fontFamily: 'var(--font-mono)', minWidth: 70 }}>
                #{id}
              </span>
              <input
                style={{ flex: 1 }}
                defaultValue={st.people[String(id)] ?? ''}
                placeholder={`user ${id}`}
                onBlur={(e) => {
                  if ((st.people[String(id)] ?? '') !== e.target.value.trim()) setPersonName(id, e.target.value);
                }}
              />
            </div>
          ))}
          {peopleIds.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              No user ids collected yet — browse some cases first.
            </div>
          ) : null}
        </div>
        <div style={row}>
          <input
            placeholder="user id"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            style={{ minWidth: 90, maxWidth: 110 }}
          />
          <input placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" onClick={addPerson}>
            Add
          </button>
        </div>
        <label style={fieldCol}>
          Bulk paste — one per line: id=name
          <textarea
            rows={4}
            value={bulk}
            placeholder={'16883=David Cohen\n17012=Dana Levi'}
            onChange={(e) => setBulk(e.target.value)}
          />
        </label>
        <div>
          <button className="btn" onClick={importBulk}>
            Import names
          </button>
        </div>
      </Card>

      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  );
}
