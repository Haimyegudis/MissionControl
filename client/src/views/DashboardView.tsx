// Dashboard view (ui-parity-contract.md §1) — KPI widget row from
// GET /api/dashboard/snapshot (filtered/ordered by settings.dashboardWidgets,
// legacy 'Blocked' → 'OnHold'), "My Current Sprint" card with user picker and
// Kanban (default) / Table toggle, drag→transition flow, WIP-limit prompt on
// column-header right-click, scheduler tick + session change reload. Hydration
// paints through /api/issues/cached-search (server returns cache + delta) and
// values commit only after a load succeeds — no clear-then-load flash.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, dashboard as dashboardApi, issues as issuesApi, metadata } from '../api/client';
import type { GridColumn } from '../components/DataGrid';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import { Kanban } from '../components/Kanban';
import { TextPrompt } from '../components/TextPrompt';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { KpiDrilldown } from '../dialogs/KpiDrilldown';
import { PageHeader } from '../components/PageHeader';
import { priorityColor, starColor, statusColor } from '../lib/colors';
import { formatDateTime } from '../lib/format';
import {
  countOnHold,
  dashboardSprintJql,
  formatHoursMinutes,
  needsCloseDialog,
  pickTransition,
  resolveDashboardWidgets,
  sortSprintIssues,
  stampOriginalOrder,
} from '../lib/viewDashboard';
import { onTick } from '../stores/scheduler';
import { sessionStore } from '../stores/session';
import { getSettings, loadSettings, settingsStore, updateSettings } from '../stores/settings';
import { applyStarred, onStarredChange, toggleStarred } from '../stores/starred';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { DashboardSnapshot, JiraIssue } from '../types';

interface CachedSearchResult {
  issues: JiraIssue[];
  totalCount: number;
  fromCache: boolean;
  lastRefresh: string;
}

const SUBTITLE = 'Active-sprint issues assigned to you. Drag cards in Kanban to change status.';

function kpiValue(id: string, snapshot: DashboardSnapshot | null, sprintIssues: JiraIssue[]): string {
  switch (id) {
    case 'OpenIssues':
      return String(snapshot?.openIssues ?? 0);
    case 'Critical':
      return String(snapshot?.criticalIncidents ?? 0);
    case 'OnHold':
      return String(countOnHold(sprintIssues));
    case 'UpdatedToday':
      return String(snapshot?.updatedToday ?? 0);
    case 'LoggedToday':
      return formatHoursMinutes(snapshot?.timeLoggedToday);
    case 'LoggedThisWeek':
      return formatHoursMinutes(snapshot?.timeLoggedThisWeek);
    default:
      return '';
  }
}

