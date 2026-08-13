// Execution report (Railbook renderReports at parity): totals tiles, overall
// distribution + legend, per-run distribution rows (latest 30 after the suite
// filter) with pass% + run links, plus a search filter over the run rows.

import { useEffect, useMemo, useState } from 'react';
import { aggregateCounts, fmtUnixDate, passPct, totalCount } from '../../lib/testrail';
import { pushToast } from '../../stores/toasts';
import { loadRuns, selectProject } from '../../stores/testrail';
import {
  DistBar,
  PageTitle,
  TestRailGate,
  Tile,
  errText,
  pageHeadStyle,
  useTestRail,
} from './common';

export function TestRailReportsView() {
  const st = useTestRail();
  const [search, setSearch] = useState('');
  const [suiteFilter, setSuiteFilter] = useState('');

  useEffect(() => {
    if (st.phase !== 'connected') return;
    void loadRuns().catch((err) => pushToast({ title: 'Runs failed', body: errText(err) }));
  }, [st.phase, st.projectId]);

  // Project switch → the suite filter no longer applies to the new suites.
  useEffect(() => {
    setSuiteFilter('');
  }, [st.projectId]);

  const runs = useMemo(
    () => (suiteFilter ? st.runs.filter((r) => r.suiteId === Number(suiteFilter)) : st.runs),
    [st.runs, suiteFilter],
  );
  const agg = useMemo(() => aggregateCounts(runs), [runs]);
  const total = totalCount(agg);
  const active = runs.filter((r) => !r.isCompleted).length;
  const latest = useMemo(
    () => [...runs].sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0)).slice(0, 30),
    [runs],
  );
  const q = search.trim().toLowerCase();
  const shown = q
    ? latest.filter((r) => `${r.name} ${r.description ?? ''} r${r.id}`.toLowerCase().includes(q))
    : latest;

  const project = st.projects.find((p) => p.id === st.projectId);

  const legend: Array<[string, number, string]> = [
    ['pass', agg.passedCount, 'var(--accent-green)'],
    ['fail', agg.failedCount, 'var(--accent-red)'],
    ['blocked', agg.blockedCount, 'var(--accent-yellow)'],
    ['retest', agg.retestCount, 'var(--accent-magenta)'],
    ['untested', agg.untestedCount, 'var(--muted)'],
  ];

  return (
    <TestRailGate st={st}>
      <div style={pageHeadStyle}>
        <PageTitle
          kicker="TestRail · reports"
          title="Execution report"
          lede={`${project?.name ?? ''} — ${runs.length} runs, ${total} test entries recorded.`}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <input placeholder="Search runs…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={suiteFilter} onChange={(e) => setSuiteFilter(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">All suites</option>
            {st.suites.map((su) => (
              <option key={su.id} value={su.id}>
                {su.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tr-tiles">
        <Tile label="Runs" value={runs.length} hint={`${active} active`} color="var(--accent-cyan)" />
        <Tile
          label="Overall pass rate"
          value={total ? `${Math.round((agg.passedCount / total) * 100)}%` : '—'}
          color="var(--accent-green)"
        />
        <Tile label="Failures" value={agg.failedCount} color="var(--accent-red)" />
        <Tile label="Blocked" value={agg.blockedCount} color="var(--accent-yellow)" />
        <Tile label="Untested backlog" value={agg.untestedCount} color="var(--muted)" />
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--muted)',
            paddingBottom: 6,
          }}
        >
          Overall distribution
        </div>
        <DistBar r={agg} />
        <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 8 }}>
          {legend.map(([label, n, color]) => (
            <span key={label} style={{ marginRight: 12 }}>
              <span style={{ color }}>■</span> {label} {n}
            </span>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--muted)',
            paddingBottom: 10,
          }}
        >
          Per-run distribution (latest {latest.length})
        </div>
        {shown.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 320px) 60px',
              gap: 12,
              alignItems: 'center',
              padding: '5px 0',
            }}
          >
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <a href={`#/testrail/run/${r.id}`} title={`created ${fmtUnixDate(r.createdOn)}`}>
                {r.name}
              </a>
            </div>
            <DistBar r={r} />
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{passPct(r)}</div>
          </div>
        ))}
        {shown.length === 0 ? <div className="tr-empty-note">No runs to report on.</div> : null}
      </div>
    </TestRailGate>
  );
}
