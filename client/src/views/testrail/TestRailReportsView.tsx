import { useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { compareRunTests, type RunComparison } from '../../lib/runComparison';
import { aggregateCounts, fmtUnixDate, passPct, totalCount } from '../../lib/testrail';
import { navigate } from '../../router';
import { loadRuns, openCase, selectProject, userName } from '../../stores/testrail';
import { pushToast } from '../../stores/toasts';
import type { TrResult, TrTest } from '../../testrailTypes';
import {
  DistBar,
  PageTitle,
  StatusStamp,
  TestRailGate,
  Tile,
  errText,
  pageHeadStyle,
  useTestRail,
} from './common';

type ReportTab = 'overview' | 'compare' | 'triage';

export function TestRailReportsView() {
  const st = useTestRail();
  const [tab, setTab] = useState<ReportTab>('overview');
  const [search, setSearch] = useState('');
  const [suiteFilter, setSuiteFilter] = useState('');
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [triageRunId, setTriageRunId] = useState('');
  const [triageTests, setTriageTests] = useState<TrTest[]>([]);
  const [triageResults, setTriageResults] = useState<TrResult[]>([]);
  const [triageStatus, setTriageStatus] = useState<'all' | 'failed' | 'blocked' | 'retest'>('all');
  const [triageBusy, setTriageBusy] = useState(false);

  useEffect(() => {
    if (st.phase !== 'connected') return;
    void loadRuns().catch((err) => pushToast({ title: 'Runs failed', body: errText(err) }));
  }, [st.phase, st.projectId]);

  useEffect(() => {
    setSuiteFilter('');
    setComparison(null);
  }, [st.projectId]);

  const runs = useMemo(
    () => (suiteFilter ? st.runs.filter((run) => run.suiteId === Number(suiteFilter)) : st.runs),
    [st.runs, suiteFilter],
  );
  const latest = useMemo(
    () => [...runs].sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0)).slice(0, 30),
    [runs],
  );

  useEffect(() => {
    if (!latest.length) return;
    if (!afterId || !latest.some((run) => String(run.id) === afterId)) setAfterId(String(latest[0].id));
    if (!beforeId || !latest.some((run) => String(run.id) === beforeId)) setBeforeId(String(latest[1]?.id ?? latest[0].id));
    if (!triageRunId || !latest.some((run) => String(run.id) === triageRunId)) setTriageRunId(String(latest[0].id));
  }, [latest, afterId, beforeId, triageRunId]);

  useEffect(() => {
    if (tab !== 'triage' || !triageRunId) return;
    let active = true;
    setTriageBusy(true);
    Promise.all([trApi.tests(Number(triageRunId)), trApi.runResults(Number(triageRunId))])
      .then(([tests, results]) => {
        if (!active) return;
        setTriageTests(tests);
        setTriageResults(results);
      })
      .catch((err) => pushToast({ title: 'Triage load failed', body: errText(err) }))
      .finally(() => { if (active) setTriageBusy(false); });
    return () => { active = false; };
  }, [tab, triageRunId]);

  const agg = useMemo(() => aggregateCounts(runs), [runs]);
  const total = totalCount(agg);
  const active = runs.filter((run) => !run.isCompleted).length;
  const q = search.trim().toLowerCase();
  const shown = q
    ? latest.filter((run) => `${run.name} ${run.description ?? ''} r${run.id}`.toLowerCase().includes(q))
    : latest;
  const project = st.projects.find((item) => item.id === st.projectId);

  const runComparison = async () => {
    if (!beforeId || !afterId) return;
    setCompareBusy(true);
    try {
      const [before, after] = await Promise.all([trApi.tests(Number(beforeId)), trApi.tests(Number(afterId))]);
      setComparison(compareRunTests(before, after));
    } catch (err) {
      pushToast({ title: 'Comparison failed', body: errText(err) });
    } finally {
      setCompareBusy(false);
    }
  };

  const defectByTest = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const result of triageResults) {
      for (const defect of (result.defects ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
        const values = map.get(result.testId) ?? new Set<string>();
        values.add(defect);
        map.set(result.testId, values);
      }
    }
    return new Map([...map].map(([id, values]) => [id, [...values].join(', ')]));
  }, [triageResults]);

  const triageRows = useMemo(() => {
    const wanted = triageStatus === 'failed' ? 5 : triageStatus === 'blocked' ? 2 : triageStatus === 'retest' ? 4 : null;
    return triageTests
      .filter((test) => [2, 4, 5].includes(test.statusId))
      .filter((test) => wanted === null || test.statusId === wanted)
      .filter((test) => !q || `${test.title} c${test.caseId} ${defectByTest.get(test.id) ?? ''}`.toLowerCase().includes(q));
  }, [triageTests, triageStatus, q, defectByTest]);

  const tabs: Array<[ReportTab, string]> = [
    ['overview', 'Overview'],
    ['compare', 'Compare runs'],
    ['triage', 'Failure triage'],
  ];

  return (
    <TestRailGate st={st}>
      <div style={pageHeadStyle}>
        <PageTitle
          kicker="TestRail · reports"
          title="Execution report"
          lede={`${project?.name ?? ''} — ${runs.length} runs, ${total} test entries recorded.`}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select title="Project" value={st.projectId ?? ''} onChange={(e) => void selectProject(Number(e.target.value))} style={{ minWidth: 150 }}>
            {st.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input placeholder={tab === 'triage' ? 'Search failures or defects…' : 'Search runs…'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={suiteFilter} onChange={(e) => setSuiteFilter(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">All suites</option>
            {st.suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {tabs.map(([value, label]) => (
          <button key={value} className={`btn${tab === value ? ' btn-primary' : ''}`} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          <div className="tr-tiles">
            <Tile label="Runs" value={runs.length} hint={`${active} active`} color="var(--accent-cyan)" />
            <Tile label="Overall pass rate" value={total ? `${Math.round((agg.passedCount / total) * 100)}%` : '—'} color="var(--accent-green)" />
            <Tile label="Failures" value={agg.failedCount} color="var(--accent-red)" />
            <Tile label="Blocked" value={agg.blockedCount} color="var(--accent-yellow)" />
            <Tile label="Untested backlog" value={agg.untestedCount} color="var(--muted)" />
          </div>
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="tr-kicker" style={{ paddingBottom: 6 }}>Overall distribution</div>
            <DistBar r={agg} />
            <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 8 }}>
              <span style={{ marginRight: 12, color: 'var(--accent-green)' }}>■ pass {agg.passedCount}</span>
              <span style={{ marginRight: 12, color: 'var(--accent-red)' }}>■ fail {agg.failedCount}</span>
              <span style={{ marginRight: 12, color: 'var(--accent-yellow)' }}>■ blocked {agg.blockedCount}</span>
              <span style={{ marginRight: 12, color: 'var(--accent-magenta)' }}>■ retest {agg.retestCount}</span>
              <span>■ untested {agg.untestedCount}</span>
            </div>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="tr-kicker" style={{ paddingBottom: 8 }}>Per-run distribution (latest {latest.length})</div>
            {shown.map((run) => (
              <div key={run.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 320px) 60px', gap: 12, alignItems: 'center', padding: '5px 0' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <a href={`#/testrail/run/${run.id}`} title={`created ${fmtUnixDate(run.createdOn)}`}>{run.name}</a>
                </div>
                <DistBar r={run} />
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{passPct(run)}</div>
              </div>
            ))}
            {!shown.length ? <div className="tr-empty-note">No runs to report on.</div> : null}
          </div>
        </>
      ) : null}

      {tab === 'compare' ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px' }}>
              <span className="muted" style={{ fontSize: 11 }}>BEFORE RUN</span>
              <select value={beforeId} onChange={(e) => { setBeforeId(e.target.value); setComparison(null); }}>
                {latest.map((run) => <option key={run.id} value={run.id}>R{run.id} · {run.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px' }}>
              <span className="muted" style={{ fontSize: 11 }}>AFTER RUN</span>
              <select value={afterId} onChange={(e) => { setAfterId(e.target.value); setComparison(null); }}>
                {latest.map((run) => <option key={run.id} value={run.id}>R{run.id} · {run.name}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" disabled={compareBusy || beforeId === afterId} onClick={() => void runComparison()}>
              {compareBusy ? 'Comparing…' : 'Compare'}
            </button>
          </div>
          {comparison ? (
            <>
              <div className="tr-tiles" style={{ marginBottom: 12 }}>
                <Tile label="New failures" value={comparison.newFailures.length} color="var(--accent-red)" />
                <Tile label="Fixed" value={comparison.fixed.length} color="var(--accent-green)" />
                <Tile label="Still failing" value={comparison.persistentFailures.length} color="var(--accent-magenta)" />
                <Tile label="Newly blocked" value={comparison.newlyBlocked.length} color="var(--accent-yellow)" />
                <Tile label="Newly untested" value={comparison.newlyUntested.length} color="var(--muted)" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                {([
                  ['Regressions', comparison.newFailures, 'var(--accent-red)'],
                  ['Fixed since before', comparison.fixed, 'var(--accent-green)'],
                  ['Persistent failures', comparison.persistentFailures, 'var(--accent-magenta)'],
                ] as const).map(([label, items, color]) => (
                  <div key={label} style={{ border: '1px solid var(--border-soft)', borderRadius: 7, padding: 10 }}>
                    <div className="tr-kicker" style={{ color, marginBottom: 6 }}>{label} ({items.length})</div>
                    {items.slice(0, 30).map((item) => <div key={item.caseId} style={{ fontSize: 12, padding: '3px 0' }}>C{item.caseId} · {item.title}</div>)}
                    {!items.length ? <div className="muted" style={{ fontSize: 12 }}>None</div> : null}
                  </div>
                ))}
              </div>
            </>
          ) : <div className="tr-empty-note">Choose two runs to see case-level regressions and fixes.</div>}
        </div>
      ) : null}

      {tab === 'triage' ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={triageRunId} onChange={(e) => setTriageRunId(e.target.value)} style={{ minWidth: 280 }}>
              {latest.map((run) => <option key={run.id} value={run.id}>R{run.id} · {run.name}</option>)}
            </select>
            {(['all', 'failed', 'blocked', 'retest'] as const).map((status) => (
              <button key={status} className={`btn${triageStatus === status ? ' btn-primary' : ''}`} style={{ padding: '3px 9px' }} onClick={() => setTriageStatus(status)}>
                {status === 'all' ? `All actionable ${triageTests.filter((test) => [2, 4, 5].includes(test.statusId)).length}` : `${status[0].toUpperCase()}${status.slice(1)} ${triageTests.filter((test) => test.statusId === ({ failed: 5, blocked: 2, retest: 4 } as const)[status]).length}`}
              </button>
            ))}
          </div>
          {triageBusy ? <div className="tr-empty-note">Loading failures and defects…</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}><th>Case</th><th>Title</th><th>Status</th><th>Owner</th><th>Defects</th></tr></thead>
                <tbody>
                  {triageRows.slice(0, 100).map((test) => (
                    <tr key={test.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                      <td style={{ padding: '7px 8px 7px 0' }}>
                        <button className="btn" style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => {
                          const run = runs.find((item) => item.id === Number(triageRunId));
                          openCase(test.caseId, run?.suiteId ?? 0);
                          navigate('testrail-cases');
                        }}>C{test.caseId}</button>
                      </td>
                      <td><a href={`#/testrail/run/${triageRunId}`}>{test.title}</a></td>
                      <td><StatusStamp st={st} statusId={test.statusId} /></td>
                      <td>{userName(st, test.assignedToId)}</td>
                      <td style={{ color: defectByTest.has(test.id) ? 'var(--accent-cyan)' : 'var(--muted)' }}>{defectByTest.get(test.id) ?? 'No defect linked'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!triageRows.length ? <div className="tr-empty-note">No matching failed, blocked, or retest cases.</div> : null}
              {triageRows.length > 100 ? <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>Showing first 100 of {triageRows.length}; use status or search to narrow.</div> : null}
            </div>
          )}
        </div>
      ) : null}
    </TestRailGate>
  );
}
