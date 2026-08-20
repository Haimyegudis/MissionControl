// My Work view (ui-parity-contract.md §2) — toolbar (live key/summary search,
// assignee picker, Kanban checkbox), DataGrid 'MyWork.Issues' with four
// cascading column-filter popups, saved queries (save/delete/export/import),
// quick-filter chips in kanban mode, row context menu with bulk operations,
// pinned-board mode via `#/mywork?board={id}&filter={fid}&name=`, data through
// POST /api/issues/cached-search (server-side delta semantics), scheduler tick
// + session change reload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, boards as boardsApi, issues as issuesApi, metadataExtra } from '../api/client';
import { ContextMenu, type MenuEntry } from '../components/ContextMenu';
import { DataGrid, type GridColumn } from '../components/DataGrid';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Kanban } from '../components/Kanban';
import { statusSubmenu } from '../components/StatusMenu';
import { useTextPrompt } from '../components/TextPrompt';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { mapWithConcurrency } from '../lib/asyncPool';
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
  applySprintOnly,
  boardHash,
  boardModeJql,
  defaultMyWorkJql,
  MY_WORK_ORDER_BY,
  parseBoardParams,
  splitOrderBy,
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

type RiskFilter = 'all' | 'blocked' | 'critical' | 'unassigned' | 'stale' | 'changed';
interface MonitoringView {
  name: string;
  risk: RiskFilter;
  updatedWithin: number;
  search: string;
  filters: MyWorkFilters;
}

const MONITOR_VIEWS_KEY = 'mc.mywork.monitorViews';

function sharedMyWorkParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get(name);
}

