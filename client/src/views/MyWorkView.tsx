// My Work view (ui-parity-contract.md §2) — toolbar (live key/summary search,
// assignee picker, Kanban checkbox), DataGrid 'MyWork.Issues' with four
// cascading column-filter popups, saved queries (save/delete/export/import),
// quick-filter chips in kanban mode, row context menu with bulk operations,
// pinned-board mode via `#/mywork?board={id}&filter={fid}&name=`, data through
// POST /api/issues/cached-search (server-side delta semantics), scheduler tick
// + session change reload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, boards as boardsApi, issues as issuesApi } from '../api/client';
import { ContextMenu, type MenuEntry } from '../components/ContextMenu';
import { DataGrid, type GridColumn } from '../components/DataGrid';
import { Kanban } from '../components/Kanban';
import { statusSubmenu } from '../components/StatusMenu';
import { useTextPrompt } from '../components/TextPrompt';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { priorityColor, starColor, statusColor } from '../lib/colors';
import { formatDateTime, formatTimeSpan } from '../lib/format';
import { needsCloseDialog, pickTransition, stampOriginalOrder } from '../lib/viewDashboard';
import {
  buildOptions,
  emptyMyWorkFilters,
  filterRows,
  MY_WORK_FILTER_KEYS,
  type MyWorkFilterKey,
  type MyWorkFilters,
} from '../lib/viewMyWorkFilters';
import {
  applyAssigneeFilter,
  applyQuickFilter,
  boardHash,
  boardModeJql,
  defaultMyWorkJql,
  parseBoardParams,
  type BoardParams,
} from '../lib/viewMyWorkJql';
import { onTick } from '../stores/scheduler';
import { sessionStore } from '../stores/session';
import { getSettings, loadSettings, settingsStore, updateSettings } from '../stores/settings';
import { applyStarred, toggleStarred } from '../stores/starred';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { JiraIssue, JiraQuickFilter, SavedQuery } from '../types';

interface CachedSearchResult {
  issues: JiraIssue[];
  totalCount: number;
  fromCache: boolean;
  lastRefresh: string;
}

const SAVED_QUERY_CAP = 25;
const BULK_OPEN_CAP = 8;

const FILTER_LABELS: Record<MyWorkFilterKey, string> = {
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
};

