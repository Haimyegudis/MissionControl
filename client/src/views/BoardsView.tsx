// Boards Search (ui-parity-contract.md §4): header + Total, live client-side
// search (Name OR FilterName), Reload / Force refresh, error + diagnostics
// lines, DataGrid 'BoardSearch.Boards' with 📌 Pin column. Indigo-only board
// list; loads on session change only (no scheduler tick).

import { useEffect, useMemo, useRef, useState } from 'react';
import { boards as boardsApi } from '../api/client';
import { DataGrid } from '../components/DataGrid';
import type { GridColumn } from '../components/DataGrid';
import {
  filterIndigoBoards,
  formatBoardDiagnostics,
  searchBoards,
  type BoardDiagnostics,
} from '../lib/viewBoards';
import { sessionStore } from '../stores/session';
import { pinBoard } from '../stores/pinnedBoards';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { JiraBoard } from '../types';

export function BoardsView() {
  const session = useStore(sessionStore);
  const connected = session.phase === 'connected';

  const [allBoards, setAllBoards] = useState<JiraBoard[]>([]);
  const [diagnostics, setDiagnostics] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0);

  const load = async (force = false) => {
    const seq = ++loadSeq.current;
    setBusy(true);
    setError(null);
    try {
      // Server strips the Greenhopper/Agile source split from /api/boards
      // (diagnostics stay server-side); accept either shape defensively so
      // the verbatim BoardLoadResult line renders in full when available.
      const raw = (await boardsApi.list(force)) as
        | JiraBoard[]
        | { boards: JiraBoard[]; fromGreenhopper: number; fromAgile: number; greenhopperError: string | null; agileError: string | null };
      if (seq !== loadSeq.current) return;
      const list = Array.isArray(raw) ? raw : raw.boards;
      const indigo = filterIndigoBoards(list);
      const diag: BoardDiagnostics = Array.isArray(raw)
        ? { fromGreenhopper: null, fromAgile: null, greenhopperError: null, agileError: null, total: list.length, indigoCount: indigo.length }
        : {
            fromGreenhopper: raw.fromGreenhopper,
            fromAgile: raw.fromAgile,
            greenhopperError: raw.greenhopperError,
            agileError: raw.agileError,
            total: list.length,
            indigoCount: indigo.length,
          };
      setAllBoards(indigo);
      setDiagnostics(formatBoardDiagnostics(diag));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  // §4: loads on session change; no scheduler.
  useEffect(() => {
    if (connected) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const filtered = useMemo(() => searchBoards(allBoards, search), [allBoards, search]);

  const pin = async (board: JiraBoard) => {
    try {
      await pinBoard({ boardId: board.id, name: board.name, filterId: board.filterId });
      pushToast({ title: 'Board pinned', body: board.name });
    } catch (err) {
      pushToast({ title: 'Pin failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const columns: GridColumn<JiraBoard>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', width: 420 },
      { key: 'type', header: 'Type', width: 120 },
      { key: 'filterName', header: 'Filter', width: 160, format: (b) => b.filterName ?? '' },
      {
        key: 'pin',
        header: 'Pin',
        width: 80,
        format: () => '',
        sortValue: () => null,
        render: (b) => (
          <button className="btn" style={{ padding: '2px 8px', fontSize: 11.5 }} onClick={() => void pin(b)}>
            📌 Pin
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ fontSize: 18 }}>Boards Search</h2>
        <span className="muted">Total: {filtered.length}</span>
        {busy ? <span className="accent-cyan">…</span> : null}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search boards..."
          style={{ width: 280 }}
        />
        <button className="btn" onClick={() => void load()} disabled={busy}>
          Reload
        </button>
        <button
          className="btn"
          title="Drop cache and pull boards fresh from Jira"
          onClick={() => void load(true)}
          disabled={busy}
        >
          Force refresh
        </button>
      </div>

      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
      {diagnostics ? (
        <div className="muted" style={{ fontSize: 11.5 }}>
          {diagnostics}
        </div>
      ) : null}

      <DataGrid<JiraBoard>
        stateKey="BoardSearch.Boards"
        columns={columns}
        rows={filtered}
        rowKey={(b) => String(b.id)}
        emptyText="No boards available. Click Reload, or check your Jira agile/board permissions."
      />
    </div>
  );
}
