// Work logged in the last X days, grouped by epic (reference: "Features Log").

import { useEffect, useMemo, useState } from 'react';
import { timelogged } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { errText } from '../../lib/errors';
import { formatTimeSpan } from '../../lib/format';
import { addDays, ymd } from '../../lib/viewFormat';
import { formatEpicTotal, groupByEpic } from '../../lib/viewTimeSpentTabs';
import type { TimeLoggedReport } from '../../types';

export function EpicsTab({ user }: { user: string }) {
  const [daysBack, setDaysBack] = useState(30);
  const [daysDraft, setDaysDraft] = useState('30');
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const clamped = Math.min(365, Math.max(1, daysBack));
    const to = new Date();
    const from = addDays(to, -clamped);
    setBusy(true);
    setError(null);
    timelogged
      .range(ymd(from), ymd(addDays(to, 1)), user.trim() || undefined)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(errText(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [daysBack, user]);

  const groups = useMemo(() => groupByEpic(report?.issues ?? []), [report]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12.5 }}>Days to look back:</label>
        <input
          type="number"
          min={1}
          max={365}
          value={daysDraft}
          onChange={(e) => setDaysDraft(e.target.value)}
          onBlur={() => {
            const n = Number(daysDraft);
            if (Number.isFinite(n) && n >= 1) {
              const clamped = Math.min(365, Math.round(n));
              setDaysBack(clamped);
              setDaysDraft(String(clamped));
            } else {
              setDaysDraft(String(daysBack));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = Number(daysDraft);
              if (Number.isFinite(n) && n >= 1) {
                const clamped = Math.min(365, Math.round(n));
                setDaysBack(clamped);
                setDaysDraft(String(clamped));
              } else {
                setDaysDraft(String(daysBack));
              }
              e.currentTarget.blur();
            }
          }}
          style={{ width: 70 }}
        />
        {busy ? <span className="accent-cyan">…</span> : null}
        <span className="muted" style={{ fontSize: 11.5 }}>
          {groups.length} epic group(s) with logged time
        </span>
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      {groups.length === 0 && !busy ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No work logged in this window.</div>
      ) : (
        groups.map((g) => (
          <div key={g.epicKey ?? 'none'} className="card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{g.epicName}</span>
              {g.epicKey ? (
                <button
                  type="button"
                  onClick={() => dialogs.openIssueDetails(g.epicKey!)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                >
                  {g.epicKey}
                </button>
              ) : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {g.issues.map((i) => (
                <div key={i.key} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
                  <button
                    type="button"
                    onClick={() => dialogs.openIssueDetails(i.key)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  >
                    {i.key}
                  </button>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent-green)', whiteSpace: 'nowrap' }}>{formatTimeSpan(i.seconds)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--accent-green)' }}>
              Total Logged Time: {formatEpicTotal(g.totalSeconds)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
