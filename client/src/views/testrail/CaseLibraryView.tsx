// Case library (Railbook renderExplorer at parity): suite picker incl. ★ All
// suites, collapsible sections panel, owner/assignee/title filters, column
// chooser + drag-resize (persisted), section-grouped rows with an 800-row
// paint cap, bulk copy/move/CSV/delete, never-ran coverage analysis, case
// drawer/editor, section CRUD.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { trApi } from '../../api/testrail';
import { Stamp } from '../../components/Stamp';
import { downloadCsv } from '../../lib/csv';
import {
  csvForCases,
  filterCases,
  fmtUnixDate,
  groupCasesBySection,
  sectionDescendants,
  sectionPath,
} from '../../lib/testrail';
import { pushToast } from '../../stores/toasts';
import {
  analyzeCoverage,
  casesLoaded,
  clearCaseSelection,
  clearCoverage,
  consumeOpenCase,
  currentCases,
  currentSections,
  ensureCases,
  ensureSections,
  priorityName,
  restoreCoverage,
  selectProject,
  selectSection,
  selectSuite,
  setCaseSelection,
  setColWidth,
  setFilters,
  setVisibleCols,
  toggleCollapsedSection,
  toggleTreeHidden,
  typeName,
  userName,
  type TestRailState,
} from '../../stores/testrail';
import type { TrCase, TrSection } from '../../testrailTypes';
import { CaseDrawer } from './CaseDrawer';
import { CaseEditor } from './CaseEditor';
import { SectionDialog } from './SectionDialog';
import { TransferDialog } from './TransferDialog';
import { ColumnsDialog } from './ColumnsDialog';
import {
  ConfirmDialog,
  PageTitle,
  TestRailGate,
  errText,
  pageHeadStyle,
  useTestRail,
  type ConfirmSpec,
} from './common';

const ROW_CAP = 800;

interface ColDef {
  key: string;
  label: string;
  w: number;
  always?: boolean;
  cell: (c: TrCase, ctx: CellCtx) => ReactNode;
}