function loadMonitoringViews(): MonitoringView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MONITOR_VIEWS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function MyWorkView({ board: boardProp }: MyWorkViewProps = {}) {
  const settings = useStore(settingsStore);
  const [board, setBoard] = useState<BoardParams | null>(
    () => boardProp ?? (typeof window !== 'undefined' ? parseBoardParams(window.location.hash) : null),
  );
  const [jql, setJql] = useState('');
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [keyContains, setKeyContains] = useState(() => sharedMyWorkParam('search') ?? '');
  const [assigneeUser, setAssigneeUser] = useState('');
  const [kanban, setKanban] = useState(false);
  const [filters, setFilters] = useState<MyWorkFilters>(() => {
    try {
      const encoded = sharedMyWorkParam('filters');
      return encoded ? { ...emptyMyWorkFilters(), ...JSON.parse(encoded) } : emptyMyWorkFilters();
    } catch { return emptyMyWorkFilters(); }
  });
  const [openFilter, setOpenFilter] = useState<MyWorkFilterKey | null>(null);
  const [quickFilters, setQuickFilters] = useState<JiraQuickFilter[]>([]);
  const [activeQuick, setActiveQuick] = useState<string | null>(null);
  const [roster, setRoster] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<JiraIssue[]>([]);
  const [rowMenu, setRowMenu] = useState<{ row: JiraIssue; x: number; y: number } | null>(null);
  const [bulkAssign, setBulkAssign] = useState<{ keys: string[] } | null>(null);
  /** Days back for the "Updated" filter (0 = any time). */
  const [updatedWithin, setUpdatedWithin] = useState(() => Number(sharedMyWorkParam('updated')) || 0);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>(() => {
    const value = sharedMyWorkParam('risk');
    return ['blocked', 'critical', 'unassigned', 'stale', 'changed'].includes(value ?? '') ? value as RiskFilter : 'all';
  });
  const [monitoringViews, setMonitoringViews] = useState<MonitoringView[]>(loadMonitoringViews);
  /** Board mode: scope to the open sprint (default on — boards show the
   *  current sprint, not the whole backlog the board filter matches). */
  const [sprintOnly, setSprintOnly] = useState(true);

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
        pushToast({ title: 'Backlog load failed', body: err instanceof Error ? err.message : String(err) });
      }
    }

    // Roster: populate once from Indigo current-sprint issues + current user.
    // Issue mapping always uses Jira displayName, never login/email.
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
  // The board's saved filter usually embeds `assignee = currentUser()` — using
  // `filter = N` verbatim showed only YOUR issues and made picking a teammate
  // return nothing. We fetch the raw filter JQL and strip its assignee clause
  // so the whole team's board shows.
  const enterBoardMode = useCallback(
    async (b: BoardParams) => {
      await loadSettings().catch(() => undefined);
      const project = getSettings().defaultProjectKey || 'ISW';
      setKanban(true);
      setAssigneeUser('');
      setActiveQuick(null);
      // Old rows are a different query — clear instead of showing stale data.
      setIssues([]);
      setTotalCount(0);
      let nextJql = boardModeJql(b.filterId, project);
      if (b.filterId !== null && b.filterId !== undefined) {
        try {
          const { jql: rawFilterJql } = await boardsApi.filterJql(b.filterId);
          if (rawFilterJql && rawFilterJql.trim()) {
            const { body } = splitOrderBy(applyAssigneeFilter(rawFilterJql, ''));
            nextJql = `${body} AND statusCategory != Done ${MY_WORK_ORDER_BY}`;
          }
        } catch {
          /* fall back to filter = N */
        }
      }
      // Boards open scoped to the current sprint — the saved board filter
      // matches the whole backlog, which is not what a sprint board shows.
      setSprintOnly(true);
      nextJql = applySprintOnly(nextJql, true);
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

  // Assignee filter → JQL rewrite reload. Display names are not valid JQL
  // usernames — resolve to the login first (fallback: raw text).
  const commitAssignee = (user: string) => {
    setAssigneeUser(user);
    void (async () => {
      let jqlUser = user.trim();
      if (jqlUser) {
        try {
          const { username } = await metadataExtra.resolveUser(jqlUser);
          if (username) jqlUser = username;
        } catch {
          /* keep raw text */
        }
      }
      const next = applyAssigneeFilter(jqlRef.current, jqlUser);
      jqlRef.current = next;
      setJql(next);
      void load(next);
    })();
  };

  // Board sprint scope toggle → JQL clause add/remove + reload.
  const toggleSprintOnly = (on: boolean) => {
    setSprintOnly(on);
    const next = applySprintOnly(jqlRef.current, on);
    jqlRef.current = next;
    setJql(next);
    void load(next);
  };

  // Quick-filter chip → clause swap reload (trimmed so add/remove match).
  const applyChip = (query: string | null) => {
    const trimmed = query && query.trim() ? query.trim() : null;
    const next = applyQuickFilter(jqlRef.current, trimmed, activeQuick);
    setActiveQuick(trimmed);
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
        pushToast({ title: 'No transition', body: `No workflow transition leads from '${issue.status}' to '${columnTitle}'.`, severity: 'error' });
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
    const results = await mapWithConcurrency(keys, 4, op);
    const fail = results.filter((result) => result.status === 'rejected').length;
    const ok = results.length - fail;
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
        label: 'Bulk: change status of selected',
        onClick: () => {
          void (async () => {
            const target = await prompt(
              'Bulk transition',
              `Target status for ${keys.length} selected issue(s) (e.g. In Progress, Done):`,
            );
            if (target === null || !target.trim()) return;
            const wanted = target.trim().toLowerCase();
            await runBulk(
              keys,
              async (key) => {
                const transitions = await issuesApi.transitions(key);
                const t =
                  transitions.find((x) => (x.toStatus ?? '').toLowerCase() === wanted) ??
                  transitions.find((x) => (x.toStatus ?? '').toLowerCase().includes(wanted)) ??
                  transitions.find((x) => x.name.toLowerCase().includes(wanted));
                if (!t) throw new Error(`no transition to '${target}'`);
                await issuesApi.performTransition(key, { id: t.id });
              },
              'Bulk transition',
            );
          })();
        },
      },
      {
        label: 'Bulk: assign selected to…',
        onClick: () => setBulkAssign({ keys }),
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

  const viewRows = useMemo(() => {
    let rows = filterRows(issues, filters, keyContains);
    // "Updated within" filter — replaces the removed Recent Updates page.
    if (updatedWithin > 0) {
      const cutoff = Date.now() - updatedWithin * 86_400_000;
      rows = rows.filter((i) => {
        const t = i.updated ? new Date(i.updated).getTime() : 0;
        return t >= cutoff;
      });
    }
    if (riskFilter === 'blocked') rows = rows.filter((issue) => issue.isBlocked || /block/i.test(issue.status));
    if (riskFilter === 'critical') rows = rows.filter((issue) => issue.isCritical || /critical|highest|s1/i.test(issue.priority));
    if (riskFilter === 'unassigned') rows = rows.filter((issue) => !issue.assignee);
    if (riskFilter === 'stale') {
      const cutoff = Date.now() - 7 * 86_400_000;
      rows = rows.filter((issue) => !issue.updated || new Date(issue.updated).getTime() < cutoff);
    }
    if (riskFilter === 'changed') rows = rows.filter((issue) => issue.recentlyChanged);
    return rows;
  }, [issues, filters, keyContains, updatedWithin, riskFilter]);

  const monitoringTotals = useMemo(() => {
    const staleCutoff = Date.now() - 7 * 86_400_000;
    return {
      visible: viewRows.length,
      blocked: issues.filter((issue) => issue.isBlocked || /block/i.test(issue.status)).length,
      critical: issues.filter((issue) => issue.isCritical || /critical|highest|s1/i.test(issue.priority)).length,
      unassigned: issues.filter((issue) => !issue.assignee).length,
      stale: issues.filter((issue) => !issue.updated || new Date(issue.updated).getTime() < staleCutoff).length,
    };
  }, [issues, viewRows.length]);

  const persistMonitoringViews = (next: MonitoringView[]) => {
    setMonitoringViews(next);
    try { localStorage.setItem(MONITOR_VIEWS_KEY, JSON.stringify(next)); } catch { /* unavailable */ }
  };

  const saveMonitoringView = async () => {
    const name = (await prompt('Save monitoring view', 'View name:'))?.trim();
    if (!name) return;
    const view: MonitoringView = { name, risk: riskFilter, updatedWithin, search: keyContains, filters };
    persistMonitoringViews([view, ...monitoringViews.filter((item) => item.name.toLowerCase() !== name.toLowerCase())].slice(0, 20));
    pushToast({ title: 'Monitoring view saved', body: name });
  };

  const applyMonitoringView = (view: MonitoringView) => {
    setRiskFilter(view.risk);
    setUpdatedWithin(view.updatedWithin);
    setKeyContains(view.search);
    setFilters({ ...emptyMyWorkFilters(), ...view.filters });
  };

  const shareMonitoringView = async () => {
    const baseHash = window.location.hash.split('?')[0] || '#/mywork';
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    for (const key of ['search', 'updated', 'risk', 'filters']) params.delete(key);
    if (keyContains) params.set('search', keyContains);
    if (updatedWithin) params.set('updated', String(updatedWithin));
    if (riskFilter !== 'all') params.set('risk', riskFilter);
    if (Object.values(filters).some((values) => values.length)) params.set('filters', JSON.stringify(filters));
    const url = `${window.location.origin}${window.location.pathname}${baseHash}${params.size ? `?${params}` : ''}`;
    await navigator.clipboard.writeText(url);
    pushToast({ title: 'View link copied', body: 'Filters and risk view are included.' });
  };

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
      <PageHeader
        kicker={board ? 'Jira · Board' : 'Jira · Issues'}
        title={board?.name ? board.name : 'Backlog'}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          value={keyContains}
          onChange={(e) => setKeyContains(e.target.value)}
          placeholder="🔍 Search by key or summary..."
          style={{ width: 260 }}
        />
        <UserSearchPicker users={roster} value={assigneeUser} onCommit={commitAssignee} />
        <select
          title="Show only issues updated within…"
          value={updatedWithin}
          onChange={(e) => setUpdatedWithin(Number(e.target.value))}
          style={updatedWithin > 0 ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' } : undefined}
        >
          <option value={0}>Updated: any time</option>
          <option value={1}>Updated: last 24h</option>
          <option value={2}>Updated: 2 days</option>
          <option value={7}>Updated: 7 days</option>
          <option value={30}>Updated: 30 days</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={kanban} onChange={(e) => setKanban(e.target.checked)} />
          Kanban
        </label>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
          {`${viewRows.length} of ${totalCount || issues.length}`}
        </span>
      </div>

      <div
        className="card"
        style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', padding: '7px 9px' }}
      >
        <span className="muted" style={{ fontSize: 10.5, letterSpacing: '0.06em', marginRight: 2 }}>
          MONITOR
        </span>
        {([
          ['all', 'All'],
          ['blocked', `Blocked ${monitoringTotals.blocked}`],
          ['critical', `Critical ${monitoringTotals.critical}`],
          ['unassigned', `Unassigned ${monitoringTotals.unassigned}`],
          ['stale', `Stale 7d ${monitoringTotals.stale}`],
          ['changed', 'Changed'],
        ] as Array<[RiskFilter, string]>).map(([value, label]) => (
          <button
            key={value}
            className={`btn${riskFilter === value ? ' btn-primary' : ''}`}
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => setRiskFilter(value)}
          >
            {label}
          </button>
        ))}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {monitoringTotals.visible} visible · Shift-click headers for multi-sort
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>
          VIEWS
        </span>
        {monitoringViews.map((view) => (
          <span
            key={view.name}
            style={{ display: 'inline-flex', gap: 6, alignItems: 'center', border: '1px solid var(--border-soft)', borderRadius: 999, padding: '2px 8px', fontSize: 11 }}
          >
            <button
              title={`Apply ${view.name}`}
              onClick={() => applyMonitoringView(view)}
              style={{ color: 'var(--accent-cyan)', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
            >
              {view.name}
            </button>
            <button
              title="Delete view"
              className="muted"
              onClick={() => persistMonitoringViews(monitoringViews.filter((item) => item.name !== view.name))}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
            >
              ×
            </button>
          </span>
        ))}
        <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => void saveMonitoringView()}>
          Save view
        </button>
        <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => void shareMonitoringView()}>
          Copy link
        </button>
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
            {board && (
              <label
                title="Only issues in the open sprint (uncheck for the board's full backlog)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  cursor: 'pointer',
                  color: sprintOnly ? 'var(--accent-cyan)' : 'var(--muted)',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 8,
                  padding: '2px 8px',
                }}
              >
                <input
                  type="checkbox"
                  checked={sprintOnly}
                  onChange={(e) => toggleSprintOnly(e.target.checked)}
                />
                Current sprint only
              </label>
            )}
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
      {bulkAssign ? (
        <Modal title={`Assign ${bulkAssign.keys.length} issue(s) to…`} width={420} onClose={() => setBulkAssign(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Search and pick a user — the display name is resolved to the Jira username automatically.
            </div>
            <UserSearchPicker
              users={roster}
              value=""
              width="100%"
              onCommit={(who) => {
                const picked = who.trim();
                const keys = bulkAssign.keys;
                setBulkAssign(null);
                if (!picked) return;
                void (async () => {
                  let jqlUser = picked;
                  try {
                    const { username } = await metadataExtra.resolveUser(picked);
                    if (username) jqlUser = username;
                  } catch {
                    /* keep raw */
                  }
                  await runBulk(keys, (key) => issuesApi.setAssignee(key, jqlUser), `Bulk assign → ${picked}`);
                })();
              }}
            />
          </div>
        </Modal>
      ) : null}
      {promptElement}
    </div>
  );
}
