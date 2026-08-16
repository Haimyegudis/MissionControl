// Incidents view (ui-parity-contract.md §3 "Indigo SW Incidents Dashboard") —
// header with Active-filters pill / Open in Jira / Clear All, collapsed
// Filters expander (quick pills + dropdown filter chips + summary search),
// three stacked PagedGrid sections with colored header bars, client-side
// summary re-slice, selection persistence in settings.incidentFiltersJson,
// scheduler tick + session change reload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, incidents as incidentsApi, issues as issuesApi } from '../api/client';
import { ContextMenu, type MenuEntry } from '../components/ContextMenu';
import type { GridColumn } from '../components/DataGrid';
import { PagedGrid } from '../components/PagedGrid';
import { PageHeader } from '../components/PageHeader';
import { statusSubmenu } from '../components/StatusMenu';
import { dialogs } from '../dialogs/DialogHost';
import { priorityColor, statusColor } from '../lib/colors';
import { formatDateTime } from '../lib/format';
import {
  activeFilterCount,
  mergeSavedIntoOptions,
  parseIncidentFilters,
  serializeIncidentFilters,
  sliceBySummary,
  toSelectionList,
  type IncidentSelections,
} from '../lib/viewIncidentFilters';
import { onTick } from '../stores/scheduler';
import { sessionStore } from '../stores/session';
import { getSettings, loadSettings, updateSettings } from '../stores/settings';
import { pushToast } from '../stores/toasts';
import type { JiraFilterDefinition, JiraIssue } from '../types';

interface IncidentResults {
  all: JiraIssue[];
  verification: JiraIssue[];
  rejected: JiraIssue[];
}

const EMPTY_RESULTS: IncidentResults = { all: [], verification: [], rejected: [] };

const BAR_BLUE = '#1B5BAA';
const BAR_RED = '#B8323A';

// ---------------------------------------------------------------------------
// Columns per §3 table
// ---------------------------------------------------------------------------

function col(key: string, header: string, width: number, extra?: Partial<GridColumn<JiraIssue>>): GridColumn<JiraIssue> {
  return { key, header, width, ...extra };
}

function baseColumns(): Record<string, GridColumn<JiraIssue>> {
  return {
    key: col('key', 'Key', 100, {
      render: (r) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{r.key}</span>,
    }),
    summary: col('summary', 'Summary', 320),
    type: col('issueType', 'Type', 120),
    status: col('status', 'Status', 140, {
      render: (r) => <span style={{ color: statusColor(r.status) }}>{r.status}</span>,
    }),
    priority: col('priority', 'Priority', 100, {
      render: (r) => <span style={{ color: priorityColor(r.priority) }}>{r.priority}</span>,
    }),
    severity: col('severity', 'Severity', 100),
    assignee: col('assignee', 'Assignee', 160),
    reporter: col('reporter', 'Reporter', 160),
    fixVersion: col('fixVersion', 'Fix Version', 160, {
      format: (r) => r.fixVersions?.[0] ?? '',
      sortValue: (r) => r.fixVersions?.[0] ?? '',
    }),
    sprint: col('sprint', 'Sprint', 160),
    updated: col('updated', 'Updated', 160, {
      format: (r) => formatDateTime(r.updated),
      sortValue: (r) => r.updated ?? '',
    }),
    rejectReasons: col('rejectReasons', 'Reject Reasons', 220),
  };
}

const C = baseColumns();
const ALL_COLUMNS = [C.key, C.summary, C.type, C.status, C.priority, C.severity, C.assignee, C.reporter, C.fixVersion, C.sprint, C.updated];
const VERIFICATION_COLUMNS = [C.key, C.summary, C.priority, C.severity, C.assignee, C.reporter, C.fixVersion, C.sprint, C.updated];
const REJECTED_COLUMNS = [C.key, C.summary, C.priority, C.severity, C.assignee, C.reporter, C.rejectReasons, C.fixVersion, C.sprint];

// ---------------------------------------------------------------------------
// Dropdown filter chip + popup
// ---------------------------------------------------------------------------

interface DropdownChipProps {
  def: JiraFilterDefinition;
  selected: string[];
  loadOptions: () => Promise<string[]>;
  onApply: (values: string[]) => void;
}

