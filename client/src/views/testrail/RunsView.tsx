// Test runs (Railbook renderRuns at parity): project picker, 200ms-debounced
// search across ALL runs (name/description/id/creator), suite filter, My-runs
// chip, newest 500 display cap, edit/close/delete (typed confirm), and a
// TestRail-parity run-creation dialog (assignee + include-all / specific
// cases / dynamic filtering with a live case-count preview).

import { useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import {
  fmtUnixDate,
  groupCasesBySection,
  passPct,
  resolveRunCaseFilter,
  sectionPath,
} from '../../lib/testrail';
import { DataGrid, type GridColumn } from '../../components/DataGrid';
import { Modal } from '../../components/Modal';
import { navigateTestRailRun } from '../../router';
import { pushToast } from '../../stores/toasts';
import {
  ensureCases,
  ensureSections,
  loadRuns,
  selectProject,
  trStore,
  userName,
  type TestRailState,
} from '../../stores/testrail';
import type { TrCase, TrRun, TrSection } from '../../testrailTypes';
import {
  ConfirmDialog,
  DistBar,
  PageTitle,
  RunStateStamp,
  TestRailGate,
  errText,
  pageHeadStyle,
  useTestRail,
  type ConfirmSpec,
} from './common';

type RunRisk = 'all' | 'active' | 'failing' | 'blocked' | 'untested' | 'low-pass';

export function RunsView() {
  const st = useTestRail();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [suiteFilter, setSuiteFilter] = useState('');
  const [myOnly, setMyOnly] = useState(false);
  const [risk, setRisk] = useState<RunRisk>('all');
  const [editor, setEditor] = useState<{ existing: TrRun | null } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (st.phase !== 'connected') return;
    void loadRuns().catch((err) => pushToast({ title: 'Runs failed', body: errText(err) }));
  }, [st.phase, st.projectId]);

  // 200ms debounce (Railbook runSearch).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Project switch → the suite filter no longer applies to the new suites.
  useEffect(() => {
    setSuiteFilter('');
  }, [st.projectId]);

  const me = st.session?.user?.id ?? null;
  const runs = st.runs;

  const filtered = useMemo(() => {
    let list = suiteFilter ? runs.filter((r) => r.suiteId === Number(suiteFilter)) : runs;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        `${r.name} ${r.description ?? ''} r${r.id} ${userName(st, r.createdBy)}`.toLowerCase().includes(q),
      );
    }
    if (myOnly && me != null) list = list.filter((r) => r.createdBy === me);
    if (risk === 'active') list = list.filter((r) => !r.isCompleted);
    if (risk === 'failing') list = list.filter((r) => r.failedCount > 0);
    if (risk === 'blocked') list = list.filter((r) => r.blockedCount > 0);
    if (risk === 'untested') list = list.filter((r) => r.untestedCount > 0);
    if (risk === 'low-pass') list = list.filter((r) => {
      const total = r.passedCount + r.failedCount + r.blockedCount + r.retestCount + r.untestedCount;
      return total > 0 && r.passedCount / total < 0.8;
    });
    return [...list].sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0));
  }, [runs, suiteFilter, search, myOnly, risk, me, st.people, st.meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = filtered.filter((r) => !r.isCompleted).length;
  const myCount = me != null ? runs.filter((r) => r.createdBy === me).length : 0;
  const runHealth = useMemo(() => ({
    active: runs.filter((run) => !run.isCompleted).length,
    failing: runs.filter((run) => run.failedCount > 0).length,
    blocked: runs.filter((run) => run.blockedCount > 0).length,
    untested: runs.filter((run) => run.untestedCount > 0).length,
    lowPass: runs.filter((run) => {
      const count = run.passedCount + run.failedCount + run.blockedCount + run.retestCount + run.untestedCount;
      return count > 0 && run.passedCount / count < 0.8;
    }).length,
  }), [runs]);

  const runColumns = useMemo<GridColumn<TrRun>[]>(
    () => [
      { key: 'name', header: 'Run', width: 380 },
      {
        key: 'createdOn',
        header: 'Created',
        width: 110,
        render: (r) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
            {fmtUnixDate(r.createdOn)}
          </span>
        ),
        format: (r) => fmtUnixDate(r.createdOn),
        sortValue: (r) => r.createdOn ?? 0,
      },
      {
        key: 'createdBy',
        header: 'By',
        width: 130,
        render: (r) => <span className="muted">{userName(st, r.createdBy)}</span>,
        format: (r) => userName(st, r.createdBy),
        sortValue: (r) => userName(st, r.createdBy),
      },
      {
        key: 'status',
        header: 'Status',
        width: 90,
        render: (r) => <RunStateStamp isCompleted={r.isCompleted} />,
        format: (r) => (r.isCompleted ? 'closed' : 'active'),
        sortValue: (r) => (r.isCompleted ? 1 : 0),
      },
      {
        key: 'dist',
        header: 'Distribution',
        width: 220,
        render: (r) => <DistBar r={r} />,
        format: (r) => `${r.passedCount}p/${r.failedCount}f/${r.blockedCount}b/${r.untestedCount}u`,
        sortValue: (r) => r.passedCount + r.failedCount + r.blockedCount + r.retestCount,
      },
      {
        key: 'pass',
        header: 'Pass',
        width: 70,
        render: (r) => (
          <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{passPct(r)}</span>
        ),
        format: (r) => passPct(r),
        sortValue: (r) => {
          const total = r.passedCount + r.failedCount + r.blockedCount + r.retestCount + r.untestedCount;
          return total > 0 ? r.passedCount / total : 0;
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        width: 170,
        format: () => '',
        sortValue: () => null,
        render: (r) => (
          <span style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
            {!r.isCompleted ? (
              <>
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setEditor({ existing: r })}>
                  edit
                </button>{' '}
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => closeRun(r)}>
                  close
                </button>{' '}
              </>
            ) : null}
            <button
              className="btn"
              style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent-red)' }}
              onClick={() => deleteRun(r)}
            >
              delete
            </button>
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st.people, st.meta],
  );

  const closeRun = (run: TrRun) =>
    setConfirm({
      title: 'Close run',
      message: (
        <span>
          Close run <b>{run.name}</b>? Closed runs become read-only in TestRail.
        </span>
      ),
      confirmLabel: 'Close run',
      danger: false,
      onConfirm: async () => {
        try {
          await trApi.closeRun(run.id);
          pushToast({ title: 'TestRail', body: 'Run closed.' });
          await loadRuns(true);
        } catch (err) {
          pushToast({ title: 'Close failed', body: errText(err) });
        }
      },
    });

  const deleteRun = (run: TrRun) =>
    setConfirm({
      title: 'Delete run',
      message: (
        <span>
          Delete run <b>{run.name}</b> and all its results? This cannot be undone.
        </span>
      ),
      confirmLabel: 'Delete run',
      typed: run.name,
      onConfirm: async () => {
        try {
          await trApi.deleteRun(run.id);
          pushToast({ title: 'TestRail', body: 'Run deleted.' });
          await loadRuns(true);
        } catch (err) {
          pushToast({ title: 'Delete failed', body: errText(err) });
        }
      },
    });

  return (
    <TestRailGate st={st}>
      <div style={pageHeadStyle}>
        <PageTitle
          kicker="TestRail · execution"
          title="Test runs"
          lede={`${activeCount} active · ${filtered.length} in scope of ${runs.length} total.`}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            title="Project"
            value={st.projectId ?? ''}
            onChange={(e) => void selectProject(Number(e.target.value))}
            style={{ minWidth: 150 }}
          >
            {st.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {me != null ? (
            <button className={`chip c-mine ${myOnly ? 'active' : ''}`} onClick={() => setMyOnly((v) => !v)}>
              My runs<span className="n">{myCount}</span>
            </button>
          ) : null}
          <input
            placeholder={`Search all ${runs.length} runs…`}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <select value={suiteFilter} onChange={(e) => setSuiteFilter(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">All suites</option>
            {st.suites.map((su) => (
              <option key={su.id} value={su.id}>
                {su.name}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void loadRuns(true)
                .catch((err) => pushToast({ title: 'Refresh failed', body: errText(err) }))
                .finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? '…' : '↻ Refresh'}
          </button>
          <button className="btn btn-primary" onClick={() => setEditor({ existing: null })}>
            + New run
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', padding: '7px 9px', marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 10.5, letterSpacing: '0.06em', marginRight: 2 }}>MONITOR</span>
        {([
          ['all', `All ${runs.length}`],
          ['active', `Active ${runHealth.active}`],
          ['failing', `Failing ${runHealth.failing}`],
          ['blocked', `Blocked ${runHealth.blocked}`],
          ['untested', `Untested ${runHealth.untested}`],
          ['low-pass', `Pass <80% ${runHealth.lowPass}`],
        ] as Array<[RunRisk, string]>).map(([value, label]) => (
          <button key={value} className={`btn${risk === value ? ' btn-primary' : ''}`} style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setRisk(value)}>{label}</button>
        ))}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{filtered.length} visible · Shift-click headers for multi-sort</span>
      </div>

      {/* Unified DataGrid: sort by any column, drag-resize, right-click header
          for column chooser + CSV export, scroll-windowed rendering. */}
      <DataGrid<TrRun>
        stateKey="TestRail.Runs"
        columns={runColumns}
        rows={filtered}
        rowKey={(r) => String(r.id)}
        onRowActivate={(r) => navigateTestRailRun(r.id)}
        emptyText={st.runsLoaded ? 'No matching runs.' : 'loading runs…'}
      />

      {editor ? <RunEditor st={st} existing={editor.existing} onClose={() => setEditor(null)} /> : null}
      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </TestRailGate>
  );
}

// ---------------------------------------------------------------------------
// run editor (TestRail add_run parity) — assignee + three case-selection modes
// ---------------------------------------------------------------------------

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11 };

type CaseMode = 'all' | 'specific' | 'dynamic';

export function RunEditor({
  st,
  existing,
  onClose,
}: {
  st: TestRailState;
  existing: TrRun | null;
  onClose: () => void;
}) {
  const isEdit = existing !== null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [refs, setRefs] = useState('');
  const [suiteId, setSuiteId] = useState<number | null>(
    typeof st.selSuiteId === 'number' ? st.selSuiteId : (st.suites[0]?.id ?? null),
  );
  // Assign To defaults to the connected TestRail user (native TestRail default).
  const [assignedTo, setAssignedTo] = useState<number | ''>(st.session?.user?.id ?? '');
  const [mode, setMode] = useState<CaseMode>('all');
  const [sections, setSections] = useState<TrSection[]>([]);
  const [suiteCases, setSuiteCases] = useState<TrCase[] | null>(null);
  // "Select specific test cases" state.
  const [sel, setSel] = useState<ReadonlySet<number>>(new Set());
  const [pickFilter, setPickFilter] = useState('');
  // "Dynamic filtering" state.
  const [dynSections, setDynSections] = useState<number[]>([]);
  const [dynPriority, setDynPriority] = useState<number | ''>('');
  const [dynOwner, setDynOwner] = useState<number | ''>('');
  const [dynTitle, setDynTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const project = st.projects.find((p) => p.id === st.projectId);

  // Suite change → (re)load its sections + cases, reset the case selections.
  useEffect(() => {
    if (isEdit || suiteId == null) return;
    let cancelled = false;
    setSuiteCases(null);
    setSections([]);
    setSel(new Set());
    setDynSections([]);
    void Promise.all([ensureSections(suiteId), ensureCases(suiteId)])
      .then(([secLists]) => {
        if (cancelled) return;
        setSections([...secLists[0]].sort((a, b) => a.displayOrder - b.displayOrder));
        setSuiteCases(trStore.get().cases[suiteId] ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isEdit, suiteId]);

  // Assignee options: people map (id → name) merged with meta users + me.
  const assignOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const [id, personName] of Object.entries(st.people)) map.set(Number(id), personName);
    for (const u of st.meta?.users ?? []) if (!map.has(u.id)) map.set(u.id, u.name);
    const meUser = st.session?.user;
    if (meUser && !map.has(meUser.id)) map.set(meUser.id, meUser.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
  }, [st.people, st.meta, st.session]);

  // Specific-mode picker: title-filtered cases grouped by section.
  const pickCases = useMemo(() => {
    const q = pickFilter.trim().toLowerCase();
    const list = suiteCases ?? [];
    return q ? list.filter((c) => c.title.toLowerCase().includes(q) || `c${c.id}` === q) : list;
  }, [suiteCases, pickFilter]);
  const pickGroups = useMemo(() => groupCasesBySection(pickCases, sections), [pickCases, sections]);

  // Dynamic-mode live resolution (this is what gets sent as case_ids).
  const dynMatches = useMemo(
    () =>
      resolveRunCaseFilter(suiteCases ?? [], sections, {
        sectionIds: dynSections,
        priorityId: dynPriority === '' ? null : dynPriority,
        ownerId: dynOwner === '' ? null : dynOwner,
        titleContains: dynTitle,
      }),
    [suiteCases, sections, dynSections, dynPriority, dynOwner, dynTitle],
  );

  const includedCount =
    mode === 'all' ? (suiteCases?.length ?? null) : mode === 'specific' ? sel.size : dynMatches.length;

  const toggleCase = (id: number, on: boolean) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSection = (cases: TrCase[], on: boolean) => {
    setSel((prev) => {
      const next = new Set(prev);
      for (const c of cases) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) {
      pushToast({ title: 'TestRail', body: 'Name is required.' });
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await trApi.updateRun((existing as TrRun).id, {
          name: name.trim(),
          description: description.trim() || null,
          refs: refs.trim() || null,
        });
        pushToast({ title: 'TestRail', body: 'Run updated.' });
      } else {
        if (st.projectId == null || suiteId == null) return;
        let caseIds: number[] | undefined;
        if (mode === 'specific') caseIds = [...sel];
        else if (mode === 'dynamic') caseIds = dynMatches.map((c) => c.id);
        if (mode !== 'all' && (!caseIds || caseIds.length === 0)) {
          pushToast({ title: 'TestRail', body: 'Selection contains no cases.' });
          return;
        }
        await trApi.addRun(st.projectId, {
          suiteId,
          name: name.trim(),
          description: description.trim() || null,
          refs: refs.trim() || null,
          assignedToId: assignedTo === '' ? null : assignedTo,
          includeAll: mode === 'all',
          caseIds,
        });
        pushToast({
          title: 'TestRail',
          body:
            mode === 'all'
              ? 'Run created — all suite cases included.'
              : `Run created with ${caseIds!.length} cases.`,
        });
      }
      onClose();
      await loadRuns(true);
    } catch (err) {
      pushToast({ title: isEdit ? 'Update failed' : 'Create failed', body: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const radioRow = (value: CaseMode, label: string, hint: string) => (
    <label style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}>
      <input type="radio" name="runCaseMode" checked={mode === value} onChange={() => setMode(value)} />
      <span>
        {label}
        <span className="muted" style={{ marginLeft: 8, fontSize: 11.5 }}>
          {hint}
        </span>
      </span>
    </label>
  );

  return (
    <Modal
      title={isEdit ? 'Edit run' : `New test run — ${project?.name ?? 'project'}`}
      width={640}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '…' : isEdit ? 'Save' : 'Create run'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!isEdit ? (
          <div className="muted" style={mono}>
            Project: <b style={{ color: 'var(--accent-cyan)' }}>{project?.name ?? '—'}</b>
          </div>
        ) : null}
        <label style={fieldCol}>
          Name
          <input
            value={name}
            autoFocus
            placeholder="e.g. Sprint 42 regression — printer S4"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label style={fieldCol}>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label style={fieldCol}>
          References
          <input value={refs} placeholder="JIRA-123" onChange={(e) => setRefs(e.target.value)} />
        </label>
        {!isEdit ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={fieldCol}>
                Suite
                <select value={suiteId ?? ''} onChange={(e) => setSuiteId(Number(e.target.value) || null)}>
                  {st.suites.map((su) => (
                    <option key={su.id} value={su.id}>
                      {su.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={fieldCol}>
                Assign To
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Unassigned</option>
                  {assignOptions.map(([id, userLabel]) => (
                    <option key={id} value={id}>
                      {userLabel}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={fieldCol}>
              Test cases
              {radioRow('all', 'Include all test cases', 'cases added to the suite later join automatically')}
              {radioRow('specific', 'Select specific test cases', 'pick cases per section')}
              {radioRow('dynamic', 'Dynamic filtering', 'section / priority / owner / title filter')}
            </div>

            {mode === 'specific' ? (
              suiteCases === null ? (
                <div className="muted" style={mono}>
                  loading cases…
                </div>
              ) : (
                <>
                  <input
                    placeholder="Filter cases by title…"
                    value={pickFilter}
                    onChange={(e) => setPickFilter(e.target.value)}
                  />
                  <div
                    style={{
                      maxHeight: 240,
                      overflowY: 'auto',
                      border: '1px solid var(--border-soft)',
                      borderRadius: 8,
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    {pickGroups.map((group) => {
                      const allOn = group.cases.every((c) => sel.has(c.id));
                      return (
                        <div key={group.sectionId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <label
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={allOn}
                              onChange={(e) => toggleSection(group.cases, e.target.checked)}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {sectionPath(group.sectionId, sections)}
                            </span>
                            <span className="muted" style={{ ...mono, fontWeight: 400 }}>
                              · {group.cases.length}
                            </span>
                          </label>
                          {group.cases.map((c) => (
                            <label
                              key={c.id}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 22, fontSize: 12.5, cursor: 'pointer' }}
                            >
                              <input
                                type="checkbox"
                                checked={sel.has(c.id)}
                                onChange={(e) => toggleCase(c.id, e.target.checked)}
                              />
                              <span className="muted" style={mono}>
                                C{c.id}
                              </span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.title}
                              </span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                    {pickGroups.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12, padding: 6 }}>
                        No cases match.
                      </div>
                    ) : null}
                  </div>
                </>
              )
            ) : null}

            {mode === 'dynamic' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={fieldCol}>
                    Sections (multi-select)
                    <select
                      multiple
                      size={6}
                      value={dynSections.map(String)}
                      onChange={(e) =>
                        setDynSections([...e.target.selectedOptions].map((o) => Number(o.value)))
                      }
                    >
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {'— '.repeat(s.depth)}
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={fieldCol}>
                      Priority
                      <select
                        value={dynPriority}
                        onChange={(e) => setDynPriority(e.target.value === '' ? '' : Number(e.target.value))}
                      >
                        <option value="">Any priority</option>
                        {(st.meta?.priorities ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.shortName || p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={fieldCol}>
                      Owner
                      <select
                        value={dynOwner}
                        onChange={(e) => setDynOwner(e.target.value === '' ? '' : Number(e.target.value))}
                      >
                        <option value="">Any owner</option>
                        {assignOptions.map(([id, userLabel]) => (
                          <option key={id} value={id}>
                            {userLabel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={fieldCol}>
                      Title contains
                      <input value={dynTitle} onChange={(e) => setDynTitle(e.target.value)} />
                    </label>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  Heads-up: dynamic filtering snapshots the matching cases at creation time — cases added to the
                  suite later are NOT auto-added (that requires "Include all test cases").
                </div>
              </>
            ) : null}

            <div className="muted" style={mono}>
              {suiteCases === null || includedCount === null
                ? 'counting cases…'
                : mode === 'all'
                  ? `${includedCount} case${includedCount === 1 ? '' : 's'} today — plus any future suite cases`
                  : `${includedCount} case${includedCount === 1 ? '' : 's'} will be included`}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
