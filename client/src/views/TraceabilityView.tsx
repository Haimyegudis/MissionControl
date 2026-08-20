import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { confluence, issues } from '../api/client';
import { trApi } from '../api/testrail';
import { PageHeader } from '../components/PageHeader';
import { dialogs } from '../dialogs/DialogHost';
import { errText } from '../lib/errors';
import { confluenceReferences, documentIssueLinks, resolveEpicHierarchy, withTimeout, type EpicHierarchy } from '../lib/traceability';
import { initTestRail, openCase, trStore } from '../stores/testrail';
import { useStore } from '../stores/useStore';
import type { ConfluencePage } from '../types';
import type { TrRun } from '../testrailTypes';

interface LinkedCase {
  id: number;
  title: string;
  refs: string | null;
  suiteId: number;
  suiteName: string;
  projectId: number;
  projectName: string;
}

interface TraceResult {
  hierarchy: EpicHierarchy;
  cases: LinkedCase[];
  runs: TrRun[];
  pages: ConfluencePage[];
  documentSources: string[];
}

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
type CockpitTab = 'overview' | 'coverage' | 'actions' | 'impact';

interface WatchedEpic {
  key: string;
  summary: string;
  score: number;
  status: string;
  cases: number;
  runs: number;
  pages: number;
  checkedAt: string;
}

const WATCH_KEY = 'mc.traceability.watchlist';

function loadWatchlist(): WatchedEpic[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCH_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchedEpic[]): void {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(items)); } catch { /* unavailable */ }
}

