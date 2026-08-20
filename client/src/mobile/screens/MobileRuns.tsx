// TestRail → Runs. Browse runs, create one from a suite, and execute tests.
//
// Executing is the whole point of having this on a phone: you are next to the
// press, not the desk. So a run opens straight into its test list with
// Pass/Fail/Block one tap away, and recording a result advances to the next
// untested case.
//
// "Assign to epic" is TestRail's `refs` field — the same field the desktop
// uses to link a run back to a Jira key.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { initTestRail, selectProject, selectSuite, trStore } from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import { pushToast } from '../../stores/toasts';
import { fmtUnixDate, passPct } from '../../lib/testrail';
import type { TrRun, TrTest } from '../../testrailTypes';
import { invalidate, useCached } from '../cache';
import { pushBackHandler } from '../backHandler';
import { Empty, ErrorNote, ListCard, Loading, Muted, Pill, Screen, Sheet, tapReset } from '../ui';

/** TestRail's built-in status ids. */
const RESULTS: ReadonlyArray<{ id: number; label: string; tone: string }> = [
  { id: 1, label: 'Pass', tone: 'var(--accent-green)' },
  { id: 5, label: 'Fail', tone: 'var(--accent-red)' },
  { id: 2, label: 'Block', tone: 'var(--accent-orange)' },
  { id: 4, label: 'Retest', tone: 'var(--accent-yellow)' },
];

