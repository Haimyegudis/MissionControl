// Saved filters editor + JQL runner (ui-parity-contract.md §5): 2fr/3fr split,
// left list + New filter, right editor (Name / Description / JQL textarea 120,
// Save requires both, Run executes the EDITOR JQL maxResults 200 and stamps
// lastUsed), Delete. Local repository via /api/filters; loads once.

import { useEffect, useMemo, useRef, useState } from 'react';
import { filters as filtersApi, issues as issuesApi } from '../api/client';
import { DataGrid } from '../components/DataGrid';
import type { GridColumn } from '../components/DataGrid';
import { dialogs } from '../dialogs/DialogHost';
import { priorityColor, statusColor } from '../lib/colors';
import type { JiraIssue, SavedFilter } from '../types';

function newFilterId(): string {
  // Guid "N" form (32 hex chars, no hyphens) — matches Team ids.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function FiltersView() {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorJql, setEditorJql] = useState('');
  const [results, setResults] = useState<JiraIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadedRef = useRef(false);

  const selected = useMemo(() => filters.find((f) => f.id === selectedId) ?? null, [filters, selectedId]);

  const loadList = async () => {
    try {
      setFilters(await filtersApi.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // §5: loads once; no auto-refresh.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (f: SavedFilter) => {
    setSelectedId(f.id);
    setEditorName(f.name);
    setEditorDescription(f.description ?? '');
    setEditorJql(f.jql);
  };

  const newFilter = () => {
    setSelectedId(null);
    setEditorName('New filter');
    setEditorDescription('');
    setEditorJql('');
  };

  const save = async () => {
    if (!editorName.trim() || !editorJql.trim()) {
      window.alert('Name and JQL are required.');
      return;
    }
    const filter: SavedFilter = selected
      ? { ...selected, name: editorName, description: editorDescription, jql: editorJql }
      : {
          id: newFilterId(),
          name: editorName,
          description: editorDescription,
          jql: editorJql,
          isFavorite: false,
          created: new Date().toISOString(),
          lastUsed: null,
        };
    try {
      const saved = await filtersApi.save(filter);
      setSelectedId((saved ?? filter).id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const run = async () => {
    if (!editorJql.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // §5: Run executes the editor JQL (not the saved copy), maxResults 200.
      const page = await issuesApi.search(editorJql, 0, 200);
      setResults(page.items);
      if (selected) {
        const stamped: SavedFilter = { ...selected, lastUsed: new Date().toISOString() };
        await filtersApi.save(stamped);
        await loadList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await filtersApi.remove(selected.id);
      setSelectedId(null);
      setEditorName('');
      setEditorDescription('');
      setEditorJql('');
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const resultColumns: GridColumn<JiraIssue>[] = useMemo(
    () => [
      {
        key: 'key',
        header: 'Key',
        width: 100,
        render: (i) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{i.key}</span>,
      },
      { key: 'summary', header: 'Summary', width: 420 },
      {
        key: 'status',
        header: 'Status',
        width: 120,
        render: (i) => <span style={{ color: statusColor(i.status) }}>{i.status}</span>,
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 100,
        render: (i) => <span style={{ color: priorityColor(i.priority) }}>{i.priority}</span>,
      },
    ],
    [],
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 14, padding: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16 }}>Saved Filters</h2>
          <button className="btn" onClick={newFilter}>
            New filter
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '70vh', overflowY: 'auto' }}>
          {filters.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>
              No saved filters yet.
            </div>
          ) : (
            filters.map((f) => (
              <div
                key={f.id}
                onClick={() => select(f)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: f.id === selectedId ? 'color-mix(in srgb, var(--accent-cyan) 12%, transparent)' : 'transparent',
                  border: '1px solid ' + (f.id === selectedId ? 'var(--border-strong)' : 'transparent'),
                }}
              >
                <div style={{ fontWeight: 600 }}>{f.name}</div>
                {f.description ? (
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {f.description}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>
          Name
          <input value={editorName} onChange={(e) => setEditorName(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
        </label>
        <label>
          Description
          <input
            value={editorDescription}
            onChange={(e) => setEditorDescription(e.target.value)}
            style={{ width: '100%', marginTop: 4 }}
          />
        </label>
        <label>
          JQL
          <textarea
            value={editorJql}
            onChange={(e) => setEditorJql(e.target.value)}
            style={{ width: '100%', height: 120, marginTop: 4, resize: 'vertical', fontFamily: 'Consolas, monospace' }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
          <button className="btn" onClick={() => void run()} disabled={busy}>
            Run
          </button>
          <button className="btn" onClick={() => void remove()} disabled={!selected}>
            Delete
          </button>
          {busy ? <span className="accent-cyan">…</span> : null}
        </div>
        {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
        <DataGrid<JiraIssue>
          stateKey="Filters.Results"
          columns={resultColumns}
          rows={results}
          rowKey={(i) => i.key}
          onRowDoubleClick={(i) => dialogs.openIssueDetails(i.key)}
          emptyText="No results."
          maxHeight={420}
        />
      </div>
    </div>
  );
}
