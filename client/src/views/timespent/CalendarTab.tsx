// Month calendar of logged work. Sprint-range days tinted, today highlighted.

import { useEffect, useMemo, useState } from 'react';
import { timelogged } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { errText } from '../../lib/errors';
import { ymd } from '../../lib/viewFormat';
import { activeSprintRange, buildCalendarMonth } from '../../lib/viewTimeSpentTabs';
import type { TimeLoggedReport } from '../../types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LINES = 2;

export function CalendarTab({ year, month, user }: { year: number; month: number; user: string }) {
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const from = ymd(new Date(year, month, 1));
    const to = ymd(new Date(year, month + 1, 1));
    setBusy(true);
    setError(null);
    timelogged
      .range(from, to, user.trim() || undefined)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(errText(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [year, month, user, refreshTick]);

  const summaryByKey = useMemo(() => new Map((report?.issues ?? []).map((i) => [i.key, i.summary])), [report]);
  const sprint = useMemo(() => activeSprintRange(report?.issues ?? []), [report]);
  const cal = useMemo(
    () => buildCalendarMonth(year, month, report?.dailyByIssue ?? [], sprint, new Date()),
    [year, month, report, sprint],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{cal.monthLabel}</div>
        {busy ? <span className="accent-cyan">…</span> : null}
        {sprint ? (
          <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
            Sprint {sprint.name}: {sprint.start} → {sprint.end}
          </span>
        ) : null}
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      <div className="card" style={{ padding: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, width: '100%' }}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="muted" style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px' }}>{d}</div>
          ))}
          {cal.weeks.flat().map((cell) => (
            <div
              key={cell.day}
              style={{
                minHeight: 100,
                minWidth: 0,
                overflow: 'hidden',
                borderRadius: 6,
                padding: '4px 6px',
                border: cell.isToday ? '2px solid var(--accent-green)' : '1px solid var(--border-soft)',
                background: cell.inSprint ? 'color-mix(in srgb, var(--accent-cyan) 9%, transparent)' : undefined,
                opacity: cell.inMonth ? 1 : 0.4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700 }}>{cell.dayNumber}</div>
              {cell.entries.slice(0, MAX_LINES).map((e) => (
                <button
                  key={e.issueKey}
                  type="button"
                  onClick={() => dialogs.openLogWork(e.issueKey, { onLogged: () => setRefreshTick((t) => t + 1) })}
                  title={`${e.issueKey} — ${summaryByKey.get(e.issueKey) ?? ''}`}
                  style={{ display: 'block', width: '100%', maxWidth: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--accent-cyan)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {e.issueKey}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600, flexShrink: 0 }}>{e.hours.toFixed(1)}h</span>
                  </div>
                  <div
                    className="muted"
                    style={{ fontSize: 10.5, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {summaryByKey.get(e.issueKey) ?? ''}
                  </div>
                </button>
              ))}
              {cell.entries.length > MAX_LINES ? (
                <div className="muted" style={{ fontSize: 10.5 }}>+{cell.entries.length - MAX_LINES} more</div>
              ) : null}
              {cell.totalHours > 0 ? (
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent-green)' }}>Total: {cell.totalHours.toFixed(1)}h</div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 10.5, padding: '6px 4px 0' }}>
          ▦ tinted = current sprint · outlined = today
        </div>
      </div>
    </div>
  );
}
