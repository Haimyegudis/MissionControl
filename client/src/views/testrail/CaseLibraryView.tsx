// Case library (Railbook renderExplorer at parity): suite picker incl. ★ All
// suites, collapsible sections panel, owner/assignee/title filters, column
// chooser + drag-resize (persisted), section-grouped rows with an 800-row
// paint cap, bulk copy/move/CSV/delete, never-ran coverage analysis, case
// drawer/editor, section CRUD.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useIsNarrow } from '../../lib/useViewport';
import { trApi } from '../../api/testrail';
import { Stamp } from '../../components/Stamp';
import { downloadCsv } from '../../lib/csv';
import { mapWithConcurrency } from '../../lib/asyncPool';
import { useWindowedRowCap } from '../../lib/scrollWindowing';
import {
  casesTableRows,
  csvForCases,
  filterCases,
  fmtUnixDate,
  groupCasesBySection,
  sectionDescendants,
  sectionHasChildren,
  sectionPath,
  subtreeCaseCounts,
  visibleSections,
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
import { BulkEditDialog } from './BulkEditDialog';
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

/** Rows painted initially; scrolling near the page bottom extends by this. */
const ROW_STEP = 400;

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
  const narrow = useIsNarrow();
  const st = useTestRail();
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ existing: TrCase | null } | null>(null);
  const [transfer, setTransfer] = useState<{ mode: 'copy' | 'move'; ids: number[] } | null>(null);
  const [sectionDialog, setSectionDialog] = useState<{ existing: TrSection | null; parentId: number | null } | null>(
    null,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [bulkEdit, setBulkEdit] = useState<number[] | null>(null);
  const rowCap = useWindowedRowCap(ROW_STEP);
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

  // A search scoped to a selected section that matches nothing looks like a
  // broken search — count what the same filters find suite-wide so the empty
  // state can offer the wider scope in one click.
  const matchesOutsideScope = useMemo(
    () => {
      if (visible.length > 0 || sectionScope == null) return 0;
      return filterCases(
        cases,
        {
          title: st.filters.titleContains,
          ownerText: st.filters.ownerText,
          assigneeText: st.filters.assigneeText,
          neverRan: st.filters.showNeverRan && Boolean(coverage),
          coverage: coverage?.covered ?? null,
          sectionIds: null,
          sectionPathById: sectionPathLower,
        },
        nameOf,
      ).length;
    },
    [visible.length, sectionScope, cases, st.filters, coverage, sectionPathLower, st.people, st.meta], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
        const results = await mapWithConcurrency(ids, 4, (id) => trApi.deleteCase(id));
        const failed = results.filter((result) => result.status === 'rejected').length;
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

  // ---- collapsible section tree (left panel) -------------------------------

  const [expandedSecs, setExpandedSecs] = useState<Set<number>>(new Set());
  const parentSecs = useMemo(() => sectionHasChildren(sections), [sections]);
  const treeRows = useMemo(() => visibleSections(sections, expandedSecs), [sections, expandedSecs]);
  const subtreeCounts = useMemo(
    () => subtreeCaseCounts(sections, countBySection),
    [sections, countBySection],
  );
  const toggleExpanded = (id: number) =>
    setExpandedSecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A section selected while hidden (search, palette, stale state) must not
  // sit invisible in a collapsed branch — expand its ancestors.
  useEffect(() => {
    if (st.selSectionId == null) return;
    setExpandedSecs((prev) => {
      const byId = new Map(sections.map((s) => [s.id, s]));
      let cur = byId.get(st.selSectionId as number);
      let next: Set<number> | null = null;
      let guard = 0;
      while (cur && cur.parentId != null && guard++ < 20) {
        if (!(next ?? prev).has(cur.parentId)) {
          next = next ?? new Set(prev);
          next.add(cur.parentId);
        }
        cur = byId.get(cur.parentId);
      }
      return next ?? prev;
    });
  }, [st.selSectionId, sections]);

  // Phone rendering of the same grouped data. The desktop table is a
  // fixed-layout grid of up to eight columns, which cannot be made legible at
  // 384px; the section grouping is the part that carries meaning, so it stays
  // and each case becomes a tappable card carrying its title plus whichever
  // columns the user has chosen, minus the title column itself.
  const caseCards = useMemo(() => {
    if (!narrow) return null;
    const metaCols = cols.filter((c) => c.key !== 'title');
    let painted = 0;
    const out: ReactNode[] = [];

    for (const group of groups) {
      if (painted >= rowCap) break;
      const collapsed = st.collapsedSecs.has(group.sectionId);
      const shown = collapsed ? [] : group.cases.slice(0, rowCap - painted);
      painted += shown.length;

      out.push(
        <div key={`sec-${group.sectionId}`} style={{ marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => toggleCollapsedSection(group.sectionId)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              padding: '10px 10px',
              background: 'var(--bg-panel-high)',
              border: '1px solid var(--border-soft)',
              borderRadius: 10,
              marginBottom: 6,
            }}
          >
            <span aria-hidden style={{ opacity: 0.7, fontSize: 12 }}>{collapsed ? '▶' : '▼'}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 13.5, overflowWrap: 'anywhere' }}>
              {sectionPath(group.sectionId, sections, st.suites, st.selSuiteId === 'all')}
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>{group.cases.length}</span>
          </button>

          {shown.map((c) => (
            <div
              key={c.id}
              onClick={() => setDrawerCaseId(c.id)}
              style={{
                border: st.caseSel.has(c.id)
                  ? '1px solid var(--accent-cyan)'
                  : '1px solid var(--border-soft)',
                borderRadius: 10,
                background: 'var(--bg-panel)',
                padding: '10px 12px',
                marginBottom: 6,
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
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
                  style={{ flex: '0 0 auto', marginTop: 2 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ ...mono, fontSize: 11, opacity: 0.7 }}>C{c.id}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.35, overflowWrap: 'anywhere', marginTop: 2 }}>
                    {c.title}
                    {cellCtx.neverRan(c) ? (
                      <>
                        {' '}
                        <Stamp variant="neverran">never ran</Stamp>
                      </>
                    ) : null}
                  </div>
                  {metaCols.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6 }}>
                      {metaCols.map((col) => (
                        <span key={col.key} style={{ fontSize: 11.5 }}>
                          <span className="muted" style={{ marginRight: 4 }}>{col.label}</span>
                          {col.cell(c, cellCtx)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>,
      );
    }

    if (visible.length > painted) {
      out.push(
        <div key="cap" className="tr-empty-note">
          Showing {painted} of {visible.length} cases — scroll down to load more.
        </div>,
      );
    }
    if (out.length === 0) {
      out.push(
        <div key="empty" className="tr-empty-note">
          {loadError
            ? `✕ Failed to load cases: ${loadError} — use ↻ Refresh to retry.`
            : 'No cases match the current filters.'}
        </div>,
      );
    }
    return out;
  }, [narrow, groups, cols, sections, st.suites, st.selSuiteId, st.collapsedSecs, st.caseSel, rowCap, visible.length, cellCtx, loadError]);

  // Memoized: up to ROW_CAP rows × ~8 cells used to rebuild on every render
  // (every keystroke and checkbox click).
  const tableRows = useMemo(
    () => casesTableRows(groups, sections, st.collapsedSecs),
    [groups, sections, st.collapsedSecs],
  );
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.sectionId, g.cases])), [groups]);

  const bodyRows: ReactNode[] = useMemo(() => {
  const rows: ReactNode[] = [];
  let painted = 0;
  for (const row of tableRows) {
    if (painted >= rowCap) break;
    const direct = groupsById.get(row.section.id) ?? [];
    const allSel = direct.length > 0 && direct.every((c) => st.caseSel.has(c.id));
    const shown = row.cases.slice(0, rowCap - painted);
    painted += shown.length;
    const suite =
      st.selSuiteId === 'all' && row.section.depth === 0 && row.section.suiteId != null
        ? st.suites.find((su) => su.id === row.section.suiteId)
        : undefined;
    rows.push(
      <tr
        key={`sec-${row.section.id}`}
        className="secrow"
        style={{ cursor: 'pointer' }}
        onClick={() => toggleCollapsedSection(row.section.id)}
      >
        <td colSpan={span}>
          <div className="secrow-flex" style={{ paddingLeft: row.section.depth * 18 }}>
            {direct.length > 0 ? (
              <input
                type="checkbox"
                checked={allSel}
                title="select all in section"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const on = e.target.checked;
                  setCaseSelection((next) => {
                    for (const c of direct) {
                      if (on) next.add(c.id);
                      else next.delete(c.id);
                    }
                  });
                }}
              />
            ) : null}
            <span>{row.collapsed ? '▸' : '▾'}</span>
            <span className="secrow-path">
              {suite ? `⟨${suite.name}⟩ ` : ''}
              {row.section.name}{' '}
              <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
                · {row.subtreeCount}
              </span>
            </span>
            {direct.length > 0 ? (
              <span className="sec-actions">
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTransfer({ mode: 'copy', ids: direct.map((c) => c.id) });
                  }}
                >
                  copy…
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTransfer({ mode: 'move', ids: direct.map((c) => c.id) });
                  }}
                >
                  move…
                </button>
              </span>
            ) : null}
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
            Showing {painted} of {visible.length} cases — scroll down to load more.
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
                ? sectionScope != null
                  ? 'Nothing here in the selected section.'
                  : 'Nothing here. Adjust the filter or add a case.'
                : 'loading cases for this suite…'}
            {!loadError && casesLoaded(st) && matchesOutsideScope > 0 ? (
              <button
                className="btn"
                style={{ marginLeft: 10 }}
                onClick={() => selectSection(null)}
              >
                Show {matchesOutsideScope} match{matchesOutsideScope === 1 ? '' : 'es'} in all sections
              </button>
            ) : null}
          </div>
        </td>
      </tr>,
    );
  }
  return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRows, groupsById, st.caseSel, st.suites, st.selSuiteId, cols, cellCtx, span, visible.length, loadError, rowCap, sectionScope, matchesOutsideScope]);

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
          <button className="btn" onClick={() => setBulkEdit([...st.caseSel])}>
            Edit… (assign / owner / priority)
          </button>
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
          <div
            className="card"
            style={{
              width: narrow ? '100%' : 260,
              flexShrink: 0,
              padding: 10,
              maxHeight: narrow ? '38vh' : '75vh',
              overflowY: 'auto',
            }}
          >
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
              ? treeRows.map((s) => {
                  const isParent = parentSecs.has(s.id);
                  const open = expandedSecs.has(s.id);
                  return (
                    <div
                      key={s.id}
                      className={`tr-sec ${st.selSectionId === s.id ? 'active' : ''}`}
                      style={{ paddingLeft: 4 + s.depth * 14 }}
                      onClick={() => selectSection(s.id)}
                    >
                      <span
                        className="tr-sec-arrow"
                        title={isParent ? (open ? 'Collapse subsections' : 'Show subsections') : undefined}
                        style={{
                          flex: '0 0 16px',
                          textAlign: 'center',
                          cursor: isParent ? 'pointer' : 'default',
                          color: 'var(--muted)',
                          userSelect: 'none',
                        }}
                        onClick={(e) => {
                          if (!isParent) return;
                          e.stopPropagation();
                          toggleExpanded(s.id);
                        }}
                      >
                        {isParent ? (open ? '▾' : '▸') : ''}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
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
                      <span className="cnt">
                        {(isParent ? subtreeCounts.get(s.id) : countBySection.get(s.id)) || ''}
                      </span>
                    </div>
                  );
                })
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

          {narrow ? (
            <div>{caseCards}</div>
          ) : (
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
          )}
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

      {bulkEdit ? (
        <BulkEditDialog
          st={st}
          caseIds={bulkEdit}
          onClose={() => setBulkEdit(null)}
          onSaved={() => {
            clearCaseSelection();
            refreshCasesFresh();
          }}
        />
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
