// Recent Updates feed (ui-parity-contract.md §6): 🔍 User picker, grid
// 'RecentUpdates.Updates' with "What changed" column fed by client-side
// snapshot diffing (lib/viewRecentDiff). JQL verbatim, NOT project-scoped,
// maxResults 50. Refresh: scheduler tick + session change + user pick.

import { useEffect, useMemo, useRef, useState } from 'react';
import { issues as issuesApi, metadata as metadataApi } from '../api/client';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import type { GridColumn } from '../components/DataGrid';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { priorityColor, statusColor } from '../lib/colors';
import { formatDateTime } from '../lib/format';
import { applyChangeDetection, recentUpdatesJql, type IssueSnapshot } from '../lib/viewRecentDiff';
import { onTick } from '../stores/scheduler';
import { sessionStore } from '../stores/session';
import { useStore } from '../stores/useStore';
import type { JiraIssue } from '../types';

// Snapshot of the previous poll — module-level so it survives view remounts
// (the WPF VM is a singleton; parity for "changed since last refresh").
const lastSeen = new Map<string, IssueSnapshot>();

export function RecentUpdatesView() {
  const session = useStore(sessionStore);
  const connected = session.phase === 'connected';

  const [rows, setRows] = useState<JiraIssue[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0);

  const load = async () => {
    if (sessionStore.get().phase !== 'connected') return;
    const seq = ++loadSeq.current;
    setBusy(true);
    setError(null);
    try {
      const page = await issuesApi.search(recentUpdatesJql(userFilter), 0, 50);
      if (seq !== loadSeq.current) return;

      // Roster = feed assignees ∪ project-wide distinct assignees (2000).
      const roster = new Set<string>();
      for (const i of page.items) {
        if (i.assignee?.trim()) roster.add(i.assignee);
      }
      try {
        const project = sessionStore.get().profile?.defaultProjectKey || 'ISW';
        const distinct = await metadataApi.distinct(project, 'assignee', 2000);
        for (const u of distinct) roster.add(u);
      } catch {
        /* roster fetch is best-effort */
      }
      if (seq !== loadSeq.current) return;
      setUsers([...roster].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
      setRows(applyChangeDetection(lastSeen, page.items));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  // Session change + user filter reload.
  useEffect(() => {
    if (connected) void loadRef.current();
  }, [connected, userFilter]);

  // Scheduler tick reload.
  useEffect(() => onTick(() => void loadRef.current()), []);

  const columns: GridColumn<JiraIssue>[] = useMemo(
    () => [
      {
        key: 'key',
        header: 'Key',
        width: 100,
        render: (i) => (
          <span
            style={{
              color: i.recentlyChanged ? 'var(--accent-yellow)' : 'var(--accent-cyan)',
              fontWeight: 600,
            }}
            title={i.recentlyChanged ? 'Changed since last refresh' : undefined}
          >
            {i.key}
          </span>
        ),
      },
      { key: 'summary', header: 'Summary', width: 280 },
      {
        key: 'status',
        header: 'Status',
        width: 140,
        render: (i) => <span style={{ color: statusColor(i.status) }}>{i.status}</span>,
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 100,
        render: (i) => <span style={{ color: priorityColor(i.priority) }}>{i.priority}</span>,
      },
      { key: 'updated', header: 'Updated', width: 160, format: (i) => formatDateTime(i.updated) },
      { key: 'changeSummary', header: 'What changed', width: 320, format: (i) => i.changeSummary ?? '' },
    ],
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 18 }}>Recent Updates</h2>
        <span className="muted">🔍 User:</span>
        <UserSearchPicker users={users} value={userFilter} onCommit={setUserFilter} />
        {busy ? <span className="accent-cyan">…</span> : null}
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
      <ResponsiveGrid<JiraIssue>
        stateKey="RecentUpdates.Updates"
        columns={columns}
        rows={rows}
        rowKey={(i) => i.key}
        onRowDoubleClick={(i) => dialogs.openIssueDetails(i.key)}
        emptyText="No recent updates."
      />
    </div>
  );
}
