// TestRail panel inside the Jira issue dialog — Jira-plugin-style overview:
// donut chart of result statuses across the linked runs, per-run rows with
// progress and a "Run tests" action, the linked cases (deep-link into the
// Case Library) and one-click run creation from those cases per suite.

import { useMemo, useState } from 'react';
import { trApi } from '../api/testrail';
import { navigateTestRailRun } from '../router';
import { openCase, selectProject, trStore } from '../stores/testrail';
import { pushToast } from '../stores/toasts';
import type { TrRun } from '../testrailTypes';

export interface LinkedCase {
  id: number;
  title: string;
  suiteId: number;
  suiteName: string;
  projectId: number;
}

const STATUS_COLORS: Array<{ key: 'passed' | 'failed' | 'blocked' | 'retest' | 'untested'; label: string; color: string }> = [
  { key: 'passed', label: 'Passed', color: '#22d38f' },
  { key: 'failed', label: 'Failed', color: '#e5484d' },
  { key: 'blocked', label: 'Blocked', color: '#e8890c' },
  { key: 'retest', label: 'Retest', color: '#ffd23a' },
  { key: 'untested', label: 'Untested', color: '#8aa0bf' },
];

interface Totals {
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  untested: number;
}

function runTotals(runs: TrRun[]): Totals {
  const t: Totals = { passed: 0, failed: 0, blocked: 0, retest: 0, untested: 0 };
  for (const r of runs) {
    t.passed += r.passedCount;
    t.failed += r.failedCount;
    t.blocked += r.blockedCount;
    t.retest += r.retestCount;
    t.untested += r.untestedCount;
  }
  return t;
}

