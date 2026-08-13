// Test runs (Railbook renderRuns at parity): 200ms-debounced search across
// ALL runs (name/description/id/creator), suite filter, My-runs chip, newest
// 500 display cap, edit/close/delete (typed confirm), run creation with a
// whole-suite/section scope and a live case-count preview.

import { useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { fmtUnixDate, passPct, sectionDescendants } from '../../lib/testrail';
import { Modal } from '../../components/Modal';
import { navigateTestRailRun } from '../../router';
import { pushToast } from '../../stores/toasts';
import {
  ensureCases,
  ensureSections,
  loadRuns,
  trStore,
  userName,
  type TestRailState,
} from '../../stores/testrail';
import type { TrRun, TrSection } from '../../testrailTypes';
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

const DISPLAY_CAP = 500;

export function RunsView() {
  const st = useTestRail();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [suiteFilter, setSuiteFilter] = useState('');
  const [myOnly, setMyOnly] = useState(false);
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
    return [...list].sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0));
  }, [runs, suiteFilter, search, myOnly, me, st.people, st.meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = filtered.slice(0, DISPLAY_CAP);
  const activeCount = filtered.filter((r) => !r.isCompleted).length;
  const myCount = me != null ? runs.filter((r) => r.createdBy === me).length : 0;

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

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tr-tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Created</th>
                <th>By</th>
                <th>Status</th>
                <th style={{ width: 220 }}>Distribution</th>
                <th style={{ textAlign: 'right' }}>Pass</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigateTestRailRun(r.id)}>
                  <td>{r.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    {fmtUnixDate(r.createdOn)}
                  </td>
                  <td className="muted">{userName(st, r.createdBy)}</td>
                  <td>
                    <RunStateStamp isCompleted={r.isCompleted} />
                  </td>
                  <td>
                    <DistBar r={r} />
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{passPct(r)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {!r.isCompleted ? (
                      <>
                        <button
                          className="btn"
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => setEditor({ existing: r })}
                        >
                          edit
                        </button>{' '}
                        <button
                          className="btn"
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => closeRun(r)}
                        >
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
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="tr-empty-note">{st.runsLoaded ? 'No matching runs.' : 'loading runs…'}</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {filtered.length > DISPLAY_CAP ? (
          <div className="tr-empty-note">
            Showing newest {DISPLAY_CAP} of {filtered.length} matches — narrow with search or suite filter.
          </div>
        ) : null}
      </div>

      {editor ? <RunEditor st={st} existing={editor.existing} onClose={() => setEditor(null)} /> : null}
      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </TestRailGate>
  );
}

// ---------------------------------------------------------------------------
// run editor (Railbook runEditorModal) — create with explicit caseIds
// ---------------------------------------------------------------------------

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

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
  const [scope, setScope] = useState('all');
  const [scopeSections, setScopeSections] = useState<TrSection[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Live scope options + case-count preview.
  useEffect(() => {
    if (isEdit || suiteId == null) return;
    let cancelled = false;
    setScope('all');
    void ensureSections(suiteId)
      .then(([secs]) => {
        if (!cancelled) setScopeSections([...secs].sort((a, b) => a.displayOrder - b.displayOrder));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isEdit, suiteId]);

  useEffect(() => {
    if (isEdit || suiteId == null) return;
    let cancelled = false;
    setPreviewCount(null);
    void ensureCases(suiteId)
      .then(() => {
        if (cancelled) return;
        const cases = trStore.get().cases[suiteId] ?? [];
        if (scope === 'all') {
          setPreviewCount(cases.length);
        } else {
          const secs = trStore.get().sections[suiteId] ?? [];
          const ids = sectionDescendants(Number(scope), secs);
          setPreviewCount(cases.filter((c) => c.sectionId != null && ids.has(c.sectionId)).length);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isEdit, suiteId, scope]);

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
        const cases = trStore.get().cases[suiteId] ?? [];
        let caseIds: number[];
        if (scope === 'all') {
          caseIds = cases.map((c) => c.id);
        } else {
          const secs = trStore.get().sections[suiteId] ?? [];
          const ids = sectionDescendants(Number(scope), secs);
          caseIds = cases.filter((c) => c.sectionId != null && ids.has(c.sectionId)).map((c) => c.id);
        }
        if (!caseIds.length) {
          pushToast({ title: 'TestRail', body: 'Selection contains no cases.' });
          return;
        }
        await trApi.addRun(st.projectId, {
          suiteId,
          name: name.trim(),
          description: description.trim() || null,
          caseIds,
          refs: refs.trim() || null,
        });
        pushToast({ title: 'TestRail', body: `Run created with ${caseIds.length} cases.` });
      }
      onClose();
      await loadRuns(true);
    } catch (err) {
      pushToast({ title: isEdit ? 'Update failed' : 'Create failed', body: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit run' : 'New test run'}
      width={560}
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
                Scope
                <select value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="all">Whole suite</option>
                  {scopeSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {'— '.repeat(s.depth)}
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {previewCount === null
                ? 'counting cases…'
                : `${previewCount} case${previewCount === 1 ? '' : 's'} will be included`}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
