// Jira → Time. Two views of the same period: by day, and by issue.
//
// "What did I log and when" is the question, so By day is the default — each
// day is a section, each row an entry with its issue and duration. By issue
// answers the other half, totalling per issue across the period. Log work is
// one tap from any row, because the point of this screen on a phone is filling
// gaps you noticed away from your desk.

import { useCallback, useMemo, useState } from 'react';
import { timelogged } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { statusColor } from '../../lib/colors';
import { formatTimeSpan } from '../../lib/format';
import type { DailyLogEntry, TimeLoggedReport } from '../../types';
import { invalidate, useCached } from '../cache';
import { Empty, ErrorNote, ListCard, Loading, Muted, Pill, Screen, Segmented, StatGrid, StatTile, tapReset } from '../ui';

type Period = 'today' | 'thisWeek' | 'previousWeek' | 'thisMonth';
type View = 'day' | 'issue';

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'previousWeek', label: 'Last week' },
  { value: 'thisMonth', label: 'Month' },
];

/** "2026-08-20" → "Thu 20 Aug", with today and yesterday named. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const today = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(today) - midnight(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function MobileTimeSpent() {
  const [period, setPeriod] = useState<Period>('thisWeek');
  const [view, setView] = useState<View>('day');

  const res = useCached<TimeLoggedReport>(`time:${period}`, () => timelogged.report(period), {
    ttlMs: 60_000,
  });

  const refresh = useCallback(() => {
    invalidate('time:');
    invalidate('dashboard:');
    res.refresh();
  }, [res]);

  const byDay = useMemo(() => {
    const entries = res.data?.dailyByIssue ?? [];
    const map = new Map<string, DailyLogEntry[]>();
    for (const e of entries) {
      if (e.timeSpent <= 0) continue;
      const list = map.get(e.day);
      if (list) list.push(e);
      else map.set(e.day, [e]);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, items]) => ({
        day,
        items: [...items].sort((a, b) => b.timeSpent - a.timeSpent),
        total: items.reduce((sum, i) => sum + i.timeSpent, 0),
      }));
  }, [res.data]);

  const logged = useMemo(
    () => (res.data?.issues ?? []).filter((i) => (i.timeSpent ?? 0) > 0).sort((a, b) => (b.timeSpent ?? 0) - (a.timeSpent ?? 0)),
    [res.data],
  );

  const days = byDay.length;

  return (
    <Screen
      kicker="Jira"
      title="Time Spent"
      action={
        <button className="btn" onClick={refresh} disabled={res.refreshing} style={{ ...tapReset, minHeight: 40 }}>
          {res.refreshing ? '…' : '↻'}
        </button>
      }
    >
      <Segmented value={period} options={PERIODS} onChange={setPeriod} />

      {res.error ? <ErrorNote onRetry={refresh}>{res.error}</ErrorNote> : null}
      {res.loading ? <Loading what="Loading time" /> : null}

      {res.data ? (
        <>
          <StatGrid>
            <StatTile label="Total logged" value={formatTimeSpan(res.data.total)} tone="var(--accent-green)" />
            <StatTile label="Issues" value={logged.length} />
            <StatTile label="Days with time" value={days} />
            <StatTile
              label="Daily average"
              value={days > 0 ? formatTimeSpan(Math.round(res.data.total / days)) : '0m'}
            />
          </StatGrid>

          <Segmented
            value={view}
            options={[
              { value: 'day', label: 'By day' },
              { value: 'issue', label: 'By issue' },
            ]}
            onChange={setView}
          />

          {view === 'day' ? (
            byDay.length === 0 ? (
              <Empty>No work logged in this period.</Empty>
            ) : (
              byDay.map(({ day, items, total }) => (
                <section key={day} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      padding: '6px 4px',
                      borderBottom: '1px solid var(--border-soft)',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontWeight: 650, fontSize: 13.5 }}>{dayLabel(day)}</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--accent-green)', fontSize: 13 }}>
                      {formatTimeSpan(total)}
                    </span>
                  </div>
                  {items.map((entry, i) => (
                    <ListCard
                      key={`${entry.issueKey}-${i}`}
                      onClick={() => dialogs.openIssueDetails(entry.issueKey)}
                      lead={
                        <>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 12,
                              color: 'var(--accent-cyan)',
                              fontWeight: 700,
                            }}
                          >
                            {entry.issueKey}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>
                            {formatTimeSpan(entry.timeSpent)}
                          </span>
                        </>
                      }
                      title={entry.issueSummary}
                    />
                  ))}
                </section>
              ))
            )
          ) : logged.length === 0 ? (
            <Empty>No work logged in this period.</Empty>
          ) : (
            logged.map((issue) => (
              <ListCard
                key={issue.key}
                accent={statusColor(issue.status)}
                onClick={() => dialogs.openIssueDetails(issue.key)}
                lead={
                  <>
                    <span
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}
                    >
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
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        dialogs.openLogWork(issue.key);
                      }}
                      style={{ ...tapReset, marginLeft: 'auto', minHeight: 34, padding: '0 12px', fontSize: 12 }}
                    >
                      Log work
                    </button>
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