/** SVG donut — segments per status, count in the middle. */
function Donut({ totals, size = 96 }: { totals: Totals; size?: number }) {
  const total = STATUS_COLORS.reduce((s, c) => s + totals[c.key], 0);
  const r = size / 2 - 8;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={12} />
      {total > 0
        ? STATUS_COLORS.map((s) => {
            const frac = totals[s.key] / total;
            if (frac === 0) return null;
            const dash = frac * circumference;
            const el = (
              <circle
                key={s.key}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={12}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cx})`}
              />
            );
            offset += dash;
            return el;
          })
        : null}
      <text
        x={cx}
        y={cx + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fill: 'var(--text-primary)', fontSize: 17, fontWeight: 700 }}
      >
        {total}
      </text>
      <text
        x={cx}
        y={cx + 17}
        textAnchor="middle"
        style={{ fill: 'var(--muted)', fontSize: 8.5, letterSpacing: '0.08em' }}
      >
        TESTS
      </text>
    </svg>
  );
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
}

export function IssueTestRailPanel({
  issueKey,
  issueSummary,
  runs,
  cases,
  onNavigate,
}: {
  issueKey: string;
  issueSummary: string;
  runs: TrRun[];
  cases: LinkedCase[];
  /** Close the issue dialog before jumping into a TestRail view. */
  onNavigate: () => void;
}) {
  const [busySuite, setBusySuite] = useState<number | null>(null);
  const [showAllCases, setShowAllCases] = useState(false);

  const totals = useMemo(() => runTotals(runs), [runs]);
  const grandTotal = STATUS_COLORS.reduce((s, c) => s + totals[c.key], 0);

  // Linked cases grouped per suite — run creation targets one suite.
  const suiteGroups = useMemo(() => {
    const map = new Map<number, { projectId: number; suiteId: number; suiteName: string; caseIds: number[] }>();
    for (const c of cases) {
      const g = map.get(c.suiteId) ?? { projectId: c.projectId, suiteId: c.suiteId, suiteName: c.suiteName, caseIds: [] };
      g.caseIds.push(c.id);
      map.set(c.suiteId, g);
    }
    return [...map.values()].sort((a, b) => b.caseIds.length - a.caseIds.length);
  }, [cases]);

  const openLinkedCase = (c: LinkedCase) => {
    onNavigate();
    window.location.hash = '#/testrail/cases';
    void (async () => {
      if (trStore.get().projectId !== c.projectId) await selectProject(c.projectId);
      openCase(c.id, c.suiteId);
    })();
  };

  const createRun = async (group: { projectId: number; suiteId: number; suiteName: string; caseIds: number[] }) => {
    setBusySuite(group.suiteId);
    try {
      const me = trStore.get().session?.user?.id ?? null;
      const run = await trApi.addRun(group.projectId, {
        suiteId: group.suiteId,
        name: `${issueKey} — ${issueSummary}`.slice(0, 200),
        description: `Created from Mission Control for ${issueKey}`,
        refs: issueKey,
        assignedToId: me,
        includeAll: false,
        caseIds: group.caseIds,
      });
      pushToast({ title: 'TestRail', body: `Run created — ${group.caseIds.length} cases.` });
      onNavigate();
      navigateTestRailRun(run.id);
    } catch (err) {
      pushToast({ title: 'Run creation failed', body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusySuite(null);
    }
  };

  const visibleCases = showAllCases ? cases : cases.slice(0, 8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Chart + legend */}
      {runs.length > 0 ? (
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <Donut totals={totals} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {STATUS_COLORS.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ width: 64 }}>{s.label}</span>
                <b>{totals[s.key]}</b>
                <span className="muted">{pct(totals[s.key], grandTotal)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12.5 }}>
          No runs reference {issueKey} yet — create one from the linked cases below.
        </div>
      )}

      {/* Runs with progress + run action */}
      {runs.map((r) => {
        const total = r.passedCount + r.failedCount + r.blockedCount + r.retestCount + r.untestedCount;
        const done = total - r.untestedCount;
        return (
          <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
            <a
              href={`#/testrail/run/${r.id}`}
              onClick={(e) => {
                e.preventDefault();
                onNavigate();
                navigateTestRailRun(r.id);
              }}
              style={{
                color: 'var(--accent-cyan)',
                textDecoration: 'underline',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.name}
            </a>
            {/* stacked mini bar */}
            <span style={{ display: 'flex', width: 90, height: 8, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: 'var(--border-soft)' }}>
              {total > 0
                ? STATUS_COLORS.map((s) => {
                    const v =
                      s.key === 'passed' ? r.passedCount : s.key === 'failed' ? r.failedCount : s.key === 'blocked' ? r.blockedCount : s.key === 'retest' ? r.retestCount : r.untestedCount;
                    return v > 0 ? <span key={s.key} style={{ flex: v, background: s.color }} /> : null;
                  })
                : null}
            </span>
            <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>
              {done}/{total}
            </span>
            {!r.isCompleted && r.untestedCount > 0 ? (
              <button
                className="btn"
                style={{ padding: '2px 10px', fontSize: 11.5, color: 'var(--accent-green)', borderColor: 'var(--accent-green)' }}
                title={`${r.untestedCount} tests still to run — open and execute`}
                onClick={() => {
                  onNavigate();
                  navigateTestRailRun(r.id);
                }}
              >
                ▶ Run {r.untestedCount}
              </button>
            ) : null}
          </div>
        );
      })}

      {/* Create run from the linked cases */}
      {suiteGroups.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            New run from linked cases:
          </span>
          {suiteGroups.map((g) => (
            <button
              key={g.suiteId}
              className="btn"
              disabled={busySuite !== null}
              style={{ padding: '2px 10px', fontSize: 11.5 }}
              title={`Create a TestRail run in suite "${g.suiteName}" with these ${g.caseIds.length} cases, assigned to you`}
              onClick={() => void createRun(g)}
            >
              {busySuite === g.suiteId ? '…' : `▶ ${g.suiteName} (${g.caseIds.length})`}
            </button>
          ))}
        </div>
      ) : null}

      {/* Linked cases */}
      {cases.length > 0 ? (
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            Linked cases ({cases.length})
          </div>
          {visibleCases.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0', fontSize: 12.5 }}>
              <a
                href="#/testrail/cases"
                onClick={(e) => {
                  e.preventDefault();
                  openLinkedCase(c);
                }}
                style={{
                  color: 'var(--accent-cyan)',
                  textDecoration: 'underline',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                C{c.id} — {c.title}
              </a>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {c.suiteName}
              </span>
            </div>
          ))}
          {cases.length > 8 ? (
            <button className="btn" style={{ padding: '2px 10px', fontSize: 11.5, marginTop: 4 }} onClick={() => setShowAllCases((v) => !v)}>
              {showAllCases ? 'Show less' : `Show all ${cases.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