export function DashboardView() {
  const settings = useStore(settingsStore);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [sprintIssues, setSprintIssues] = useState<JiraIssue[]>([]);
  const [userFilter, setUserFilter] = useState('');
  const [mode, setMode] = useState<'kanban' | 'table'>('kanban');
  const [roster, setRoster] = useState<string[]>([]);
  const [wipColumn, setWipColumn] = useState<string | null>(null);
  const [drillKpi, setDrillKpi] = useState<{ id: string; title: string } | null>(null);

  const userFilterRef = useRef(userFilter);
  userFilterRef.current = userFilter;
  const loadSeq = useRef(0);
  const distinctRef = useRef<string[] | null>(null);

  const rebuildRoster = useCallback((issues: JiraIssue[]) => {
    const names = new Set<string>();
    for (const issue of issues) if (issue.assignee) names.add(issue.assignee);
    for (const name of distinctRef.current ?? []) if (name) names.add(name);
    setRoster([...names]);
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    await loadSettings().catch(() => undefined);
    const project = getSettings().defaultProjectKey || 'ISW';
    const user = userFilterRef.current.trim();
    const jql = dashboardSprintJql(project, user);

    // Roster tail: assignees found on Indigo project issues, fetched once.
    // The server normalizes Jira user objects to displayName.
    if (distinctRef.current === null) {
      distinctRef.current = [];
      metadata
        .distinct(project, 'assignee', 2000)
        .then((values) => {
          distinctRef.current = values;
          rebuildRoster([]);
        })
        .catch(() => undefined);
    }

    // Sprint issues paint as soon as the cached-search returns (server-side
    // cache + delta); snapshot commits independently. Nothing is cleared
    // beforehand, so a slow refresh never flashes an empty dashboard.
    const sprintPromise = api
      .post<CachedSearchResult>('/api/issues/cached-search', {
        // Versioned because the dashboard used to exclude Done issues. A new
        // namespace prevents the one-hour delta cache from retaining that
        // incomplete result set after upgrading.
        cacheKey: `dashboard:sprint:all-statuses:${project}:${user || 'me'}`,
        jql,
        maxResults: 200,
      })
      .then((result) => {
        if (seq !== loadSeq.current) return;
        const issues = sortSprintIssues(applyStarred(stampOriginalOrder(result.issues)));
        setSprintIssues(issues);
        rebuildRoster(issues);
      });

    const snapshotPromise = dashboardApi.snapshot().then((snap) => {
      if (seq !== loadSeq.current) return;
      setSnapshot(snap);
    });

    try {
      await Promise.all([sprintPromise, snapshotPromise]);
    } catch (err) {
      if (seq === loadSeq.current) {
        pushToast({
          title: 'Dashboard refresh failed',
          body: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [rebuildRoster]);

  // Initial load + scheduler tick + session change + starred re-sort.
  useEffect(() => {
    void load();
    const offTick = onTick(() => void load());
    const offSession = sessionStore.subscribe((s) => {
      if (s.phase === 'connected') void load();
    });
    const offStarred = onStarredChange(() => {
      setSprintIssues((prev) => sortSprintIssues(applyStarred([...prev])));
    });
    return () => {
      offTick();
      offSession();
      offStarred();
    };
  }, [load]);

  // User picker change → server-side JQL swap reload.
  const commitUserFilter = (value: string) => {
    setUserFilter(value);
    userFilterRef.current = value;
    void load();
  };

  const handleToggleStar = (issue: JiraIssue) => {
    // Flip locally first so the kanban rebuild floats it, then persist.
    setSprintIssues((prev) =>
      sortSprintIssues(prev.map((i) => (i.key === issue.key ? { ...i, isStarred: !i.isStarred } : i))),
    );
    void toggleStarred(issue.key);
  };

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

  const handleWipPrompt = (value: string | null) => {
    const column = wipColumn;
    setWipColumn(null);
    if (value === null || !column) return;
    const limits = { ...getSettings().kanbanWipLimits };
    const trimmed = value.trim();
    if (trimmed === '') {
      delete limits[column];
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || Math.floor(n) <= 0) return; // must be > 0
      limits[column] = Math.floor(n);
    }
    void updateSettings({ kanbanWipLimits: limits }).then(() => void load());
  };

  const widgets = resolveDashboardWidgets(settings.dashboardWidgets);

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
      {
        key: 'key',
        header: 'Key',
        width: 100,
        render: (r) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{r.key}</span>,
      },
      { key: 'summary', header: 'Summary', width: 500 },
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
      { key: 'sprint', header: 'Sprint', width: 200 },
      { key: 'assignee', header: 'Assignee', width: 160 },
      { key: 'reporter', header: 'Reporter', width: 160 },
      {
        key: 'updated',
        header: 'Updated',
        width: 180,
        format: (r) => formatDateTime(r.updated),
        sortValue: (r) => r.updated ?? '',
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        kicker="Jira · Sprint"
        title="Dashboard"
        subtitle="Click any KPI card to see the issues behind the number."
      />
      {/* KPI widget row */}
      {widgets.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {widgets.map((w) => (
            <div
              key={w.id}
              className="card kpi-card"
              role="button"
              tabIndex={0}
              title="Click to see the issues behind this number"
              onClick={() => setDrillKpi({ id: w.id, title: w.title })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setDrillKpi({ id: w.id, title: w.title });
              }}
              style={{
                minWidth: 132,
                borderRadius: 8,
                padding: '10px 14px',
                flex: '0 1 auto',
                cursor: 'pointer',
                borderLeft: `3px solid ${w.color}`,
              }}
            >
              <div className="muted" style={{ fontSize: 10, letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{w.title}</span>
                <span aria-hidden style={{ opacity: 0.6 }}>›</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: w.color, marginTop: 2 }}>
                {kpiValue(w.id, snapshot, sprintIssues)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* My Current Sprint card */}
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>My Current Sprint</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {SUBTITLE}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span aria-hidden style={{ fontSize: 13 }}>
              🔍
            </span>
            <UserSearchPicker users={roster} value={userFilter} onCommit={commitUserFilter} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="radio"
                name="dashboard-view-mode"
                checked={mode === 'kanban'}
                onChange={() => setMode('kanban')}
              />
              Kanban
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="radio"
                name="dashboard-view-mode"
                checked={mode === 'table'}
                onChange={() => setMode('table')}
              />
              Table
            </label>
          </div>
        </div>

        {mode === 'kanban' ? (
          <Kanban
            issues={sprintIssues}
            wipLimits={settings.kanbanWipLimits}
            variant="rich"
            onOpen={(issue) => dialogs.openIssueDetails(issue.key)}
            onDrop={(issue, columnTitle) => void handleDrop(issue, columnTitle)}
            onToggleStar={handleToggleStar}
            onColumnContextMenu={(columnTitle) => setWipColumn(columnTitle)}
          />
        ) : (
          <ResponsiveGrid
            stateKey="Dashboard.SprintTable"
            columns={columns}
            rows={sprintIssues}
            rowKey={(r) => r.key}
            onRowDoubleClick={(r) => dialogs.openIssueDetails(r.key)}
            emptyText="No active-sprint issues."
          />
        )}
      </div>

      {drillKpi !== null ? (
        <KpiDrilldown
          kpiId={drillKpi.id}
          kpiTitle={drillKpi.title}
          project={getSettings().defaultProjectKey || 'ISW'}
          sprintIssues={sprintIssues}
          onClose={() => setDrillKpi(null)}
        />
      ) : null}

      {wipColumn !== null ? (
        <TextPrompt
          title="WIP limit"
          message={`Maximum issues for '${wipColumn}' (blank to clear):`}
          initialValue={
            settings.kanbanWipLimits[wipColumn] !== undefined ? String(settings.kanbanWipLimits[wipColumn]) : ''
          }
          onClose={handleWipPrompt}
        />
      ) : null}
    </div>
  );
}
