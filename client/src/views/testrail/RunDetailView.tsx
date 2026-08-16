// Run detail (Railbook renderRunDetail at parity): tiles, execution progress
// bar, status chips with counts + "My tests" (assigned ∪ executed-by-me via
// run results), status-tinted rows, colored quick buttons ✓✗⊘↻, extended
// result dialog (bulk too), per-test history drawer, bulk marking, 1500-row
// paint cap; every result post refetches tests + results with fresh=1.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { Modal } from '../../components/Modal';
import { fmtUnixDate, passPct } from '../../lib/testrail';
import { testrailRunIdStore } from '../../router';
import { pushToast } from '../../stores/toasts';
import { loadRuns, statusLabel, userName, type TestRailState } from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import type { TrResult, TrRun, TrTest } from '../../testrailTypes';
import {
  ConfirmDialog,
  Drawer,
  DrawerHead,
  PageTitle,
  RunStateStamp,
  StatusStamp,
  TestRailGate,
  Tile,
  errText,
  pageHeadStyle,
  useTestRail,
  type ConfirmSpec,
} from './common';
import { RunEditor } from './RunsView';

const PAINT_CAP = 1500;

const CHIPS: Array<{ key: string; label: string; cls: string; statusId: number | null }> = [
  { key: '', label: 'All', cls: 'c-all', statusId: null },
  { key: '1', label: 'Passed', cls: 'c-pass', statusId: 1 },
  { key: '5', label: 'Failed', cls: 'c-fail', statusId: 5 },
  { key: '2', label: 'Blocked', cls: 'c-blocked', statusId: 2 },
  { key: '4', label: 'Retest', cls: 'c-retest', statusId: 4 },
  { key: '3', label: 'Untested', cls: 'c-untested', statusId: 3 },
];

