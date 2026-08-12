// Jira dashboards list (ui-parity-contract.md §8): 2fr/3fr split, live search
// (Name only), list rows Name + Owner; right pane: selected name, Open in Jira
// (viewUrl, new tab), Load gadgets → gadget cards (Title + ModuleKey), V1
// disclaimer. Loads once; no auto-refresh.

import { useEffect, useMemo, useRef, useState } from 'react';
import { dashboards as dashboardsApi } from '../api/client';
import { sessionStore } from '../stores/session';
import { useStore } from '../stores/useStore';
import type { JiraDashboardDetails, JiraDashboardSummary } from '../types';

export function DashboardsView() {
  const session = useStore(sessionStore);
  const connected = session.phase === 'connected';

  const [all, setAll] = useState<JiraDashboardSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<JiraDashboardDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadedRef = useRef(false);

  // §8: loads once; no auto-refresh.
  useEffect(() => {
    if (!connected || loadedRef.current) return;
    loadedRef.current = true;
    setBusy(true);
    dashboardsApi
      .list()
      .then(setAll)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [connected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? all.filter((d) => d.name.toLowerCase().includes(q)) : all;
  }, [all, search]);

  const selected = useMemo(() => all.find((d) => d.id === selectedId) ?? null, [all, selectedId]);

  const openInJira = () => {
    const url = selected?.viewUrl;
    if (!url || !/^https?:\/\//i.test(url)) return;
    window.open(url, '_blank', 'noopener');
  };

  const loadGadgets = async () => {
    if (!selected) return;
    setError(null);
    try {
      setDetails(await dashboardsApi.details(selected.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 14, padding: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 16 }}>Dashboards</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search dashboards..."
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '70vh', overflowY: 'auto' }}>
          {busy ? (
            <div className="muted" style={{ padding: 8 }}>
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>
              No dashboards.
            </div>
          ) : (
            filtered.map((d) => (
              <div
                key={d.id}
                onClick={() => {
                  setSelectedId(d.id);
                  setDetails(null);
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: d.id === selectedId ? 'rgba(31, 224, 224, 0.12)' : 'transparent',
                  border: '1px solid ' + (d.id === selectedId ? 'var(--border-strong)' : 'transparent'),
                }}
              >
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                {d.owner ? (
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {d.owner}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {selected ? (
          <>
            <h2 style={{ fontSize: 16 }}>{selected.name}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={openInJira} disabled={!selected.viewUrl}>
                Open in Jira
              </button>
              <button className="btn" onClick={() => void loadGadgets()}>
                Load gadgets
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Most native Jira gadgets are not rendered in V1 — open in Jira for full view.
            </div>
            {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
            {details ? (
              details.gadgets.length === 0 ? (
                <div className="muted">No gadgets on this dashboard.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {details.gadgets.map((g) => (
                    <div
                      key={g.id}
                      className="card card-high"
                      style={{ padding: 12, minWidth: 200, maxWidth: 320 }}
                    >
                      <div style={{ fontWeight: 600 }}>{g.title}</div>
                      <div className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                        {g.moduleKey}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </>
        ) : (
          <div className="muted" style={{ padding: 20 }}>
            Select a dashboard on the left.
          </div>
        )}
      </div>
    </div>
  );
}