interface CellCtx {
  st: TestRailState;
  neverRan: (c: TrCase) => boolean;
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' };

export const CASE_COLS: ColDef[] = [
  { key: 'id', label: 'ID', w: 62, cell: (c) => <span style={mono}>C{c.id}</span> },
  {
    key: 'title',
    label: 'Title',
    w: 0,
    always: true,
    cell: (c, ctx) => (
      <>
        {c.title}
        {ctx.neverRan(c) ? (
          <>
            {' '}
            <Stamp variant="neverran">never ran</Stamp>
          </>
        ) : null}
      </>
    ),
  },
  {
    key: 'priority',
    label: 'Priority',
    w: 68,
    cell: (c, ctx) => <Stamp variant="neutral">{priorityName(ctx.st, c.priorityId)}</Stamp>,
  },
  { key: 'type', label: 'Type', w: 66, cell: (c, ctx) => <span className="muted">{typeName(ctx.st, c.typeId)}</span> },
  {
    key: 'owner',
    label: 'Owner',
    w: 86,
    cell: (c, ctx) => (
      <span className="muted" style={{ whiteSpace: 'nowrap' }}>
        {userName(ctx.st, c.ownerId)}
      </span>
    ),
  },
  {
    key: 'assigned',
    label: 'Assigned',
    w: 80,
    cell: (c, ctx) => (
      <span className="muted" style={{ whiteSpace: 'nowrap' }}>
        {userName(ctx.st, c.assignedToId)}
      </span>
    ),
  },
  {
    key: 'refs',
    label: 'Refs',
    w: 84,
    cell: (c) => (
      <span style={{ ...mono, whiteSpace: 'normal', overflowWrap: 'anywhere' }} title={c.refs ?? ''}>
        {c.refs ?? '—'}
      </span>
    ),
  },
  { key: 'estimate', label: 'Estimate', w: 62, cell: (c) => <span style={mono}>{c.estimate ?? '—'}</span> },
  { key: 'created', label: 'Created', w: 74, cell: (c) => <span style={mono}>{fmtUnixDate(c.createdOn)}</span> },
  { key: 'updated', label: 'Updated', w: 74, cell: (c) => <span style={mono}>{fmtUnixDate(c.updatedOn)}</span> },
];

export function CaseLibraryView() {
  const st = useTestRail();
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ existing: TrCase | null } | null>(null);
  const [transfer, setTransfer] = useState<{ mode: 'copy' | 'move'; ids: number[] } | null>(null);
  const [sectionDialog, setSectionDialog] = useState<{ existing: TrSection | null; parentId: number | null } | null>(
    null,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [covProgress, setCovProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load sections eagerly + cases async for the selected suite (or all).
  useEffect(() => {
    if (st.phase !== 'connected' || st.selSuiteId == null) return;
    setLoadError(null);
    void ensureSections(st.selSuiteId).catch((err) => pushToast({ title: 'Sections failed', body: errText(err) }));
    void ensureCases(st.selSuiteId).catch((err) => {
      // Without this the table read "loading cases…" forever after a failure.
      setLoadError(errText(err));
      pushToast({ title: 'Cases failed', body: errText(err) });
    });
  }, [st.phase, st.selSuiteId, st.projectId]);

  // Palette wiring: open the requested case once its suite data is present.
  useEffect(() => {
    if (st.openCaseId == null) return;
    const found = Object.values(st.cases).some((list) => list?.some((c) => c.id === st.openCaseId));
    if (found) {
      setDrawerCaseId(st.openCaseId);
      consumeOpenCase();
    }
  }, [st.openCaseId, st.cases]);

  const sections = currentSections(st);
  const cases = currentCases(st);
  const suiteForCoverage = typeof st.selSuiteId === 'number' ? st.selSuiteId : null;
  const coverage = suiteForCoverage != null ? st.coverage[suiteForCoverage] : undefined;

  // A persisted coverage scan (≤7 days) restores instead of rescanning.
  useEffect(() => {
    if (suiteForCoverage != null && !st.coverage[suiteForCoverage]) restoreCoverage(suiteForCoverage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suiteForCoverage]);

  const nameOf = (id: number | null) => userName(st, id);
  const sectionScope = useMemo(
    () => (st.selSectionId != null ? sectionDescendants(st.selSectionId, sections) : null),
    [st.selSectionId, sections],
  );

  // Lower-cased full path per section — the title filter also matches these,
  // so searching a section/subsection name surfaces its whole subtree.
  const sectionPathLower = useMemo(() => {
    const out = new Map<number, string>();
    for (const s of sections) out.set(s.id, sectionPath(s.id, sections).toLowerCase());
    return out;
  }, [sections]);

  const visible = useMemo(
    () =>
      filterCases(
        cases,
        {
          title: st.filters.titleContains,
          ownerText: st.filters.ownerText,
          assigneeText: st.filters.assigneeText,
          neverRan: st.filters.showNeverRan && Boolean(coverage),
          coverage: coverage?.covered ?? null,
          sectionIds: sectionScope,
          sectionPathById: sectionPathLower,
        },
        nameOf,
      ),
    [cases, st.filters, coverage, sectionScope, sectionPathLower, st.people, st.meta], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const groups = useMemo(() => groupCasesBySection(visible, sections), [visible, sections]);

  const cols = useMemo(
    () => CASE_COLS.filter((c) => c.always || st.cols.visible.includes(c.key)),
    [st.cols.visible],
  );
  const colW = (c: ColDef) => st.cols.widths[c.key] ?? (c.w || 260);
  const tableWidth = 26 + cols.reduce((a, c) => a + colW(c), 0);
  const span = cols.length + 1;
  const stRef = useRef(st);
  stRef.current = st;
  // Cells only read meta/people through ctx.st — keyed on those slices so
  // unrelated store changes don't rebuild all rows.
  const cellCtx: CellCtx = useMemo(
    () => ({
      get st() {
        return stRef.current;
      },
      neverRan: (c) => Boolean(coverage) && !coverage!.covered.has(c.id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st.meta, st.people, coverage],
  );

  const neverRanCount = useMemo(
    () => (coverage ? cases.filter((c) => !coverage.covered.has(c.id)).length : 0),
    [coverage, cases],
  );

  const peopleNames = useMemo(
    () => Object.values(st.people).sort((a, b) => a.localeCompare(b)),
    [st.people],
  );

  const refreshData = async () => {
    if (st.selSuiteId == null) return;
    setRefreshing(true);
    try {
      await Promise.all([ensureSections(st.selSuiteId, true), ensureCases(st.selSuiteId, true)]);
    } catch (err) {
      pushToast({ title: 'Refresh failed', body: errText(err) });
    } finally {
      setRefreshing(false);
    }
  };

  const refreshCasesFresh = () => {
    if (st.selSuiteId != null) {
      void ensureCases(st.selSuiteId, true).catch((err) => pushToast({ title: 'Refresh failed', body: errText(err) }));
    }
  };

  const runCoverage = async () => {
    if (suiteForCoverage == null) {
      pushToast({ title: 'TestRail', body: 'Pick a specific suite for the never-ran check.' });
      return;
    }
    setCovProgress('collecting runs (incl. plans)…');
    try {
      await analyzeCoverage(suiteForCoverage, (done, total) => setCovProgress(`analyzing ${done}/${total}…`));
    } catch (err) {
      pushToast({ title: 'Coverage failed', body: errText(err) });
    } finally {
      setCovProgress(null);
    }
  };

  // ---- column drag-resize --------------------------------------------------
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const startResize = (key: string, startW: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setColWidth(d.key, Math.max(40, d.startW + ev.clientX - d.startX));
    };
    const up = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // ---- section actions (selected section) ---------------------------------
  const selSection = st.selSectionId != null ? sections.find((s) => s.id === st.selSectionId) : undefined;
  const deleteSection = (sec: TrSection) =>
    setConfirm({
      title: 'Delete section',
      message: (
        <span>
          Delete section <b>{sec.name}</b> and everything inside it (subsections, cases, tests)? This cannot be
          undone.
        </span>
      ),
      confirmLabel: 'Delete section',
      typed: sec.name,
      onConfirm: async () => {
        try {
          await trApi.deleteSection(sec.id);
          pushToast({ title: 'TestRail', body: 'Section deleted.' });
          selectSection(null);
          if (st.selSuiteId != null) {
            await Promise.all([ensureSections(st.selSuiteId, true), ensureCases(st.selSuiteId, true)]);
          }
        } catch (err) {
          pushToast({ title: 'Delete failed', body: errText(err) });
        }
      },
    });

  const bulkDelete = () => {
    const ids = [...st.caseSel];
    const n = ids.length;
    setConfirm({
      title: `Delete ${n} case${n === 1 ? '' : 's'}`,
      message: (
        <span>
          Permanently delete <b>{n}</b> selected case{n === 1 ? '' : 's'} from TestRail? This cannot be undone.
        </span>
      ),
      confirmLabel: 'Delete cases',
      typed: n >= 5 ? 'DELETE' : null,
      onConfirm: async () => {
        let failed = 0;
        for (const id of ids) {
          try {
            await trApi.deleteCase(id);
          } catch {
            failed++;
          }
        }
        pushToast({
          title: 'TestRail',
          body: failed ? `Deleted with ${failed} failure(s).` : 'Cases deleted.',
        });
        clearCaseSelection();
        refreshCasesFresh();
      },
    });
  };

  const exportCsv = () => {
    const selected = cases.filter((c) => st.caseSel.has(c.id));
    const csv = csvForCases(selected, sections, {
      priority: (id) => priorityName(st, id),
      type: (id) => typeName(st, id),
    });
    downloadCsv(`deck-cases-${Date.now()}.csv`, `${csv}\r\n`);
    pushToast({ title: 'TestRail', body: `Exported ${selected.length} cases.` });
  };

  // ---- rendering -----------------------------------------------------------

  const countBySection = useMemo(() => {
    const out = new Map<number, number>();
    for (const c of cases) {
      if (c.sectionId != null) out.set(c.sectionId, (out.get(c.sectionId) ?? 0) + 1);
    }
    return out;
  }, [cases]);

  // Memoized: up to ROW_CAP rows × ~8 cells used to rebuild on every render
  // (every keystroke and checkbox click).
  const bodyRows: ReactNode[] = useMemo(() => {
  const rows: ReactNode[] = [];
  let painted = 0;
  for (const group of groups) {
    if (painted >= ROW_CAP) break;
    const collapsed = st.collapsedSecs.has(group.sectionId);
    const allSel = group.cases.every((c) => st.caseSel.has(c.id));
    const shown = collapsed ? [] : group.cases.slice(0, ROW_CAP - painted);
    painted += shown.length;
    rows.push(
      <tr
        key={`sec-${group.sectionId}`}
        className="secrow"
        style={{ cursor: 'pointer' }}
        onClick={() => toggleCollapsedSection(group.sectionId)}
      >
        <td colSpan={span}>
          <div className="secrow-flex">
            <input
              type="checkbox"
              checked={allSel}
              title="select all in section"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const on = e.target.checked;
                setCaseSelection((next) => {
                  for (const c of group.cases) {
                    if (on) next.add(c.id);
                    else next.delete(c.id);
                  }
                });
              }}
            />
            <span>{collapsed ? '▸' : '▾'}</span>
            <span className="secrow-path">
              {sectionPath(group.sectionId, sections, st.suites, st.selSuiteId === 'all')}{' '}
              <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
                · {group.cases.length}
              </span>
            </span>
            <span className="sec-actions">
              <button
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setTransfer({ mode: 'copy', ids: group.cases.map((c) => c.id) });
                }}
              >
                copy…
              </button>
              <button
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setTransfer({ mode: 'move', ids: group.cases.map((c) => c.id) });
                }}
              >
                move…
              </button>
            </span>
          </div>
        </td>
      </tr>,
    );
    for (const c of shown) {
      rows.push(
        <tr
          key={c.id}
          className={`clickable ${st.caseSel.has(c.id) ? 'selected' : ''}`}
          onClick={() => setDrawerCaseId(c.id)}
        >
          <td>
            <input
              type="checkbox"
              checked={st.caseSel.has(c.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const on = e.target.checked;
                setCaseSelection((next) => {
                  if (on) next.add(c.id);
                  else next.delete(c.id);
                });
              }}
            />
          </td>
          {cols.map((col) => (
            <td key={col.key}>{col.cell(c, cellCtx)}</td>
          ))}
        </tr>,
      );
    }
  }
  if (visible.length > painted) {
    rows.push(
      <tr key="cap">
        <td colSpan={span}>
          <div className="tr-empty-note">
            Showing {painted} of {visible.length} cases — use the filters, pick a section, or collapse groups to see
            the rest.
          </div>
        </td>
      </tr>,
    );
  }
  if (rows.length === 0) {
    rows.push(
      <tr key="empty">
        <td colSpan={span}>
          <div className="tr-empty-note">
            {loadError
              ? `✕ Failed to load cases: ${loadError} — use ↻ Refresh to retry.`
              : casesLoaded(st)
                ? 'Nothing here. Adjust the filter or add a case.'
                : 'loading cases for this suite…'}
          </div>
        </td>
      </tr>,
    );
  }
  return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, st.collapsedSecs, st.caseSel, sections, st.suites, st.selSuiteId, cols, cellCtx, span, visible.length, loadError]);

