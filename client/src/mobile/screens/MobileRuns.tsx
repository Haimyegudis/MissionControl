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
import {
  ensureCases,
  ensureSections,
  initTestRail,
  selectProject,
  selectSuite,
  trStore,
} from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import { pushToast } from '../../stores/toasts';
import { fmtUnixDate, passPct, resolveRunCaseFilter } from '../../lib/testrail';
import type { TrCase, TrRun, TrSection, TrTest } from '../../testrailTypes';
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

/**
 * Create run — the same field set as the desktop RunEditor, so a run made on a
 * phone is indistinguishable from one made at a desk: name, assignee,
 * references, description, suite, and how the cases are chosen.
 *
 * Case selection has the desktop's three modes and reuses resolveRunCaseFilter
 * for the dynamic one, so "what will be included" cannot drift between the two
 * clients.
 */
function CreateRunSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const st = useStore(trStore);
  const [name, setName] = useState('');
  const [refs, setRefs] = useState('');
  const [description, setDescription] = useState('');
  const [suiteId, setSuiteId] = useState<number | null>(
    typeof st.selSuiteId === 'number' ? st.selSuiteId : (st.suites[0]?.id ?? null),
  );
  // Defaults to the connected TestRail user, as TestRail itself does.
  const [assignedTo, setAssignedTo] = useState<number | ''>(st.session?.user?.id ?? '');
  const [mode, setMode] = useState<'all' | 'specific' | 'dynamic'>('all');
  const [sections, setSections] = useState<TrSection[]>([]);
  const [suiteCases, setSuiteCases] = useState<TrCase[] | null>(null);
  const [sel, setSel] = useState<ReadonlySet<number>>(() => new Set());
  const [pickFilter, setPickFilter] = useState('');
  const [dynSections, setDynSections] = useState<number[]>([]);
  const [dynPriority, setDynPriority] = useState<number | ''>('');
  const [dynTitle, setDynTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (suiteId === null) return;
    let cancelled = false;
    setSuiteCases(null);
    setSections([]);
    setSel(new Set());
    setDynSections([]);
    void Promise.all([ensureSections(suiteId), ensureCases(suiteId)])
      .then(([secLists]) => {
        if (cancelled) return;
        setSections([...(secLists[0] ?? [])].sort((a, b) => a.displayOrder - b.displayOrder));
        setSuiteCases(trStore.get().cases[suiteId] ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [suiteId]);

  const assignOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const [id, personName] of Object.entries(st.people)) map.set(Number(id), personName);
    for (const u of st.meta?.users ?? []) if (!map.has(u.id)) map.set(u.id, u.name);
    const me = st.session?.user;
    if (me && !map.has(me.id)) map.set(me.id, me.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
  }, [st.people, st.meta, st.session]);

  const pickCases = useMemo(() => {
    const q = pickFilter.trim().toLowerCase();
    const list = suiteCases ?? [];
    return q ? list.filter((c) => c.title.toLowerCase().includes(q) || `c${c.id}` === q) : list;
  }, [suiteCases, pickFilter]);

  const dynMatches = useMemo(
    () =>
      resolveRunCaseFilter(suiteCases ?? [], sections, {
        sectionIds: dynSections,
        priorityId: dynPriority === '' ? null : dynPriority,
        ownerId: null,
        titleContains: dynTitle,
      }),
    [suiteCases, sections, dynSections, dynPriority, dynTitle],
  );

  const included = mode === 'all' ? (suiteCases?.length ?? 0) : mode === 'specific' ? sel.size : dynMatches.length;

  const create = async () => {
    if (!name.trim()) {
      pushToast({ title: 'Run', body: 'Give the run a name.', severity: 'error' });
      return;
    }
    if (st.projectId === null) return;
    const caseIds = mode === 'all' ? [] : mode === 'specific' ? [...sel] : dynMatches.map((c) => c.id);
    if (mode !== 'all' && caseIds.length === 0) {
      pushToast({ title: 'Run', body: 'No cases selected.', severity: 'error' });
      return;
    }
    setBusy(true);
    try {
      await trApi.addRun(st.projectId, {
        suiteId,
        name: name.trim(),
        description: description.trim() || null,
        // TestRail's refs field is what links a run to its Jira epic.
        refs: refs.trim() || null,
        assignedToId: assignedTo === '' ? null : assignedTo,
        includeAll: mode === 'all',
        caseIds,
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
          {busy ? 'Creating…' : `Create run · ${included} case${included === 1 ? '' : 's'}`}
        </button>
      }
    >
      <Field label="Name" value={name} onChange={setName} placeholder="S6 regression — week 34" />

      <FieldLabel>Assign to</FieldLabel>
      <Select value={assignedTo === '' ? '' : String(assignedTo)} onChange={(v) => setAssignedTo(v === '' ? '' : Number(v))}>
        <option value="">Unassigned</option>
        {assignOptions.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>

      <Field label="References / epic" value={refs} onChange={setRefs} placeholder="ISW-1234" />
      <Field label="Description" value={description} onChange={setDescription} placeholder="Optional" />

      <FieldLabel>Suite</FieldLabel>
      <Select value={suiteId === null ? '' : String(suiteId)} onChange={(v) => setSuiteId(v === '' ? null : Number(v))}>
        {st.suites.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>

      <FieldLabel>Cases</FieldLabel>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['all', 'specific', 'dynamic'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              ...tapReset,
              flex: 1,
              minHeight: 40,
              borderRadius: 9,
              border: `1px solid ${mode === m ? 'var(--accent-cyan)' : 'var(--border-soft)'}`,
              background: mode === m ? 'var(--bg-panel-high)' : 'transparent',
              color: mode === m ? 'var(--accent-cyan)' : 'var(--muted)',
              fontSize: 12.5,
              textTransform: 'capitalize',
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {suiteCases === null ? <Muted>Loading cases…</Muted> : null}

      {mode === 'specific' && suiteCases !== null ? (
        <>
          <input
            type="search"
            value={pickFilter}
            onChange={(e) => setPickFilter(e.target.value)}
            placeholder="Filter cases…"
            style={inputStyle}
          />
          <div style={{ maxHeight: '34vh', overflowY: 'auto', marginTop: 8 }}>
            {pickCases.map((c) => (
              <label
                key={c.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  minHeight: 44,
                  padding: '6px 2px',
                  borderBottom: '1px solid var(--border-soft)',
                }}
              >
                <input
                  type="checkbox"
                  checked={sel.has(c.id)}
                  onChange={(e) =>
                    setSel((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.65 }}>C{c.id}</span> {c.title}
                </span>
              </label>
            ))}
          </div>
        </>
      ) : null}

      {mode === 'dynamic' && suiteCases !== null ? (
        <>
          <FieldLabel>Sections</FieldLabel>
          <div style={{ maxHeight: '22vh', overflowY: 'auto', marginBottom: 8 }}>
            {sections.map((sec) => (
              <label
                key={sec.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  minHeight: 42,
                  borderBottom: '1px solid var(--border-soft)',
                }}
              >
                <input
                  type="checkbox"
                  checked={dynSections.includes(sec.id)}
                  onChange={(e) =>
                    setDynSections((prev) =>
                      e.target.checked ? [...prev, sec.id] : prev.filter((id) => id !== sec.id),
                    )
                  }
                />
                <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                  {'\u00a0'.repeat(Math.max(0, sec.depth * 2))}
                  {sec.name}
                </span>
              </label>
            ))}
          </div>

          <FieldLabel>Priority</FieldLabel>
          <Select
            value={dynPriority === '' ? '' : String(dynPriority)}
            onChange={(v) => setDynPriority(v === '' ? '' : Number(v))}
          >
            <option value="">Any</option>
            {(st.meta?.priorities ?? []).map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
              </option>
            ))}
          </Select>

          <FieldLabel>Title contains</FieldLabel>
          <input value={dynTitle} onChange={(e) => setDynTitle(e.target.value)} style={inputStyle} />
          <Muted>{dynMatches.length} case(s) match right now.</Muted>
        </>
      ) : null}
    </Sheet>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid var(--border-soft)',
  background: 'var(--input-bg)',
  color: 'var(--text-primary)',
  fontSize: 15,
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        margin: '10px 0 4px',
      }}
    >
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, padding: '0 10px' }}>
      {children}
    </select>
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
