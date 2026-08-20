// Tests. Cases and Runs behind one segmented control, sharing a project picker.
//
// On desktop these are two routes with their own toolbars, side panels and
// column pickers. On a phone they are the same job — "what are we testing and
// how is it going" — so they share a screen, a project selector and a search
// box, and differ only in what the list shows.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ensureCases,
  ensureSections,
  initTestRail,
  loadRuns,
  selectProject,
  trStore,
} from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import { fmtUnixDate, passPct } from '../../lib/testrail';
import type { TrCase, TrRun } from '../../testrailTypes';
import { Empty, ErrorNote, ListCard, Loading, Muted, Pill, Screen, Segmented, Sheet, tapReset } from '../ui';

type Mode = 'cases' | 'runs';

export function MobileTests() {
  const st = useStore(trStore);
  const [mode, setMode] = useState<Mode>('cases');
  const [query, setQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [runs, setRuns] = useState<TrRun[]>([]);
  const [cases, setCases] = useState<TrCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void initTestRail();
  }, []);

  const refresh = useCallback(
    async (which: Mode) => {
      if (st.phase !== 'connected') return;
      setBusy(true);
      setError(null);
      try {
        if (which === 'runs') {
          setRuns(await loadRuns());
        } else {
          if (st.selSuiteId === null) { setCases([]); return; }
          await ensureSections(st.selSuiteId);
          const lists = await ensureCases(st.selSuiteId);
          setCases(lists.flat());
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [st.phase, st.selSuiteId],
  );

  useEffect(() => {
    void refresh(mode);
  }, [refresh, mode, st.projectId]);

  const needle = query.trim().toLowerCase();
  const shownRuns = useMemo(
    () => (needle ? runs.filter((r) => r.name.toLowerCase().includes(needle)) : runs),
    [runs, needle],
  );
  const shownCases = useMemo(
    () =>
      needle
        ? cases.filter((c) => c.title.toLowerCase().includes(needle) || String(c.id).includes(needle))
        : cases,
    [cases, needle],
  );

  const project = st.allProjects.find((p) => p.id === st.projectId);

  if (st.phase === 'disconnected') {
    return (
      <Screen kicker="TestRail" title="Tests">
        <Empty>
          Not connected to TestRail.
          <br />
          Open More → Settings to add your API key.
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen
      kicker="TestRail"
      title={mode === 'cases' ? 'Cases' : 'Runs'}
      action={
        <button className="btn" onClick={() => void refresh(mode)} disabled={busy} style={{ ...tapReset, minHeight: 40 }}>
          {busy ? '…' : '↻'}
        </button>
      }
    >
      <Segmented
        value={mode}
        options={[
          { value: 'cases', label: 'Cases' },
          { value: 'runs', label: 'Runs' },
        ]}
        onChange={setMode}
      />

      <button
        onClick={() => setProjectOpen(true)}
        style={{
          ...tapReset,
          width: '100%',
          minHeight: 44,
          textAlign: 'left',
          padding: '0 12px',
          border: '1px solid var(--border-soft)',
          borderRadius: 10,
          background: 'var(--bg-panel)',
          color: 'var(--text-primary)',
          fontSize: 13.5,
          marginBottom: 8,
        }}
      >
        {project ? project.name : 'Choose a project'} ›
      </button>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={mode === 'cases' ? 'Search cases…' : 'Search runs…'}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 12px',
          borderRadius: 10,
          border: '1px solid var(--border-soft)',
          background: 'var(--input-bg)',
          color: 'var(--text-primary)',
          fontSize: 15,
          marginBottom: 10,
        }}
      />

      {error ? <ErrorNote onRetry={() => void refresh(mode)}>{error}</ErrorNote> : null}
      {busy && (mode === 'runs' ? runs : cases).length === 0 ? <Loading what={`Loading ${mode}`} /> : null}

      {mode === 'runs'
        ? shownRuns.length === 0 && !busy
          ? <Empty>No runs in this project.</Empty>
          : shownRuns.map((run) => {
              const pct = passPct(run);
              const total = run.passedCount + run.failedCount + run.blockedCount + run.retestCount + run.untestedCount;
              return (
                <ListCard
                  key={run.id}
                  accent={run.failedCount > 0 ? 'var(--accent-red)' : run.isCompleted ? 'var(--muted)' : 'var(--accent-green)'}
                  lead={
                    <>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                        R{run.id}
                      </span>
                      {run.isCompleted ? <Muted>closed</Muted> : null}
                      <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700 }}>{pct}%</span>
                    </>
                  }
                  title={run.name}
                  footer={
                    <>
                      <Pill tone="var(--accent-green)">{run.passedCount} passed</Pill>
                      {run.failedCount > 0 ? <Pill tone="var(--accent-red)">{run.failedCount} failed</Pill> : null}
                      {run.blockedCount > 0 ? <Pill tone="var(--accent-orange)">{run.blockedCount} blocked</Pill> : null}
                      <Muted>{total} tests</Muted>
                      {run.createdOn ? <Muted>{fmtUnixDate(run.createdOn)}</Muted> : null}
                    </>
                  }
                />
              );
            })
        : shownCases.length === 0 && !busy
          ? <Empty>No cases match.</Empty>
          : shownCases.slice(0, 300).map((c) => (
              <ListCard
                key={c.id}
                lead={
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                    C{c.id}
                  </span>
                }
                title={c.title}
                footer={<>{c.refs ? <Muted>{c.refs}</Muted> : null}{c.estimate ? <Muted>{c.estimate}</Muted> : null}</>}
              />
            ))}

      {mode === 'cases' && shownCases.length > 300 ? (
        <Muted>Showing the first 300 of {shownCases.length}. Narrow the search to see more.</Muted>
      ) : null}

      <Sheet open={projectOpen} title="Project" onClose={() => setProjectOpen(false)}>
        {st.allProjects.map((p) => (
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
              fontWeight: p.id === st.projectId ? 650 : 450,
              fontSize: 14,
            }}
          >
            {p.name}
          </button>
        ))}
      </Sheet>
    </Screen>
  );
}