export function TraceabilityView() {
  const tr = useStore(trStore);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationNote, setIntegrationNote] = useState('');
  const [tab, setTab] = useState<CockpitTab>('overview');
  const [watchlist, setWatchlist] = useState<WatchedEpic[]>(loadWatchlist);
  const inspectSequence = useRef(0);

  useEffect(() => { void initTestRail(); }, []);

  const inspect = async (requestedKey?: string) => {
    const issueKey = (requestedKey ?? key).trim().toUpperCase();
    if (!KEY_RE.test(issueKey)) {
      setError('Enter a Jira issue key such as ISW-1234.');
      return;
    }
    const sequence = ++inspectSequence.current;
    setBusy(true);
    setError('');
    setIntegrationNote('');
    setIntegrationsLoading(false);
    setResult(null);
    let hierarchy: EpicHierarchy;
    try {
      hierarchy = await withTimeout(resolveEpicHierarchy(issueKey, issues.details), 15_000, 'Jira epic lookup');
    } catch (cause) {
      if (inspectSequence.current !== sequence) return;
      setError(errText(cause));
      setBusy(false);
      return;
    }
    if (inspectSequence.current !== sequence) return;

    // Render the Jira hierarchy immediately. Slow integrations populate in a
    // second phase and cannot leave the primary action stuck on "Inspecting".
    const linkedDocuments = documentIssueLinks(hierarchy.epic.linkedIssues ?? []);
    const directReferences = confluenceReferences(hierarchy.epic);
    const documentSources = [hierarchy.epic.issue.key, ...linkedDocuments.map((link) => link.key)]
      .filter((value, index, values) => values.indexOf(value) === index);
    setResult({ hierarchy, cases: [], pages: [], runs: [], documentSources });
    setBusy(false);
    setIntegrationsLoading(true);
    const projectIds = tr.projects.map((project) => project.id);
    const epicKey = hierarchy.epic.issue.key;
    const [caseResult, pageResult, runResult] = await Promise.allSettled([
      projectIds.length
        ? withTimeout(trApi.casesByRef(epicKey, projectIds), 12_000, 'TestRail case lookup')
        : Promise.resolve([] as LinkedCase[]),
      withTimeout(
        Promise.allSettled([
          ...directReferences.map((reference) => reference.pageId
            ? confluence.page(reference.pageId).then((page) => [page] as ConfluencePage[])
            : confluence.resolvePage(reference.spaceKey!, reference.title!).then((page) => [page])),
          ...documentSources.map((sourceKey) => confluence.search({ query: sourceKey, limit: 100 })),
        ])
          .then((outcomes) => {
            const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<ConfluencePage[]> => outcome.status === 'fulfilled');
            if (fulfilled.length === 0) {
              const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
              throw failed?.reason ?? new Error('Confluence document search failed.');
            }
            const unique = new Map<string, ConfluencePage>();
            for (const outcome of fulfilled) for (const page of outcome.value) unique.set(page.id, page);
            return [...unique.values()];
          }),
        12_000,
        'Confluence linked-document search',
      ),
      projectIds.length
        ? withTimeout(Promise.all(projectIds.map((projectId) => trApi.runs(projectId))), 12_000, 'TestRail run lookup')
        : Promise.resolve([] as TrRun[][]),
    ]);
    if (inspectSequence.current !== sequence) return;
    const cases = caseResult.status === 'fulfilled' ? caseResult.value : [];
    const pages = pageResult.status === 'fulfilled' ? pageResult.value : [];
    const runLists = runResult.status === 'fulfilled' ? runResult.value : [];
    const compact = (value: string) => value.replace(/\s+/g, '').toUpperCase();
    const needle = compact(epicKey);
    const runs = runLists.flat().filter((run) => compact(`${run.refs ?? ''} ${run.name}`).includes(needle));
    const failures = [caseResult, pageResult, runResult]
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      .map((outcome) => errText(outcome.reason));
    setResult({ hierarchy, cases, pages, runs, documentSources });
    const refreshedScore = 25 * [
      hierarchy.epic.issue.statusCategory === 'done',
      cases.length > 0,
      runs.length > 0,
      pages.length > 0,
    ].filter(Boolean).length;
    setWatchlist((current) => {
      if (!current.some((item) => item.key === epicKey)) return current;
      const next = current.map((item) => item.key === epicKey ? {
        ...item,
        summary: hierarchy.epic.issue.summary,
        status: hierarchy.epic.issue.status,
        score: refreshedScore,
        cases: cases.length,
        runs: runs.length,
        pages: pages.length,
        checkedAt: new Date().toISOString(),
      } : item);
      saveWatchlist(next);
      return next;
    });
    setIntegrationNote(failures.length ? `Some connections could not be loaded: ${failures.join(' · ')}` : 'Epic connections loaded.');
    setIntegrationsLoading(false);
  };

  const checks = useMemo(() => {
    if (!result) return [];
    const issueDone = result.hierarchy.epic.issue.statusCategory === 'done';
    return [
      { label: 'Epic complete', ok: issueDone, detail: result.hierarchy.epic.issue.status },
      { label: 'Test cases linked', ok: result.cases.length > 0, pending: integrationsLoading, detail: integrationsLoading ? 'Loading…' : `${result.cases.length} cases` },
      { label: 'Execution evidence', ok: result.runs.length > 0, pending: integrationsLoading, detail: integrationsLoading ? 'Loading…' : `${result.runs.length} matching runs` },
      { label: 'Documentation linked', ok: result.pages.length > 0, pending: integrationsLoading, detail: integrationsLoading ? 'Loading…' : `${result.pages.length} pages` },
    ];
  }, [result, integrationsLoading]);
  const passedChecks = checks.filter((check) => check.ok).length;
  const score = checks.length ? Math.round(passedChecks / checks.length * 100) : 0;
  const epicKey = result?.hierarchy.epic.issue.key ?? '';
  const watched = watchlist.some((item) => item.key === epicKey);

  const actions = useMemo(() => {
    if (!result) return [];
    const rows: Array<{ severity: 'high' | 'medium' | 'low'; title: string; detail: string }> = [];
    const epic = result.hierarchy.epic.issue;
    const updatedMs = epic.updated ? new Date(epic.updated).getTime() : Date.now();
    const ageDays = Math.max(0, Math.floor((Date.now() - updatedMs) / 86_400_000));
    if (epic.statusCategory !== 'done') rows.push({ severity: 'high', title: 'Complete the epic', detail: `Current status: ${epic.status}` });
    if (!epic.assignee) rows.push({ severity: 'high', title: 'Assign an epic owner', detail: 'The epic is currently unassigned.' });
    if (ageDays >= 14) rows.push({ severity: 'medium', title: 'Review stale epic', detail: `No Jira update for ${ageDays} days.` });
    if (!result.cases.length) rows.push({ severity: 'high', title: 'Link TestRail coverage', detail: 'No TestRail case references the epic.' });
    if (!result.pages.length) rows.push({ severity: 'high', title: 'Link required documents', detail: 'No SWR, DR, Integration, or UX page resolved.' });
    if (!result.runs.length) rows.push({ severity: 'medium', title: 'Add execution evidence', detail: 'No run explicitly references the epic.' });
    const failures = result.runs.reduce((sum, run) => sum + run.failedCount, 0);
    const blocked = result.runs.reduce((sum, run) => sum + run.blockedCount, 0);
    const untested = result.runs.reduce((sum, run) => sum + run.untestedCount, 0);
    if (failures) rows.push({ severity: 'high', title: 'Triage failed tests', detail: `${failures} failed result${failures === 1 ? '' : 's'} across linked runs.` });
    if (blocked) rows.push({ severity: 'medium', title: 'Resolve blocked tests', detail: `${blocked} blocked result${blocked === 1 ? '' : 's'}.` });
    if (untested) rows.push({ severity: 'low', title: 'Finish execution backlog', detail: `${untested} test${untested === 1 ? '' : 's'} remain untested.` });
    return rows;
  }, [result]);

  const toggleWatch = () => {
    if (!result) return;
    const next = watched
      ? watchlist.filter((item) => item.key !== epicKey)
      : [{
          key: epicKey,
          summary: result.hierarchy.epic.issue.summary,
          score,
          status: result.hierarchy.epic.issue.status,
          cases: result.cases.length,
          runs: result.runs.length,
          pages: result.pages.length,
          checkedAt: new Date().toISOString(),
        }, ...watchlist.filter((item) => item.key !== epicKey)].slice(0, 30);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const compactList = (items: Array<{ id: string; content: ReactNode }>, empty: string) => (
    items.length ? <div style={{ display: 'grid', gap: 5 }}>{items.map((item) => <div key={item.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>{item.content}</div>)}</div> : <p className="muted">{empty}</p>
  );

  return (
    <div>
      <PageHeader kicker="CROSS-SYSTEM" title="Traceability & release readiness" subtitle="Enter a QA task; Mission Control follows its parent to the epic and traces the epic's documentation and tests." />
      <div className="card" style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <label htmlFor="trace-key" style={{ fontWeight: 600 }}>Jira key</label>
        <input id="trace-key" value={key} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void inspect(); }} placeholder="ISW-1234" />
        <button className="btn btn-primary" onClick={() => void inspect()} disabled={busy}>{busy ? 'Inspecting…' : 'Inspect'}</button>
        {error ? <span style={{ color: 'var(--accent-red)' }}>{error}</span> : null}
      </div>

      {result ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
              <div><div className="muted">EPIC · {result.hierarchy.epic.issue.key}</div><h2 style={{ margin: '3px 0' }}>{result.hierarchy.epic.issue.summary}</h2></div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div aria-label={`Readiness score ${score} percent; ${passedChecks} of 4 checks passed`} style={{ fontSize: 28, fontWeight: 700, color: score === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>{score}%</div>
                <div className="muted" style={{ fontSize: 11 }}>{passedChecks}/4 checks passed · 25% each</div>
                <button className="btn" style={{ marginTop: 6, padding: '2px 8px', fontSize: 11 }} onClick={toggleWatch}>{watched ? '★ Watching' : '☆ Watch epic'}</button>
              </div>
            </div>
            <p className="muted" style={{ margin: '10px 0 0' }}>
              Readiness = Epic complete (25%) + TestRail cases linked (25%) + TestRail execution run found (25%) + Confluence documentation linked (25%).
            </p>
            <div className="tr-tiles" style={{ marginTop: 12 }}>
              {checks.map((check) => <div className="tr-tile" key={check.label} style={{ '--tile-color': check.pending ? 'var(--accent-yellow)' : check.ok ? 'var(--accent-green)' : 'var(--accent-red)' } as CSSProperties}><div className="t-label">{check.pending ? 'LOADING' : check.ok ? 'READY' : 'GAP'}</div><div style={{ fontWeight: 600 }}>{check.label}</div><div className="t-hint">{check.detail}</div></div>)}
            </div>
            <div aria-label="Jira hierarchy" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
              {result.hierarchy.chain.map((item, index) => <span key={item.issue.key} style={{ display: 'contents' }}>{index > 0 ? <span className="muted">→</span> : null}<a href={`#/issue/${item.issue.key}`} onClick={(event) => { event.preventDefault(); dialogs.openIssueDetails(item.issue.key); }}><b>{item.issue.key}</b> <span className="muted">{item.issue.issueType}</span></a></span>)}
            </div>
            {integrationsLoading || integrationNote ? <p className="muted" role="status" style={{ marginBottom: 0 }}>{integrationsLoading ? 'Loading epic connections from Confluence and TestRail…' : integrationNote}</p> : null}
          </section>

          <div role="tablist" aria-label="Release cockpit" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['overview', 'coverage', 'actions', 'impact'] as CockpitTab[]).map((value) => <button key={value} role="tab" aria-selected={tab === value} className="btn" onClick={() => setTab(value)} style={{ textTransform: 'capitalize', borderColor: tab === value ? 'var(--accent-cyan)' : undefined, color: tab === value ? 'var(--accent-cyan)' : undefined }}>{value}{value === 'actions' && actions.length ? ` (${actions.length})` : ''}</button>)}
          </div>

          {tab === 'overview' ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            <section className="card"><h3>TestRail cases ({result.cases.length})</h3>{compactList(result.cases.slice(0, 8).map((testCase) => ({ id: String(testCase.id), content: <><a href="#/testrail/cases" onClick={() => openCase(testCase.id, testCase.suiteId ?? 0)}>C{testCase.id} — {testCase.title}</a> <span className="muted">{testCase.suiteName}</span></> })), 'No case references the epic.')}</section>
            <section className="card"><h3>Execution runs ({result.runs.length})</h3>{compactList(result.runs.slice(0, 8).map((run) => ({ id: String(run.id), content: <><a href={`#/testrail/run/${run.id}`}>{run.name}</a> <span className="muted">{run.isCompleted ? 'completed' : 'open'} · {run.failedCount} failed</span></> })), 'No run explicitly references the epic.')}</section>
            <section className="card"><h3>Documents ({result.pages.length})</h3>{compactList(result.pages.slice(0, 8).map((page) => ({ id: page.id, content: <><a href={`#/confluence/${page.id}`}>{page.title}</a> <span className="muted">{page.spaceKey}</span></> })), 'No linked document resolved.')}</section>
          </div> : null}

          {tab === 'coverage' ? <section className="card"><h3>Coverage matrix</h3><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}><thead><tr><th style={{ textAlign: 'left' }}>Layer</th><th style={{ textAlign: 'left' }}>Evidence</th><th>Status</th><th>Gap / next action</th></tr></thead><tbody>{[
            ['Requirement', result.hierarchy.epic.issue.key, true, '—'],
            ['Documentation', `${result.pages.length} linked pages`, result.pages.length > 0, result.pages.length ? '—' : 'Link SWR/DR/Integration/UX'],
            ['Test design', `${result.cases.length} TestRail cases`, result.cases.length > 0, result.cases.length ? '—' : 'Add epic reference to cases'],
            ['Execution', `${result.runs.length} runs`, result.runs.length > 0, result.runs.length ? '—' : 'Reference epic in a run'],
          ].map((row) => <tr key={String(row[0])}><td style={{ padding: '8px 4px', borderTop: '1px solid var(--border-soft)' }}><b>{row[0]}</b></td><td style={{ borderTop: '1px solid var(--border-soft)' }}>{row[1]}</td><td style={{ borderTop: '1px solid var(--border-soft)', textAlign: 'center', color: row[2] ? 'var(--accent-green)' : 'var(--accent-red)' }}>{row[2] ? 'READY' : 'GAP'}</td><td style={{ borderTop: '1px solid var(--border-soft)' }}>{row[3]}</td></tr>)}</tbody></table></div></section> : null}

          {tab === 'actions' ? <section className="card"><h3>Action center</h3>{actions.length ? <div style={{ display: 'grid', gap: 8 }}>{actions.map((action) => <div key={action.title} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 10, padding: 8, border: '1px solid var(--border-soft)', borderRadius: 7 }}><b style={{ color: action.severity === 'high' ? 'var(--accent-red)' : action.severity === 'medium' ? 'var(--accent-yellow)' : 'var(--accent-cyan)', textTransform: 'uppercase', fontSize: 10 }}>{action.severity}</b><div><b>{action.title}</b><div className="muted">{action.detail}</div></div></div>)}</div> : <p style={{ color: 'var(--accent-green)' }}>No readiness actions are currently required.</p>}</section> : null}

          {tab === 'impact' ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}><section className="card"><h3>Change impact</h3><p className="muted">A change to {epicKey} can affect these linked assets.</p>{compactList([
            ...(result.hierarchy.epic.linkedIssues ?? []).map((link) => ({ id: link.key, content: <><a href={`#/issue/${link.key}`} onClick={(event) => { event.preventDefault(); dialogs.openIssueDetails(link.key); }}>{link.key}</a> · {link.relationship} · {link.summary}</> })),
            ...result.pages.map((page) => ({ id: `p${page.id}`, content: <>Document: <a href={`#/confluence/${page.id}`}>{page.title}</a></> })),
            ...result.cases.map((testCase) => ({ id: `c${testCase.id}`, content: <>Test: C{testCase.id} — {testCase.title}</> })),
          ], 'No downstream assets were discovered.')}</section><section className="card"><h3>Watchlist & daily digest</h3>{watchlist.length ? compactList(watchlist.map((item) => ({ id: item.key, content: <><button className="btn" style={{ padding: '1px 6px', marginRight: 6 }} onClick={() => { setKey(item.key); void inspect(item.key); }}>Inspect</button><b>{item.key}</b> · {item.score}% · {item.status}<div className="muted">{item.cases} cases · {item.runs} runs · {item.pages} docs · checked {new Date(item.checkedAt).toLocaleString()}</div></> })), 'No watched epics.') : <p className="muted">Watch an epic to include it in your compact daily review.</p>}</section></div> : null}
        </div>
      ) : null}
    </div>
  );
}