/** Navigate into pinned-board mode (§2 LoadForBoard contract). */
export function loadForBoard(boardId: number, filterId: number | null, name: string): void {
  window.location.hash = boardHash(boardId, filterId, name);
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Merge imported queries into existing by name (imported wins), cap 25. */
export function mergeSavedQueries(existing: SavedQuery[], imported: SavedQuery[]): SavedQuery[] {
  const out = [...existing];
  for (const q of imported) {
    if (!q || typeof q.name !== 'string' || typeof q.jql !== 'string' || !q.name) continue;
    const at = out.findIndex((e) => e.name.toLowerCase() === q.name.toLowerCase());
    if (at >= 0) out[at] = { name: q.name, jql: q.jql };
    else out.push({ name: q.name, jql: q.jql });
  }
  return out.slice(0, SAVED_QUERY_CAP);
}

interface FilterPopupProps {
  options: string[];
  checked: string[];
  onApply: (values: string[]) => void;
  onClose: () => void;
}

function FilterPopup({ options, checked, onApply, onClose }: FilterPopupProps) {
  const [pending, setPending] = useState<Set<string>>(() => new Set(checked.map((v) => v.toLowerCase())));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const toggle = (name: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      const lower = name.toLowerCase();
      if (next.has(lower)) next.delete(lower);
      else next.add(lower);
      return next;
    });
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 4,
        width: 220,
        zIndex: 3000,
        background: 'var(--bg-panel-high)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        boxShadow: 'var(--shadow-card)',
        padding: 8,
      }}
    >
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.length === 0 ? (
          <div className="muted" style={{ fontSize: 12, padding: 6 }}>
            No options.
          </div>
        ) : (
          options.map((name) => (
            <label
              key={name}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '2px 4px', cursor: 'pointer' }}
            >
              <input type="checkbox" checked={pending.has(name.toLowerCase())} onChange={() => toggle(name)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            </label>
          ))
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <button
          className="btn"
          style={{ padding: '3px 10px', fontSize: 11.5 }}
          onClick={() => {
            onApply([]);
            onClose();
          }}
        >
          Clear
        </button>
        <button
          className="btn btn-primary"
          style={{ padding: '3px 10px', fontSize: 11.5 }}
          onClick={() => {
            onApply(options.filter((o) => pending.has(o.toLowerCase())));
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export interface MyWorkViewProps {
  /** Pinned-board mode override; otherwise parsed from the location hash. */
  board?: BoardParams | null;
}

export function MyWorkView({ board: boardProp }: MyWorkViewProps = {}) {
  const settings = useStore(settingsStore);
  const [board, setBoard] = useState<BoardParams | null>(
    () => boardProp ?? (typeof window !== 'undefined' ? parseBoardParams(window.location.hash) : null),
  );
  const [jql, setJql] = useState('');
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [keyContains, setKeyContains] = useState('');
  const [assigneeUser, setAssigneeUser] = useState('');
  const [kanban, setKanban] = useState(false);
  const [filters, setFilters] = useState<MyWorkFilters>(emptyMyWorkFilters);
  const [openFilter, setOpenFilter] = useState<MyWorkFilterKey | null>(null);
  const [quickFilters, setQuickFilters] = useState<JiraQuickFilter[]>([]);
  const [activeQuick, setActiveQuick] = useState<string | null>(null);
  const [roster, setRoster] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<JiraIssue[]>([]);
  const [rowMenu, setRowMenu] = useState<{ row: JiraIssue; x: number; y: number } | null>(null);

  const { element: promptElement, prompt } = useTextPrompt();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jqlRef = useRef(jql);
  jqlRef.current = jql;
  const loadSeq = useRef(0);
  const rosterLoaded = useRef(false);

  const load = useCallback(async (nextJql?: string) => {
    const seq = ++loadSeq.current;
    await loadSettings().catch(() => undefined);
    const project = getSettings().defaultProjectKey || 'ISW';
    const query = nextJql ?? jqlRef.current ?? '';
    const effective = query || defaultMyWorkJql(project);
    if (!query) {
      jqlRef.current = effective;
      setJql(effective);
    }
    try {
      const result = await api.post<CachedSearchResult>('/api/issues/cached-search', {
        cacheKey: `mywork:${effective}`,
        jql: effective,
        maxResults: 200,
      });
      if (seq !== loadSeq.current) return;
      setIssues(applyStarred(stampOriginalOrder(result.issues)));
      setTotalCount(result.totalCount);
    } catch (err) {
      if (seq === loadSeq.current) {
        pushToast({ title: 'My Work load failed', body: err instanceof Error ? err.message : String(err) });
      }
    }

    // Roster: populate once — sprint JQL (1000) + current user.
    if (!rosterLoaded.current) {
      rosterLoaded.current = true;
      issuesApi
        .search(`project = ${project} AND sprint in openSprints() ORDER BY updated DESC`, 0, 1000)
        .then((page) => {
          const names = new Set<string>();
          for (const issue of page.items) if (issue.assignee) names.add(issue.assignee);
          const me = sessionStore.get().user?.displayName;
          if (me) names.add(me);
          setRoster([...names]);
        })
        .catch(() => {
          rosterLoaded.current = false;
        });
    }
  }, []);

  // Board-mode entry: force kanban, clear assignee filter (no reload trigger),
  // board JQL, Greenhopper quick filters (empty/failed → assignee chips).
  const enterBoardMode = useCallback(
    async (b: BoardParams) => {
      await loadSettings().catch(() => undefined);
      const project = getSettings().defaultProjectKey || 'ISW';
      setKanban(true);
      setAssigneeUser('');
      setActiveQuick(null);
      const nextJql = boardModeJql(b.filterId, project);
      jqlRef.current = nextJql;
      setJql(nextJql);
      void load(nextJql);
      boardsApi
        .quickFilters(b.boardId)
        .then((qf) => setQuickFilters(qf))
        .catch(() => setQuickFilters([]));
    },
    [load],
  );

  // Mount + hash-driven board mode + scheduler/session reload.
  useEffect(() => {
    const initial = boardProp ?? parseBoardParams(window.location.hash);
    setBoard(initial);
    if (initial) void enterBoardMode(initial);
    else void load();

    const onHashChange = () => {
      const parsed = parseBoardParams(window.location.hash);
      setBoard(parsed);
      if (parsed) void enterBoardMode(parsed);
    };
    window.addEventListener('hashchange', onHashChange);
    const offTick = onTick(() => void load());
    const offSession = sessionStore.subscribe((s) => {
      if (s.phase === 'connected') void load();
    });
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      offTick();
      offSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardProp]);

  // Assignee filter → JQL rewrite reload.
  const commitAssignee = (user: string) => {
    setAssigneeUser(user);
    const next = applyAssigneeFilter(jqlRef.current, user);
    jqlRef.current = next;
    setJql(next);
    void load(next);
  };

  // Quick-filter chip → clause swap reload.
  const applyChip = (query: string | null) => {
    const next = applyQuickFilter(jqlRef.current, query, activeQuick);
    setActiveQuick(query && query.trim() ? query : null);
    jqlRef.current = next;
    setJql(next);
    void load(next);
  };

  const patchRow = useCallback((issue: JiraIssue) => {
    setIssues((prev) =>
      prev.map((i) =>
        i.key.toLowerCase() === issue.key.toLowerCase()
          ? { ...issue, originalOrder: i.originalOrder, isStarred: i.isStarred }
          : i,
      ),
    );
  }, []);

  const patchRowFromServer = useCallback(
    (key: string) => {
      issuesApi
        .details(key)
        .then((d) => patchRow(d.issue))
        .catch(() => void load());
    },
    [patchRow, load],
  );

  const handleToggleStar = (issue: JiraIssue) => {
    setIssues((prev) => prev.map((i) => (i.key === issue.key ? { ...i, isStarred: !i.isStarred } : i)));
    void toggleStarred(issue.key);
  };

  // Kanban drag → same transition flow as Dashboard (§16 gotcha 1).
  const handleDrop = async (issue: JiraIssue, columnTitle: string) => {
    try {
      const transitions = await issuesApi.transitions(issue.key);
      const transition = pickTransition(transitions, columnTitle);
      if (!transition) {
        alert(`No workflow transition leads from '${issue.status}' to '${columnTitle}'.`);
        return;
      }
      const screen = await issuesApi.transitionScreen(issue.key, transition.id);
      if (screen.length > 0 || needsCloseDialog(columnTitle, transition.name)) {
        dialogs.openTransition(issue.key, transition, screen, () => {
          void load();
          pushToast({ title: 'Status changed', body: `${issue.key} → ${columnTitle}` });
        });
        return;
      }
      await issuesApi.performTransition(issue.key, { id: transition.id });
      void load();
      pushToast({ title: 'Status changed', body: `${issue.key} → ${columnTitle}` });
    } catch (err) {
      pushToast({
        title: 'Drop failed',
        body: `${issue.key}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // -------------------------------------------------------------------------
  // Saved queries
  // -------------------------------------------------------------------------

  const saveQuery = async () => {
    const name = await prompt('Save query', 'Name for this query:');
    if (name === null || !name.trim()) return;
    const trimmed = name.trim();
    const current = getSettings().savedQueries ?? [];
    const without = current.filter((q) => q.name.toLowerCase() !== trimmed.toLowerCase());
    const next = [{ name: trimmed, jql: jqlRef.current }, ...without].slice(0, SAVED_QUERY_CAP);
    await updateSettings({ savedQueries: next });
    pushToast({ title: 'Query saved', body: trimmed });
  };

  const deleteQuery = async (name: string) => {
    const current = getSettings().savedQueries ?? [];
    await updateSettings({ savedQueries: current.filter((q) => q.name !== name) });
    pushToast({ title: 'Query deleted', body: name });
  };

  const exportQueries = () => {
    downloadJson('queries.json', JSON.stringify(getSettings().savedQueries ?? [], null, 2));
    pushToast({ title: 'Queries exported', body: 'queries.json' });
  };

  const importQueries = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SavedQuery[];
      if (!Array.isArray(parsed)) throw new Error('queries.json must contain an array.');
      const merged = mergeSavedQueries(getSettings().savedQueries ?? [], parsed);
      await updateSettings({ savedQueries: merged });
      pushToast({ title: 'Queries imported', body: `${merged.length} saved queries` });
    } catch (err) {
      pushToast({ title: 'Import failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const selectQuery = (q: SavedQuery) => {
    jqlRef.current = q.jql;
    setJql(q.jql);
    void load(q.jql);
  };

  // -------------------------------------------------------------------------
  // Row context menu
  // -------------------------------------------------------------------------

  const bulkTargets = (row: JiraIssue): JiraIssue[] =>
    selectedRows.length > 0 ? selectedRows : [row];

  const runBulk = async (keys: string[], op: (key: string) => Promise<unknown>, title: string) => {
    let ok = 0;
    let fail = 0;
    for (const key of keys) {
      try {
        await op(key);
        ok++;
      } catch {
        fail++;
      }
    }
    pushToast({ title, body: `${ok} succeeded, ${fail} failed` });
    void load();
  };

  const rowMenuEntries = (row: JiraIssue): MenuEntry[] => {
    const targets = bulkTargets(row);
    const keys = targets.map((t) => t.key);
    return [
      { label: 'Open details', onClick: () => dialogs.openIssueDetails(row.key) },
      {
        label: 'Change status',
        submenu: statusSubmenu(row.key, {
          onNeedsDialog: (transition, screen) =>
            dialogs.openTransition(row.key, transition, screen, () => patchRowFromServer(row.key)),
          onPatched: patchRow,
        }),
      },
      'separator',
      {
        label: 'Bulk: add comment to selected',
        onClick: () => {
          void (async () => {
            const body = await prompt('Bulk comment', `Comment to add to ${keys.length} selected issue(s):`);
            if (body === null || !body.trim()) return;
            await runBulk(keys, (key) => issuesApi.addComment(key, body), 'Bulk comment');
          })();
        },
      },
      {
        label: 'Bulk: add label to selected',
        onClick: () => {
          void (async () => {
            const label = await prompt('Bulk label', `Label to add to ${keys.length} selected issue(s):`);
            if (label === null || !label.trim()) return;
            await runBulk(keys, (key) => issuesApi.addLabel(key, label.trim()), 'Bulk label');
          })();
        },
      },
      {
        label: 'Bulk: open all selected',
        onClick: () => {
          for (const key of keys.slice(0, BULK_OPEN_CAP)) dialogs.openIssueDetails(key);
        },
      },
      {
        label: 'Bulk: copy keys to clipboard',
        onClick: () => {
          const joined = keys.join(',');
          void navigator.clipboard?.writeText(joined);
          pushToast({ title: 'Copied', body: joined });
        },
      },
    ];
  };

  // -------------------------------------------------------------------------
  // Derived view data
  // -------------------------------------------------------------------------

  const viewRows = useMemo(
    () => filterRows(issues, filters, keyContains),
    [issues, filters, keyContains],
  );

  const filterOptions = useMemo(() => {
    const out = {} as Record<MyWorkFilterKey, string[]>;
    for (const key of MY_WORK_FILTER_KEYS) out[key] = buildOptions(issues, filters, key);
    return out;
  }, [issues, filters]);

  // Quick-filter chips: board quick filters, else distinct assignees (§2).
  const chips = useMemo<Array<{ name: string; query: string }>>(() => {
    if (board && quickFilters.length > 0) {
      return quickFilters.map((q) => ({ name: q.name, query: q.query }));
    }
    const names = new Map<string, string>();
    for (const issue of issues) {
      if (issue.assignee && !names.has(issue.assignee.toLowerCase())) {
        names.set(issue.assignee.toLowerCase(), issue.assignee);
      }
    }
    return [...names.values()]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((name) => ({ name, query: `assignee = "${name}"` }));
  }, [board, quickFilters, issues]);

  const columns = useMemo<GridColumn<JiraIssue>[]>(
    () => [
      {
        key: 'star',
        header: '★',
        width: 34,
        sortValue: (r) => (r.isStarred ? 1 : 0),
        format: (r) => (r.isStarred ? '★' : ''),
        render: (r) => (
          <span
            title="Star this issue (cross-tab)"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleStar(r);
            }}
            style={{ color: starColor(r.isStarred), cursor: 'pointer' }}
          >
            ★
          </span>
        ),
      },
      { key: 'sprint', header: 'Sprint', width: 160 },
      {
        key: 'key',
        header: 'Key',
        width: 100,
        render: (r) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{r.key}</span>,
      },
      { key: 'summary', header: 'Summary', width: 320 },
      { key: 'issueType', header: 'Type', width: 120 },
      {
        key: 'status',
        header: 'Status',
        width: 140,
        render: (r) => <span style={{ color: statusColor(r.status) }}>{r.status}</span>,
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 120,
        render: (r) => <span style={{ color: priorityColor(r.priority) }}>{r.priority}</span>,
      },
      { key: 'assignee', header: 'Assignee', width: 180 },
      {
        key: 'updated',
        header: 'Updated',
        width: 160,
        format: (r) => formatDateTime(r.updated),
        sortValue: (r) => r.updated ?? '',
      },
      {
        key: 'created',
        header: 'Created',
        width: 160,
        format: (r) => formatDateTime(r.created),
        sortValue: (r) => r.created ?? '',
      },
      {
        key: 'timeSpent',
        header: 'Time Spent',
        width: 100,
        format: (r) => formatTimeSpan(r.timeSpent),
        sortValue: (r) => r.timeSpent ?? 0,
      },
      {
        key: 'remainingEstimate',
        header: 'Remaining',
        width: 100,
        format: (r) => formatTimeSpan(r.remainingEstimate),
        sortValue: (r) => r.remainingEstimate ?? 0,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const savedQueries = settings.savedQueries ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{board?.name ? board.name : 'My Work'}</div>
        <input
          value={keyContains}
          onChange={(e) => setKeyContains(e.target.value)}
          placeholder="🔍 Search by key or summary..."
          style={{ width: 260 }}
        />
        <UserSearchPicker users={roster} value={assigneeUser} onCommit={commitAssignee} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={kanban} onChange={(e) => setKanban(e.target.checked)} />
          Kanban
        </label>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
          {`${viewRows.length} of ${totalCount || issues.length}`}
        </span>
      </div>

      {/* Saved queries */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
          SAVED QUERIES:
        </span>
        {savedQueries.map((q) => (
          <span
            key={q.name}
            title={q.jql}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--border-soft)',
              borderRadius: 999,
              padding: '2px 10px',
              fontSize: 11.5,
              cursor: 'pointer',
              color: 'var(--accent-cyan)',
            }}
          >
            <span onClick={() => selectQuery(q)}>{q.name}</span>
            <span
              title="Delete saved query"
              className="muted"
              onClick={() => void deleteQuery(q.name)}
              style={{ cursor: 'pointer' }}
            >
              ✕
            </span>
          </span>
        ))}
        <button className="btn" style={{ padding: '2px 10px', fontSize: 11.5 }} onClick={() => void saveQuery()}>
          Save query
        </button>
        <button className="btn" style={{ padding: '2px 10px', fontSize: 11.5 }} onClick={exportQueries}>
          Export
        </button>
        <button
          className="btn"
          style={{ padding: '2px 10px', fontSize: 11.5 }}
          onClick={() => fileInputRef.current?.click()}
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importQueries(file);
          }}
        />
      </div>

      {kanban ? (
        <>
          {/* Quick-filter chip row (kanban mode only) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
              QUICK FILTERS:
            </span>
            <button
              className="btn"
              onClick={() => applyChip(null)}
              style={{
                padding: '2px 10px',
                fontSize: 11.5,
                color: activeQuick === null ? 'var(--accent-cyan)' : undefined,
                borderColor: activeQuick === null ? 'var(--accent-cyan)' : undefined,
              }}
            >
              All
            </button>
            {chips.map((chip) => (
              <button
                key={chip.name}
                className="btn"
                title={chip.query}
                onClick={() => applyChip(chip.query)}
                style={{
                  padding: '2px 10px',
                  fontSize: 11.5,
                  color: activeQuick === chip.query ? 'var(--accent-cyan)' : 'var(--accent-cyan)',
                  borderColor: activeQuick === chip.query ? 'var(--accent-cyan)' : undefined,
                  fontWeight: activeQuick === chip.query ? 700 : undefined,
                }}
              >
                {chip.name}
              </button>
            ))}
          </div>
          <Kanban
            issues={viewRows}
            variant="minimal"
            onOpen={(issue) => dialogs.openIssueDetails(issue.key)}
            onDrop={(issue, columnTitle) => void handleDrop(issue, columnTitle)}
          />
        </>
      ) : (
        <>
          {/* Column filter popups (Type / Status / Priority / Assignee) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {MY_WORK_FILTER_KEYS.map((key) => (
              <div key={key} style={{ position: 'relative' }}>
                <button
                  className="btn"
                  style={{ padding: '3px 10px', fontSize: 11.5 }}
                  onClick={() => setOpenFilter((cur) => (cur === key ? null : key))}
                >
                  {FILTER_LABELS[key]} ▾
                  {filters[key].length > 0 ? (
                    <span style={{ color: 'var(--accent-cyan)', marginLeft: 4 }}>({filters[key].length})</span>
                  ) : null}
                </button>
                {openFilter === key ? (
                  <FilterPopup
                    options={filterOptions[key]}
                    checked={filters[key]}
                    onApply={(values) => setFilters((prev) => ({ ...prev, [key]: values }))}
                    onClose={() => setOpenFilter(null)}
                  />
                ) : null}
              </div>
            ))}
          </div>
          <DataGrid
            stateKey="MyWork.Issues"
            columns={columns}
            rows={viewRows}
            rowKey={(r) => r.key}
            multiSelect
            onSelectionChange={setSelectedRows}
            onRowDoubleClick={(r) => dialogs.openIssueDetails(r.key)}
            onRowContextMenu={(row, e) => setRowMenu({ row, x: e.clientX, y: e.clientY })}
            emptyText="No issues."
          />
        </>
      )}

      {rowMenu ? (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          entries={rowMenuEntries(rowMenu.row)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
      {promptElement}
    </div>
  );
}