function DropdownChip({ def, selected, loadOptions, onApply }: DropdownChipProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setSearch('');
    setPending(new Set(selected.map((v) => v.toLowerCase())));
    setOpen(true);
    if (options === null) {
      loadOptions().then(
        (loaded) => setOptions(mergeSavedIntoOptions(loaded, selected)),
        () => setOptions([]),
      );
    }
  };

  const shown = (options ?? []).filter((o) => !search.trim() || o.toLowerCase().includes(search.trim().toLowerCase()));
  const label = selected.length > 0 ? `${def.displayName} (${selected.length})` : def.displayName;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn"
        onClick={toggleOpen}
        style={{
          minWidth: 120,
          padding: '3px 10px',
          fontSize: 11.5,
          color: selected.length > 0 ? 'var(--accent-cyan)' : undefined,
          borderColor: selected.length > 0 ? 'var(--accent-cyan)' : undefined,
        }}
      >
        {label} ▾
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            width: 280,
            maxHeight: 420,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 3000,
            background: 'var(--bg-panel-high)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-card)',
            padding: 8,
          }}
        >
          <div style={{ color: 'var(--accent-cyan)', fontSize: 10.5, marginBottom: 6 }}>
            {def.jiraFieldName ?? def.displayName}
          </div>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            style={{ marginBottom: 6 }}
          />
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {options === null ? (
              <div className="muted" style={{ fontSize: 12, padding: 6 }}>
                Loading...
              </div>
            ) : shown.length === 0 ? (
              <div className="muted" style={{ fontSize: 12, padding: 6 }}>
                No options.
              </div>
            ) : (
              shown.map((name) => (
                <label
                  key={name}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '2px 4px', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={pending.has(name.toLowerCase())}
                    onChange={() =>
                      setPending((prev) => {
                        const next = new Set(prev);
                        const lower = name.toLowerCase();
                        if (next.has(lower)) next.delete(lower);
                        else next.add(lower);
                        return next;
                      })
                    }
                  />
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
                setOpen(false);
                onApply([]);
              }}
            >
              Clear
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '3px 10px', fontSize: 11.5 }}
              onClick={() => {
                setOpen(false);
                onApply((options ?? []).filter((o) => pending.has(o.toLowerCase())));
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section (colored bar + PagedGrid)
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  barColor: string;
  stateKey: string;
  columns: GridColumn<JiraIssue>[];
  rows: JiraIssue[];
  onRowContextMenu: (row: JiraIssue, e: { clientX: number; clientY: number }) => void;
}

function Section({ title, barColor, stateKey, columns, rows, onRowContextMenu }: SectionProps) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <PagedGrid
        stateKey={stateKey}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        pageSize={10}
        headerLeft={
          <div
            style={{
              background: barColor,
              color: 'rgba(255,255,255,0.95)',
              fontWeight: 600,
              fontSize: 12.5,
              padding: '6px 12px',
              borderRadius: 6,
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
        }
        onRowDoubleClick={(r) => dialogs.openIssueDetails(r.key)}
        onRowContextMenu={onRowContextMenu}
        emptyText="No issues."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function IncidentsView() {
  const [definitions, setDefinitions] = useState<JiraFilterDefinition[]>([]);
  const [selections, setSelections] = useState<IncidentSelections>({});
  const [summarySearch, setSummarySearch] = useState('');
  const [results, setResults] = useState<IncidentResults>(EMPTY_RESULTS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ row: JiraIssue; x: number; y: number } | null>(null);

  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;
  const restoringRef = useRef(false);
  const lastPersisted = useRef<string | null>(null);
  const loadSeq = useRef(0);
  const optionsCache = useRef(new Map<string, Promise<string[]>>());
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (map?: IncidentSelections) => {
    const seq = ++loadSeq.current;
    const use = map ?? selectionsRef.current;
    try {
      const res = await incidentsApi.search(toSelectionList(use), null);
      if (seq !== loadSeq.current) return;
      setResults(res);
    } catch (err) {
      if (seq === loadSeq.current) {
        pushToast({ title: 'Incidents load failed', body: err instanceof Error ? err.message : String(err) });
      }
    }
  }, []);

  // Persist selections + summary search (guarded against restore write-storms).
  const persist = useCallback((map: IncidentSelections, summary: string) => {
    if (restoringRef.current) return;
    const json = serializeIncidentFilters(map);
    const stamp = `${json}|${summary}`;
    if (stamp === lastPersisted.current) return;
    lastPersisted.current = stamp;
    void updateSettings({ incidentFiltersJson: json, incidentSummarySearch: summary || null }).catch(() => undefined);
  }, []);

  const commitSelections = useCallback(
    (next: IncidentSelections) => {
      setSelections(next);
      selectionsRef.current = next;
      persist(next, summarySearch);
      void search(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persist, search, summarySearch],
  );

  // Mount: definitions + restore persisted selections, then first search.
  useEffect(() => {
    let cancelled = false;
    api
      .get<JiraFilterDefinition[]>('/api/incidents/definitions')
      .then((defs) => {
        if (!cancelled) setDefinitions(defs);
      })
      .catch((err) =>
        pushToast({ title: 'Incident filters failed', body: err instanceof Error ? err.message : String(err) }),
      );

    loadSettings()
      .catch(() => getSettings())
      .then((s) => {
        if (cancelled) return;
        restoringRef.current = true;
        const map = parseIncidentFilters(s.incidentFiltersJson);
        const summary = s.incidentSummarySearch ?? '';
        setSelections(map);
        selectionsRef.current = map;
        setSummarySearch(summary);
        lastPersisted.current = `${serializeIncidentFilters(map)}|${summary}`;
        restoringRef.current = false;
        void search(map);
      });

    const offTick = onTick(() => void search());
    const offSession = sessionStore.subscribe((s) => {
      if (s.phase === 'connected') void search();
    });
    return () => {
      cancelled = true;
      offTick();
      offSession();
    };
  }, [search]);

  // Summary search: client-side re-slice only; persisted debounced.
  const onSummaryChange = (value: string) => {
    setSummarySearch(value);
    if (summaryTimer.current) clearTimeout(summaryTimer.current);
    summaryTimer.current = setTimeout(() => persist(selectionsRef.current, value), 600);
  };

  const toggleQuickPill = (def: JiraFilterDefinition) => {
    const next = { ...selectionsRef.current };
    if (def.id in next) delete next[def.id];
    else next[def.id] = [];
    commitSelections(next);
  };

  const applyDropdown = (def: JiraFilterDefinition, values: string[]) => {
    const next = { ...selectionsRef.current };
    if (values.length === 0) delete next[def.id];
    else next[def.id] = values;
    commitSelections(next);
  };

  const clearAll = () => {
    setSummarySearch('');
    restoringRef.current = false;
    const next: IncidentSelections = {};
    setSelections(next);
    selectionsRef.current = next;
    persist(next, '');
    void search(next);
  };

  const openInJira = () => {
    const url = getSettings().incidentDashboardUrl ?? '';
    if (!/^https?:\/\//i.test(url)) {
      pushToast({ title: 'Invalid URL', body: 'Dashboard URL must be http or https.', severity: 'error' });
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const loadOptions = (def: JiraFilterDefinition): Promise<string[]> => {
    let cached = optionsCache.current.get(def.id);
    if (!cached) {
      cached = incidentsApi.filterOptions(def.id);
      optionsCache.current.set(def.id, cached);
      cached.catch(() => optionsCache.current.delete(def.id));
    }
    return cached;
  };

  // Row context menu: Open details + Change status (patch row in place).
  const patchRow = useCallback((issue: JiraIssue) => {
    const patchList = (list: JiraIssue[]) =>
      list.map((i) => (i.key.toLowerCase() === issue.key.toLowerCase() ? { ...i, ...issue } : i));
    setResults((prev) => ({
      all: patchList(prev.all),
      verification: patchList(prev.verification),
      rejected: patchList(prev.rejected),
    }));
  }, []);

  const rowMenuEntries = (row: JiraIssue): MenuEntry[] => [
    { label: 'Open details', onClick: () => dialogs.openIssueDetails(row.key) },
    {
      label: 'Change status',
      submenu: statusSubmenu(row.key, {
        onNeedsDialog: (transition, screen) =>
          dialogs.openTransition(row.key, transition, screen, () => {
            issuesApi
              .details(row.key)
              .then((d) => patchRow(d.issue))
              .catch(() => undefined);
          }),
        onPatched: patchRow,
      }),
    },
  ];

  const quickDefs = useMemo(() => definitions.filter((d) => d.isQuickFilter), [definitions]);
  const dropdownDefs = useMemo(() => definitions.filter((d) => !d.isQuickFilter), [definitions]);
  const activeCount = activeFilterCount(selections, definitions);

  const shownAll = useMemo(() => sliceBySummary(results.all, summarySearch), [results.all, summarySearch]);
  const shownVerification = useMemo(
    () => sliceBySummary(results.verification, summarySearch),
    [results.verification, summarySearch],
  );
  const shownRejected = useMemo(
    () => sliceBySummary(results.rejected, summarySearch),
    [results.rejected, summarySearch],
  );

  // Removable active-filter chips (quick pills + each dropdown value).
  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; remove: () => void }> = [];
    for (const [id, values] of Object.entries(selections)) {
      const def = definitions.find((d) => d.id.toLowerCase() === id.toLowerCase());
      const name = def?.displayName ?? id;
      if (def?.isQuickFilter || values.length === 0) {
        chips.push({
          key: id,
          label: name,
          remove: () => {
            const next = { ...selectionsRef.current };
            delete next[id];
            commitSelections(next);
          },
        });
        continue;
      }
      for (const value of values) {
        chips.push({
          key: `${id}:${value}`,
          label: `${name}: ${value}`,
          remove: () => {
            const next = { ...selectionsRef.current };
            const left = (next[id] ?? []).filter((v) => v !== value);
            if (left.length === 0) delete next[id];
            else next[id] = left;
            commitSelections(next);
          },
        });
      }
    }
    return chips;
  }, [selections, definitions, commitSelections]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <PageHeader
        kicker="Jira · Incidents"
        title="Indigo SW Incidents"
        subtitle={
          <>
            Active filters: <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{activeCount}</span>
          </>
        }
        right={
          <>
            <button className="btn" style={{ padding: '3px 12px', fontSize: 11.5 }} onClick={openInJira}>
              Open in Jira
            </button>
            <button className="btn" style={{ padding: '3px 12px', fontSize: 11.5 }} onClick={clearAll}>
              Clear All
            </button>
          </>
        }
      />

      {/* Active-filter chips */}
      {activeChips.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--accent-cyan)',
                color: 'var(--accent-cyan)',
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: 11.5,
              }}
            >
              {chip.label}
              <span style={{ cursor: 'pointer' }} title="Remove filter" onClick={chip.remove}>
                ✕
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Filters expander (collapsed by default) */}
      <div className="card" style={{ padding: 12 }}>
        <div
          onClick={() => setFiltersOpen((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ fontSize: 12 }}>{filtersOpen ? '▾' : '▸'}</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Filters</span>
        </div>
        {filtersOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {/* Quick-filter pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {quickDefs.map((def) => {
                const active = def.id in selections;
                return (
                  <button
                    key={def.id}
                    className="btn"
                    title={def.jqlTemplate ?? undefined}
                    onClick={() => toggleQuickPill(def)}
                    style={{
                      padding: '2px 10px',
                      fontSize: 11.5,
                      color: active ? 'var(--accent-cyan)' : undefined,
                      borderColor: active ? 'var(--accent-cyan)' : undefined,
                      fontWeight: active ? 700 : undefined,
                    }}
                  >
                    {def.displayName}
                  </button>
                );
              })}
            </div>
            {/* Dropdown filter chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {dropdownDefs.map((def) => (
                <DropdownChip
                  key={def.id}
                  def={def}
                  selected={selections[def.id] ?? []}
                  loadOptions={() => loadOptions(def)}
                  onApply={(values) => applyDropdown(def, values)}
                />
              ))}
            </div>
            {/* Summary search */}
            <input
              value={summarySearch}
              onChange={(e) => onSummaryChange(e.target.value)}
              placeholder="🔍 Search summaries..."
              style={{ width: 300 }}
            />
          </div>
        ) : null}
      </div>

      {/* Three stacked sections */}
      <Section
        title="SW Incident / Incidents & RCs"
        barColor={BAR_BLUE}
        stateKey="Incident.All"
        columns={ALL_COLUMNS}
        rows={shownAll}
        onRowContextMenu={(row, e) => setRowMenu({ row, x: e.clientX, y: e.clientY })}
      />
      <Section
        title="SW Incident / Verification Incidents"
        barColor={BAR_BLUE}
        stateKey="Incident.Verification"
        columns={VERIFICATION_COLUMNS}
        rows={shownVerification}
        onRowContextMenu={(row, e) => setRowMenu({ row, x: e.clientX, y: e.clientY })}
      />
      <Section
        title="SW Incident / Rejected Incidents"
        barColor={BAR_RED}
        stateKey="Incident.Rejected"
        columns={REJECTED_COLUMNS}
        rows={shownRejected}
        onRowContextMenu={(row, e) => setRowMenu({ row, x: e.clientX, y: e.clientY })}
      />

      {rowMenu ? (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          entries={rowMenuEntries(rowMenu.row)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
    </div>
  );
}