export function MobileRuns() {
  const st = useStore(trStore);

  // The store starts at 'idle', not 'disconnected'. Booting only from the
  // disconnected branch meant a fresh mount never loaded anything and the
  // project list came up empty.
  useEffect(() => {
    void initTestRail();
  }, []);
  const [projectOpen, setProjectOpen] = useState(false);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openRun, setOpenRun] = useState<TrRun | null>(null);

  const res = useCached<TrRun[]>(
    `runs:${st.projectId ?? 'none'}`,
    () => (st.projectId === null ? Promise.resolve([]) : trApi.runs(st.projectId)),
    { ttlMs: 2 * 60_000, enabled: st.phase === 'connected' },
  );

  const reload = useCallback(() => {
    invalidate('runs:');
    res.refresh();
  }, [res]);

  if (st.phase === 'idle' || st.phase === 'loading') {
    return (
      <Screen kicker="TestRail" title="Runs">
        <Loading what="Connecting to TestRail" />
      </Screen>
    );
  }

  if (st.phase === 'disconnected') {
    return (
      <Screen kicker="TestRail" title="Runs">
        <Empty>
          Not connected to TestRail.
          <br />
          Open More → Settings to add your API key.
        </Empty>
      </Screen>
    );
  }

  if (openRun) {
    return <RunDetail run={openRun} onBack={() => setOpenRun(null)} onChanged={reload} />;
  }

  const project = st.projects.find((p) => p.id === st.projectId);
  const suiteLabel =
    st.selSuiteId === 'all'
      ? 'All suites'
      : (st.suites.find((x) => x.id === st.selSuiteId)?.name ?? 'Suite');
  // A run belongs to a suite, so filtering the list by the selected suite is
  // the same scoping the Cases screen applies.
  const all = res.data ?? [];
  const runs =
    st.selSuiteId === 'all' || st.selSuiteId === null
      ? all
      : all.filter((r) => r.suiteId === null || r.suiteId === st.selSuiteId);

  return (
    <Screen
      kicker="TestRail"
      title="Runs"
      action={
        <>
          <button
            className="btn btn-primary"
            onClick={() => setCreating(true)}
            style={{ ...tapReset, minHeight: 40, padding: '0 12px' }}
          >
            + Run
          </button>
          <button className="btn" onClick={reload} disabled={res.refreshing} style={{ ...tapReset, minHeight: 40 }}>
            {res.refreshing ? '…' : '↻'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <PickerButton label={project ? project.name : 'Project'} onClick={() => setProjectOpen(true)} />
        <PickerButton label={suiteLabel} onClick={() => setSuiteOpen(true)} />
      </div>

      {res.error ? <ErrorNote onRetry={reload}>{res.error}</ErrorNote> : null}
      {res.loading ? <Loading what="Loading runs" /> : null}
      {res.data && runs.length === 0 ? <Empty>No runs in this project.</Empty> : null}

      {runs.map((run) => {
        const total = run.passedCount + run.failedCount + run.blockedCount + run.retestCount + run.untestedCount;
        return (
          <ListCard
            key={run.id}
            onClick={() => setOpenRun(run)}
            accent={run.failedCount > 0 ? 'var(--accent-red)' : run.isCompleted ? 'var(--muted)' : 'var(--accent-green)'}
            lead={
              <>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                  R{run.id}
                </span>
                {run.isCompleted ? <Muted>closed</Muted> : null}
                <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700 }}>{passPct(run)}%</span>
              </>
            }
            title={run.name}
            footer={
              <>
                <Pill tone="var(--accent-green)">{run.passedCount} pass</Pill>
                {run.failedCount > 0 ? <Pill tone="var(--accent-red)">{run.failedCount} fail</Pill> : null}
                {run.untestedCount > 0 ? <Muted>{run.untestedCount} untested</Muted> : null}
                <Muted>{total} tests</Muted>
                {run.refs ? <Pill tone="var(--accent-blue)">{run.refs}</Pill> : null}
                {run.createdOn ? <Muted>{fmtUnixDate(run.createdOn)}</Muted> : null}
              </>
            }
          />
        );
      })}

      <Sheet open={projectOpen} title="Project" onClose={() => setProjectOpen(false)}>
        {st.projects.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              void selectProject(p.id);
              setProjectOpen(false);
            }}
            style={{
              ...tapReset,
              display: 'block',
              width: '100%',
              textAlign: 'left',
              minHeight: 48,
              padding: '10px 2px',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid var(--border-soft)',
              color: p.id === st.projectId ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: 14,
            }}
          >
            {p.name}
          </button>
        ))}
      </Sheet>

      <Sheet open={suiteOpen} title="Suite" onClose={() => setSuiteOpen(false)}>
        <button
          onClick={() => {
            selectSuite('all');
            setSuiteOpen(false);
          }}
          style={pickRow(st.selSuiteId === 'all')}
        >
          All suites
        </button>
        {st.suites.map((su) => (
          <button
            key={su.id}
            onClick={() => {
              selectSuite(su.id);
              setSuiteOpen(false);
            }}
            style={pickRow(su.id === st.selSuiteId)}
          >
            {su.name}
          </button>
        ))}
      </Sheet>

      {creating ? (
        <CreateRunSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------ create run --- */

function CreateRunSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const st = useStore(trStore);
  const [name, setName] = useState('');
  const [epic, setEpic] = useState('');
  const [description, setDescription] = useState('');
  const [suiteId, setSuiteId] = useState<number | null>(st.suites[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      pushToast({ title: 'Run', body: 'Give the run a name.', severity: 'error' });
      return;
    }
    if (st.projectId === null) return;
    setBusy(true);
    try {
      await trApi.addRun(st.projectId, {
        suiteId,
        name: name.trim(),
        description: description.trim() || null,
        // TestRail's refs field is what links a run to its Jira epic.
        refs: epic.trim() || null,
        assignedToId: null,
        includeAll: true,
        caseIds: [],
      });
      pushToast({ title: 'Run', body: 'Created.' });
      onCreated();
    } catch (e) {
      pushToast({ title: 'Run', body: e instanceof Error ? e.message : String(e), severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      title="New test run"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void create()}
          style={{ ...tapReset, width: '100%', minHeight: 46, justifyContent: 'center' }}
        >
          {busy ? 'Creating…' : 'Create run'}
        </button>
      }
    >
      <Field label="Name" value={name} onChange={setName} placeholder="S6 regression — week 34" />
      <Field label="Epic / Jira key" value={epic} onChange={setEpic} placeholder="ISW-1234" />
      <Field label="Description" value={description} onChange={setDescription} placeholder="Optional" />

      <div style={{ fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', margin: '10px 0 4px' }}>
        Suite
      </div>
      <select
        value={suiteId ?? ''}
        onChange={(e) => setSuiteId(Number(e.target.value))}
        style={{
          width: '100%',
          minHeight: 44,
          borderRadius: 10,
          border: '1px solid var(--border-soft)',
          background: 'var(--input-bg)',
          color: 'var(--text-primary)',
          fontSize: 15,
          padding: '0 10px',
        }}
      >
        {st.suites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <Muted>Every case in the suite is included. Narrow it afterwards from the run.</Muted>
    </Sheet>
  );
}

/* ------------------------------------------------------------ run detail --- */

function RunDetail({ run, onBack, onChanged }: { run: TrRun; onBack: () => void; onChanged: () => void }) {
  const [filter, setFilter] = useState<'all' | 'untested' | 'failed'>('all');

  // Back leaves the run rather than the app.
  useEffect(
    () =>
      pushBackHandler(() => {
        onBack();
        return true;
      }),
    [onBack],
  );

  const res = useCached<TrTest[]>(`run:${run.id}:tests`, () => trApi.tests(run.id), { ttlMs: 60_000 });

  const record = async (test: TrTest, statusId: number) => {
    try {
      await trApi.addResult(test.id, { statusId });
      invalidate(`run:${run.id}`);
      invalidate('runs:');
      res.refresh();
      onChanged();
    } catch (e) {
      pushToast({ title: 'Result', body: e instanceof Error ? e.message : String(e), severity: 'error' });
    }
  };

  const tests = res.data ?? [];
  const shown = useMemo(() => {
    if (filter === 'untested') return tests.filter((t) => t.statusId === 3);
    if (filter === 'failed') return tests.filter((t) => t.statusId === 5);
    return tests;
  }, [tests, filter]);

  return (
    <Screen
      kicker={`TestRail · R${run.id}`}
      title={run.name}
      action={
        <button className="btn" onClick={onBack} style={{ ...tapReset, minHeight: 40 }}>
          ‹ Back
        </button>
      }
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['all', 'untested', 'failed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...tapReset,
              flex: 1,
              minHeight: 40,
              borderRadius: 10,
              border: '1px solid var(--border-soft)',
              background: filter === f ? 'var(--bg-panel-high)' : 'transparent',
              color: filter === f ? 'var(--accent-cyan)' : 'var(--muted)',
              fontSize: 13,
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {res.error ? <ErrorNote onRetry={() => res.refresh()}>{res.error}</ErrorNote> : null}
      {res.loading ? <Loading what="Loading tests" /> : null}
      {res.data && shown.length === 0 ? <Empty>Nothing here.</Empty> : null}

      {shown.map((test) => (
        <div
          key={test.id}
          style={{
            border: '1px solid var(--border-soft)',
            borderRadius: 12,
            background: 'var(--bg-panel)',
            padding: '10px 12px',
            marginBottom: 8,
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7 }}>C{test.caseId}</div>
          <div style={{ fontSize: 14, lineHeight: 1.35, overflowWrap: 'anywhere', marginTop: 2 }}>{test.title}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {RESULTS.map((r) => (
              <button
                key={r.id}
                onClick={() => void record(test, r.id)}
                style={{
                  ...tapReset,
                  flex: 1,
                  minHeight: 42,
                  borderRadius: 9,
                  border: `1px solid ${test.statusId === r.id ? r.tone : 'var(--border-soft)'}`,
                  background: test.statusId === r.id ? r.tone : 'transparent',
                  color: test.statusId === r.id ? 'var(--bg-panel)' : r.tone,
                  fontSize: 12.5,
                  fontWeight: 650,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Screen>
  );
}

function PickerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...tapReset,
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        textAlign: 'left',
        padding: '0 12px',
        border: '1px solid var(--border-soft)',
        borderRadius: 10,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        fontSize: 13,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label} ›
    </button>
  );
}

function pickRow(active: boolean) {
  return {
    ...tapReset,
    display: 'block' as const,
    width: '100%',
    textAlign: 'left' as const,
    minHeight: 48,
    padding: '10px 2px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid var(--border-soft)',
    color: active ? 'var(--accent-cyan)' : 'var(--text-primary)',
    fontWeight: active ? 650 : 450,
    fontSize: 14,
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <>
      <div style={{ fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', margin: '10px 0 4px' }}>
        {label}
      </div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 12px',
          borderRadius: 10,
          border: '1px solid var(--border-soft)',
          background: 'var(--input-bg)',
          color: 'var(--text-primary)',
          fontSize: 15,
        }}
      />
    </>
  );
}
