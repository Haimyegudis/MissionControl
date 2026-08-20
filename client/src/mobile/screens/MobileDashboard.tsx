// Home. Six KPI tiles over the recently-updated list.
//
// The desktop Dashboard also carries a Kanban board and several charts; on a
// phone those are a swipe-fest that answers no question you actually have on a
// phone. What survives is: how bad is it right now, and what just changed.

import { useCallback, useEffect, useState } from 'react';
import { dashboard as dashboardApi } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { priorityColor, statusColor } from '../../lib/colors';
import { formatTimeSpan } from '../../lib/format';
import type { DashboardSnapshot } from '../../types';
import { Empty, ErrorNote, ListCard, Loading, Muted, Pill, Screen, StatGrid, StatTile, tapReset } from '../ui';

export function MobileDashboard() {
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSnap(await dashboardApi.snapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen
      kicker="Jira"
      title="Dashboard"
      action={
        <button className="btn" onClick={() => void load()} disabled={busy} style={{ ...tapReset, minHeight: 40 }}>
          {busy ? '…' : '↻'}
        </button>
      }
    >
      {error ? <ErrorNote onRetry={() => void load()}>{error}</ErrorNote> : null}
      {!snap && !error ? <Loading what="Loading dashboard" /> : null}

      {snap ? (
        <>
          <StatGrid>
            <StatTile label="Open issues" value={snap.openIssues} />
            <StatTile
              label="Critical incidents"
              value={snap.criticalIncidents}
              tone={snap.criticalIncidents > 0 ? 'var(--accent-red)' : undefined}
            />
            <StatTile
              label="Blocked"
              value={snap.blocked}
              tone={snap.blocked > 0 ? 'var(--accent-orange)' : undefined}
            />
            <StatTile label="Updated today" value={snap.updatedToday} />
            <StatTile label="Logged today" value={formatTimeSpan(snap.timeLoggedToday)} tone="var(--accent-green)" />
            <StatTile label="Logged this week" value={formatTimeSpan(snap.timeLoggedThisWeek)} tone="var(--accent-green)" />
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
            Recently updated
          </div>

          {snap.recentlyUpdated.length === 0 ? (
            <Empty>Nothing has changed recently.</Empty>
          ) : (
            snap.recentlyUpdated.map((issue) => (
              <ListCard
                key={issue.key}
                accent={statusColor(issue.status)}
                onClick={() => dialogs.openIssueDetails(issue.key)}
                lead={
                  <>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                      {issue.key}
                    </span>
                    <Muted>{issue.issueType}</Muted>
                  </>
                }
                title={issue.summary}
                footer={
                  <>
                    <Pill tone={statusColor(issue.status)}>{issue.status}</Pill>
                    {issue.priority ? <Pill tone={priorityColor(issue.priority)}>{issue.priority}</Pill> : null}
                    {issue.assignee ? <Muted>{issue.assignee}</Muted> : null}
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