  const suiteOptions = (
    <>
      <option value="all">★ All suites — entire project</option>
      {st.suites.map((su) => (
        <option key={su.id} value={su.id}>
          {su.name}
        </option>
      ))}
    </>
  );

  return (
    <TestRailGate st={st}>
      <div style={pageHeadStyle}>
        <PageTitle kicker="TestRail · case library" title="Case library" />
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
          <button className="btn" disabled={refreshing} onClick={() => void refreshData()}>
            {refreshing ? '…' : '↻ Refresh'}
          </button>
          <button className="btn" onClick={() => setSectionDialog({ existing: null, parentId: null })}>
            + Section
          </button>
          <button className="btn btn-primary" onClick={() => setEditor({ existing: null })}>
            + Case
          </button>
        </div>
      </div>

      {st.caseSel.size > 0 ? (
        <div className="bulk-bar">
          <span className="n">{st.caseSel.size} selected</span>
          <button className="btn" onClick={() => setTransfer({ mode: 'copy', ids: [...st.caseSel] })}>
            Copy to…
          </button>
          <button className="btn" onClick={() => setTransfer({ mode: 'move', ids: [...st.caseSel] })}>
            Move to…
          </button>
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn" style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={bulkDelete}>
            Delete
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={clearCaseSelection}>
            Clear
          </button>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {!st.treeHidden ? (
          <div className="card" style={{ width: 260, flexShrink: 0, padding: 10, maxHeight: '75vh', overflowY: 'auto' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '2px 4px 10px' }}>
              Suite — choose one
              <select
                value={String(st.selSuiteId ?? '')}
                onChange={(e) => selectSuite(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                {suiteOptions}
              </select>
            </label>
            <div
              className={`tr-sec ${st.selSectionId == null ? 'active' : ''}`}
              onClick={() => selectSection(null)}
            >
              <span>All sections</span>
              <span className="cnt">{cases.length}</span>
            </div>
            {st.selSuiteId !== 'all'
              ? [...sections]
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((s) => (
                    <div
                      key={s.id}
                      className={`tr-sec ${st.selSectionId === s.id ? 'active' : ''}`}
                      style={{ paddingLeft: 10 + s.depth * 14 }}
                      onClick={() => selectSection(s.id)}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.name}
                      </span>
                      <button
                        className="btn tr-sec-add"
                        title={
                          s.depth === 0
                            ? `Add subsection inside "${s.name}"`
                            : `Add case in "${s.name}"`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          // Top-level section → new subsection; subsection →
                          // new case inside it (select it so the editor's
                          // section picker defaults there).
                          if (s.depth === 0) {
                            setSectionDialog({ existing: null, parentId: s.id });
                          } else {
                            selectSection(s.id);
                            setEditor({ existing: null });
                          }
                        }}
                      >
                        +
                      </button>
                      <span className="cnt">{countBySection.get(s.id) ?? ''}</span>
                    </div>
                  ))
              : null}
          </div>
        ) : null}

        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }}>
            <button
              className="btn btn-icon"
              title={st.treeHidden ? 'Show suites & sections panel' : 'Hide panel — bigger table'}
              onClick={toggleTreeHidden}
            >
              {st.treeHidden ? '⟩⟩' : '⟨⟨'}
            </button>
            {st.treeHidden ? (
              <select
                style={{ minWidth: 170 }}
                value={String(st.selSuiteId ?? '')}
                onChange={(e) => selectSuite(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                {suiteOptions}
              </select>
            ) : null}
            <input
              placeholder="Title, section, steps…"
              value={st.filters.titleContains}
              onChange={(e) => setFilters({ titleContains: e.target.value })}
              style={{ minWidth: 170 }}
            />
            <input
              list="trOwnerList"
              placeholder="Owner…"
              title="Test case owner"
              value={st.filters.ownerText}
              onChange={(e) => setFilters({ ownerText: e.target.value })}
              style={{ minWidth: 130 }}
            />
            <input
              list="trAssigneeList"
              placeholder="Assigned to…"
              title="Assigned to"
              value={st.filters.assigneeText}
              onChange={(e) => setFilters({ assigneeText: e.target.value })}
              style={{ minWidth: 130 }}
            />
            <datalist id="trOwnerList">
              {peopleNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <datalist id="trAssigneeList">
              {peopleNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {coverage ? (
              <>
                <button
                  className={`chip c-fail ${st.filters.showNeverRan ? 'active' : ''}`}
                  onClick={() => setFilters({ showNeverRan: !st.filters.showNeverRan })}
                >
                  Never ran only<span className="n">{neverRanCount}</span>
                </button>
                <button
                  className="btn btn-icon"
                  title="Clear the never-ran analysis"
                  onClick={() => suiteForCoverage != null && clearCoverage(suiteForCoverage)}
                >
                  ✕
                </button>
              </>
            ) : (
              <button
                className="btn"
                disabled={covProgress !== null}
                title="Find cases that were never included in any test run of this suite"
                onClick={() => void runCoverage()}
              >
                {covProgress ? `⏳ ${covProgress}` : '🧪 Never-ran check'}
              </button>
            )}
            <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {visible.length} case{visible.length === 1 ? '' : 's'}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn" title="Choose columns" onClick={() => setColumnsOpen(true)}>
              ⚙ Columns
            </button>
            {selSection ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  § {selSection.name}
                </span>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() =>
                    setCaseSelection((next) => {
                      for (const c of visible) next.add(c.id);
                    })
                  }
                >
                  select all
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setSectionDialog({ existing: null, parentId: selSection.id })}
                >
                  + subsection
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setSectionDialog({ existing: selSection, parentId: null })}
                >
                  rename
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent-red)' }}
                  onClick={() => deleteSection(selSection)}
                >
                  delete
                </button>
              </span>
            ) : null}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="tr-tbl" style={{ width: tableWidth, tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: 26 }}>
                    <input
                      type="checkbox"
                      checked={visible.length > 0 && visible.every((c) => st.caseSel.has(c.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCaseSelection((next) => {
                            for (const c of visible) next.add(c.id);
                          });
                        } else {
                          clearCaseSelection();
                        }
                      }}
                    />
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} style={{ width: colW(c) }}>
                      {c.label}
                      <span className="col-grip" title="drag to resize" onMouseDown={startResize(c.key, colW(c))} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{bodyRows}</tbody>
            </table>
          </div>
        </div>
      </div>

      {drawerCaseId != null ? (
        <CaseDrawer
          st={st}
          caseId={drawerCaseId}
          onClose={() => setDrawerCaseId(null)}
          onEdit={(c) => setEditor({ existing: c })}
          onTransfer={(mode, ids) => setTransfer({ mode, ids })}
          onDeleted={refreshCasesFresh}
        />
      ) : null}

      {editor ? (
        <CaseEditor st={st} existing={editor.existing} onClose={() => setEditor(null)} onSaved={refreshCasesFresh} />
      ) : null}

      {transfer ? (
        <TransferDialog
          st={st}
          mode={transfer.mode}
          caseIds={transfer.ids}
          onClose={() => setTransfer(null)}
          onDone={clearCaseSelection}
        />
      ) : null}

      {sectionDialog ? (
        <SectionDialog
          st={st}
          existing={sectionDialog.existing}
          parentId={sectionDialog.parentId}
          onClose={() => setSectionDialog(null)}
          onSaved={() => {
            if (st.selSuiteId != null) {
              void ensureSections(st.selSuiteId, true).catch(() => {});
            }
          }}
        />
      ) : null}

      {columnsOpen ? (
        <ColumnsDialog
          cols={CASE_COLS}
          visible={st.cols.visible}
          onChange={setVisibleCols}
          onClose={() => setColumnsOpen(false)}
        />
      ) : null}

      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </TestRailGate>
  );
}
