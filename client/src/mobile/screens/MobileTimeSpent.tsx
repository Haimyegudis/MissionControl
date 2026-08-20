// Time Spent. Period picker, one total, then the issues that carry the time.
//
// The desktop screen also renders a seven-column weekly timesheet grid. That
// grid is 756px wide by construction — it cannot be made to fit, and the
// question it answers ("which day did this go on?") is a desktop question. On
// a phone the useful questions are "how much this period" and "on what", so
// the period total and a per-issue breakdown are what ship.

import { useCallback, useEffect, useState } from 'react';
import { timelogged } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { statusColor } from '../../lib/colors';
import { formatTimeSpan } from '../../lib/format';
import type { TimeLoggedReport } from '../../types';
import { Empty, ErrorNote, ListCard, Loading, Muted, Pill, Screen, Segmented, StatGrid, StatTile, tapReset } from '../ui';

type Period = 'today' | 'yesterday' | 'thisWeek' | 'previousWeek' | 'thisMonth';

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'thisWeek', label: 'Week' },
  { value: 'thisMonth', label: 'Month' },
];

export function MobileTimeSpent() {
  const [period, setPeriod] = useState<Period>('thisWeek');
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p: Period) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await timelogged.report(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const issues = report?.issues ?? [];
  const logged = issues.filter((i) => (i.timeSpent ?? 0) > 0);

  return (
    <Screen
      kicker="Jira"
      title="Time Spent"
      action={
        <button className="btn" onClick={() => void load(period)} disabled={busy} style={{ ...tapReset, minHeight: 40 }}>
          {busy ? '…' : '↻'}
        </button>
      }
    >
      <Segmented value={period} options={PERIODS} onChange={setPeriod} />

      {error ? <ErrorNote onRetry={() => void load(period)}>{error}</ErrorNote> : null}
      {!report && !error ? <Loading what="Loading time" /> : null}

      {report ? (
        <>
          <StatGrid>
            <StatTile label="Total logged" value={formatTimeSpan(report.total)} tone="var(--accent-green)" />
            <StatTile label="Issues touched" value={logged.length} />
          </StatGrid>

          <div
            style={{
              fontSize: 10.5,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              margin: '4px 2px 8px',
            }}
          >
            Where the time went
          </div>

          {logged.length === 0 ? (
            <Empty>No work logged in this period.</Empty>
          ) : (
            [...logged]
              .sort((a, b) => (b.timeSpent ?? 0) - (a.timeSpent ?? 0))
              .map((issue) => (
                <ListCard
                  key={issue.key}
                  accent={statusColor(issue.status)}
                  onClick={() => dialogs.openIssueDetails(issue.key)}
                  lead={
                    <>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                        {issue.key}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>
                        {formatTimeSpan(issue.timeSpent ?? 0)}
                      </span>
                    </>
                  }
                  title={issue.summary}
                  footer={
                    <>
                      <Pill tone={statusColor(issue.status)}>{issue.status}</Pill>
                      {issue.sprint ? <Muted>{issue.sprint}</Muted> : null}
                    </>
                  }
                />
              ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