export function RunDetailView() {
  const st = useTestRail();
  const runId = useStore(testrailRunIdStore);
  const [tests, setTests] = useState<TrTest[] | null>(null);
  const [myExecuted, setMyExecuted] = useState<ReadonlySet<number>>(new Set());
  const [myReady, setMyReady] = useState(false);
  const [sel, setSel] = useState<ReadonlySet<number>>(new Set());
  const [filterText, setFilterText] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMine, setFilterMine] = useState(false);
  const [resultDialog, setResultDialog] = useState<TrTest[] | null>(null);
  const [historyTest, setHistoryTest] = useState<TrTest | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const me = st.session?.user?.id ?? null;

  const loadTests = useCallback(
    async (force = false) => {
      if (runId == null) return;
      const fresh = await trApi.tests(runId, force);
      setTests(fresh);
    },
    [runId],
  );

  const loadMyResults = useCallback(
    async (force = false) => {
      if (runId == null || me == null) return;
      try {
        const results = await trApi.runResults(runId, force);
        setMyExecuted(new Set(results.filter((r) => r.createdBy === me).map((r) => r.testId)));
        setMyReady(true);
      } catch {
        /* executed-by-me chip stays pending */
      }
    },
    [runId, me],
  );

  useEffect(() => {
    if (st.phase !== 'connected' || runId == null) return;
    setTests(null);
    setSel(new Set());
    setMyReady(false);
    void loadRuns().catch(() => {});
    void loadTests().catch((err) => pushToast({ title: 'Tests failed', body: errText(err) }));
    void loadMyResults();
  }, [st.phase, runId, loadTests, loadMyResults]);

  const run: TrRun = useMemo(() => {
    const found = st.runs.find((r) => r.id === runId);
    if (found) return found;
    return {
      id: runId ?? 0,
      projectId: st.projectId ?? 0,
      suiteId: null,
      name: `Run ${runId}`,
      description: null,
      isCompleted: false,
      createdOn: null,
      createdBy: null,
      assignedToId: null,
      refs: null,
      passedCount: 0,
      failedCount: 0,
      blockedCount: 0,
      retestCount: 0,
      untestedCount: 0,
    };
  }, [st.runs, runId, st.projectId]);

  const all = tests ?? [];

  const visible = useMemo(() => {
    let list = all;
    const q = filterText.trim().toLowerCase();
    if (q) {
      const idQ = q.replace(/^c/i, '');
      list = list.filter((t) => t.title.toLowerCase().includes(q) || String(t.caseId).includes(idQ));
    }
    if (filterStatus) list = list.filter((t) => t.statusId === Number(filterStatus));
    if (filterMine && me != null) list = list.filter((t) => t.assignedToId === me || myExecuted.has(t.id));
    const aq = filterAssignee.trim().toLowerCase();
    if (aq) list = list.filter((t) => userName(st, t.assignedToId).toLowerCase().includes(aq));
    return list;
    // Depend on the name sources only — a full [st] dep re-filtered up to
    // thousands of tests on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filterText, filterStatus, filterMine, filterAssignee, me, myExecuted, st.people, st.meta]);

  const myCount = me != null ? all.filter((t) => t.assignedToId === me || myExecuted.has(t.id)).length : 0;

  const assigneeNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of all) {
      if (t.assignedToId != null) names.add(userName(st, t.assignedToId));
    }
    return [...names].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, st.people, st.meta]);

  /** After any result post: fresh tests + results + run counts, keep the view. */
  const refresh = useCallback(async () => {
    void loadMyResults(true);
    await loadTests(true).catch((err) => pushToast({ title: 'Refresh failed', body: errText(err) }));
    await loadRuns(true).catch(() => {});
  }, [loadTests, loadMyResults]);

  const quickMark = async (testList: TrTest[], statusId: number) => {
    let failed = 0;
    for (const t of testList) {
      try {
        await trApi.addResult(t.id, { statusId });
      } catch {
        failed++;
      }
    }
    pushToast({
      title: 'TestRail',
      body: failed
        ? `Recorded with ${failed} failure(s).`
        : testList.length === 1
          ? `Recorded ${statusLabel(st, statusId)}.`
          : `Recorded ${testList.length} results.`,
    });
    setSel(new Set());
    await refresh();
  };

  const closeRun = () =>
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
          await loadTests(true).catch(() => {});
        } catch (err) {
          pushToast({ title: 'Close failed', body: errText(err) });
        }
      },
    });

  const deleteRun = () =>
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
          window.location.hash = '#/testrail/runs';
        } catch (err) {
          pushToast({ title: 'Delete failed', body: errText(err) });
        }
      },
    });

  const done = all.filter((t) => t.statusId !== 3).length;
  const total = all.length || 1;

  // Status tiles derive from the LIVE tests (fresh statuses); the cached run
  // record's counts go stale for up to an hour and confuse everyone.
  const counts = useMemo(() => {
    if (tests === null) {
      return {
        passed: run.passedCount,
        failed: run.failedCount,
        blocked: run.blockedCount,
        retest: run.retestCount,
        untested: run.untestedCount,
      };
    }
    const c = { passed: 0, failed: 0, blocked: 0, retest: 0, untested: 0 };
    for (const t of tests) {
      if (t.statusId === 1) c.passed++;
      else if (t.statusId === 5) c.failed++;
      else if (t.statusId === 2) c.blocked++;
      else if (t.statusId === 4) c.retest++;
      else c.untested++;
    }
    return c;
  }, [tests, run]);
  // Pass rate over ALL tests in the run — 17 passed of 3377 is ~1%, not the
  // "100% of what happened to be executed" illusion.
  const allTotal = counts.passed + counts.failed + counts.blocked + counts.retest + counts.untested;
  const passRate = allTotal > 0 ? `${Math.round((counts.passed / allTotal) * 100)}%` : passPct(run);

  const selectedTests = all.filter((t) => sel.has(t.id));
  const shown = visible.slice(0, PAINT_CAP);

  return (
    <TestRailGate st={st}>
      <div style={pageHeadStyle}>
        <PageTitle
          kicker={
            <>
              <a href="#/testrail/runs">← runs</a> · R{run.id}
            </>
          }
          title={run.name}
          lede={
            <>
              <RunStateStamp isCompleted={run.isCompleted} /> &nbsp;{all.length} tests · created{' '}
              {fmtUnixDate(run.createdOn)}
              {run.description ? ` — ${run.description}` : ''}
            </>
          }
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!run.isCompleted ? (
            <>
              <button className="btn" onClick={() => setEditorOpen(true)}>
                Edit
              </button>
              <button className="btn" onClick={closeRun}>
                Close run
              </button>
            </>
          ) : null}
          <button className="btn" style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={deleteRun}>
            Delete
          </button>
        </div>
      </div>

      <div className="tr-tiles">
        <Tile label="Passed" value={counts.passed} color="var(--accent-green)" />
        <Tile label="Failed" value={counts.failed} color="var(--accent-red)" />
        <Tile label="Blocked" value={counts.blocked} color="var(--accent-yellow)" />
        <Tile label="Retest" value={counts.retest} color="var(--accent-magenta)" />
        <Tile label="Untested" value={counts.untested} color="var(--muted)" />
        <Tile label="Pass rate" value={passRate} color="var(--accent-cyan)" />
      </div>

      <div className="bigbar-wrap">
        <div className="bigbar-label">
          <span>EXECUTION PROGRESS</span>
          <span>
            {done} / {all.length} executed · {Math.round((done / total) * 100)}%
          </span>
        </div>
        <div className="bigbar">
          {([
            [counts.passed, 'var(--accent-green)'],
            [counts.failed, 'var(--accent-red)'],
            [counts.blocked, 'var(--accent-yellow)'],
            [counts.retest, 'var(--accent-magenta)'],
          ] as Array<[number, string]>).map(([n, color], i) =>
            n > 0 ? <span key={i} style={{ width: `${((n / total) * 100).toFixed(2)}%`, background: color }} /> : null,
          )}
        </div>
      </div>

      {sel.size > 0 && !run.isCompleted ? (
        <div className="bulk-bar">
          <span className="n">{sel.size} tests selected</span>
          <button className="btn" onClick={() => void quickMark(selectedTests, 1)}>
            Mark passed
          </button>
          <button className="btn" onClick={() => void quickMark(selectedTests, 5)}>
            Mark failed
          </button>
          <button className="btn" onClick={() => void quickMark(selectedTests, 2)}>
            Mark blocked
          </button>
          <button className="btn" onClick={() => void quickMark(selectedTests, 4)}>
            Mark retest
          </button>
          <button className="btn" onClick={() => setResultDialog(selectedTests)}>
            Result with details…
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSel(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }}>
          <input
            placeholder="Search tests — title or C-id…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <input
            list="rdAssigneeList"
            placeholder="Assigned to…"
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            style={{ minWidth: 140 }}
          />
          <datalist id="rdAssigneeList">
            {assigneeNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <span style={{ flex: 1 }} />
          <div className="chip-row">
            {CHIPS.map((chip) => (
              <button
                key={chip.key}
                className={`chip ${chip.cls} ${filterStatus === chip.key ? 'active' : ''}`}
                onClick={() => setFilterStatus(chip.key)}
              >
                {chip.label}
                <span className="n">
                  {chip.statusId === null ? all.length : all.filter((t) => t.statusId === chip.statusId).length}
                </span>
              </button>
            ))}
            {me != null ? (
              <button
                className={`chip c-mine ${filterMine ? 'active' : ''}`}
                title="Assigned to me or executed by me"
                onClick={() => setFilterMine((v) => !v)}
              >
                My tests<span className="n">{myReady ? myCount : '…'}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tr-tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((t) => sel.has(t.id))}
                    onChange={(e) => {
                      if (e.target.checked) setSel(new Set(visible.map((t) => t.id)));
                      else setSel(new Set());
                    }}
                  />
                </th>
                <th>Test</th>
                <th>Title</th>
                <th>Status</th>
                <th>Assigned</th>
                <th style={{ textAlign: 'right' }}>Record</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={`st-${t.statusId} ${sel.has(t.id) ? 'selected' : ''}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={sel.has(t.id)}
                      onChange={(e) => {
                        setSel((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    T{t.id}
                    <br />
                    <span className="muted">C{t.caseId}</span>
                  </td>
                  <td>{t.title}</td>
                  <td>
                    <StatusStamp st={st} statusId={t.statusId} />
                  </td>
                  <td className="muted">{userName(st, t.assignedToId)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!run.isCompleted ? (
                      <>
                        <button className="qbtn q-pass" title="Pass" onClick={() => void quickMark([t], 1)}>
                          ✓
                        </button>{' '}
                        <button className="qbtn q-fail" title="Fail" onClick={() => void quickMark([t], 5)}>
                          ✗
                        </button>{' '}
                        <button className="qbtn q-blocked" title="Blocked" onClick={() => void quickMark([t], 2)}>
                          ⊘
                        </button>{' '}
                        <button className="qbtn q-retest" title="Retest" onClick={() => void quickMark([t], 4)}>
                          ↻
                        </button>{' '}
                        <button
                          className="btn"
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => setResultDialog([t])}
                        >
                          + result
                        </button>{' '}
                      </>
                    ) : null}
                    <button
                      className="btn"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setHistoryTest(t)}
                    >
                      history
                    </button>
                  </td>
                </tr>
              ))}
              {tests !== null && shown.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="tr-empty-note">No tests match.</div>
                  </td>
                </tr>
              ) : null}
              {tests === null ? (
                <tr>
                  <td colSpan={6}>
                    <div className="tr-empty-note">loading tests…</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {visible.length > PAINT_CAP ? (
          <div className="tr-empty-note">
            Showing {PAINT_CAP} of {visible.length} tests — narrow with search or the status chips.
          </div>
        ) : null}
      </div>

      {resultDialog ? (
        <ResultDialog
          st={st}
          tests={resultDialog}
          onClose={() => setResultDialog(null)}
          onDone={() => {
            setSel(new Set());
            void refresh();
          }}
        />
      ) : null}

      {historyTest ? <HistoryDrawer st={st} test={historyTest} onClose={() => setHistoryTest(null)} /> : null}

      {editorOpen ? <RunEditor st={st} existing={run} onClose={() => setEditorOpen(false)} /> : null}
      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </TestRailGate>
  );
}

// ---------------------------------------------------------------------------
// extended result dialog (Railbook resultEntryModal) — single or bulk
// ---------------------------------------------------------------------------

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

function ResultDialog({
  st,
  tests,
  onClose,
  onDone,
}: {
  st: TestRailState;
  tests: TrTest[];
  onClose: () => void;
  onDone: () => void;
}) {
  const statuses = (st.meta?.statuses ?? []).filter((s) => s.id !== 3);
  const options = statuses.length
    ? statuses.map((s) => ({ id: s.id, label: s.label }))
    : [
        { id: 1, label: 'Passed' },
        { id: 2, label: 'Blocked' },
        { id: 4, label: 'Retest' },
        { id: 5, label: 'Failed' },
      ];
  const [statusId, setStatusId] = useState(options[0]?.id ?? 1);
  const [comment, setComment] = useState('');
  const [defects, setDefects] = useState('');
  const [elapsed, setElapsed] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const many = tests.length > 1;

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        statusId,
        comment: comment.trim() || null,
        defects: defects.trim() || null,
        elapsed: elapsed.trim() || null,
        version: version.trim() || null,
      };
      let failed = 0;
      for (const t of tests) {
        try {
          await trApi.addResult(t.id, body);
        } catch {
          failed++;
        }
      }
      pushToast({
        title: 'TestRail',
        body: failed ? `Recorded with ${failed} failure(s).` : 'Result recorded.',
      });
      onClose();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Record result${many ? `s — ${tests.length} tests` : ''}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '…' : 'Record'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!many ? (
          <p className="muted" style={{ margin: 0 }}>
            T{tests[0].id} — {tests[0].title}
          </p>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={fieldCol}>
            Status
            <select value={statusId} onChange={(e) => setStatusId(Number(e.target.value))}>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldCol}>
            Elapsed
            <input value={elapsed} placeholder="e.g. 5m" onChange={(e) => setElapsed(e.target.value)} />
          </label>
          <label style={fieldCol}>
            Defects
            <input value={defects} placeholder="JIRA-123" onChange={(e) => setDefects(e.target.value)} />
          </label>
          <label style={fieldCol}>
            Version
            <input value={version} placeholder="build / fw version" onChange={(e) => setVersion(e.target.value)} />
          </label>
        </div>
        <label style={fieldCol}>
          Comment
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// per-test history drawer (Railbook resultHistoryDrawer)
// ---------------------------------------------------------------------------

function HistoryDrawer({ st, test, onClose }: { st: TestRailState; test: TrTest; onClose: () => void }) {
  const [results, setResults] = useState<TrResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void trApi
      .testResults(test.id)
      .then((list) => {
        if (!cancelled) setResults(list);
      })
      .catch((err) => {
        if (!cancelled) setError(errText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [test.id]);

  return (
    <Drawer onClose={onClose}>
      <DrawerHead kicker={`TEST T${test.id} · CASE C${test.caseId}`} title={test.title} onClose={onClose} />
      <div style={{ marginTop: 10 }}>
        Current: <StatusStamp st={st} statusId={test.statusId} />
      </div>
      <hr className="tr-rule" />
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'var(--muted)',
          padding: '0 0 10px',
        }}
      >
        Result history
      </div>
      {error ? <div className="muted">✕ {error}</div> : null}
      {!error && results === null ? <div className="muted">loading…</div> : null}
      {results !== null && results.length === 0 ? <div className="muted">No results recorded yet.</div> : null}
      {(results ?? []).map((r) => (
        <div
          key={r.id}
          className="step-card"
          style={{
            borderLeftColor:
              r.statusId === 1 ? 'var(--accent-green)' : r.statusId === 5 ? 'var(--accent-red)' : 'var(--border-soft)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {r.statusId ? <StatusStamp st={st} statusId={r.statusId} /> : <span className="stamp s-neutral">note</span>}
            <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              {fmtUnixDate(r.createdOn)} · {userName(st, r.createdBy)}
            </span>
          </div>
          {r.comment ? <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{r.comment}</div> : null}
          {r.defects || r.elapsed || r.version ? (
            <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, marginTop: 6 }}>
              {r.defects ? `defects: ${r.defects} · ` : ''}
              {r.elapsed ? `elapsed: ${r.elapsed} · ` : ''}
              {r.version ? `version: ${r.version}` : ''}
            </div>
          ) : null}
        </div>
      ))}
    </Drawer>
  );
}
