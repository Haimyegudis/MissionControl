// Jira → Dashboard. KPI tiles over my work grouped by status.
//
// The list is grouped rather than flat because the first question on a phone
// is "what is in progress / what is waiting on review", not "what changed most
// recently". Each card opens the issue and offers Log work directly, since
// logging time is the most common thing to do away from a desk.

import { useCallback } from 'react';
import { dashboard as dashboardApi, issues as issuesApi } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { priorityColor, statusColor } from '../../lib/colors';
import { formatTimeSpan } from '../../lib/format';
import { formatSprintLine, resolveActiveSprint } from '../../lib/viewDashboard';
import type { DashboardSnapshot, JiraIssue, PagedResult } from '../../types';
import { useCached } from '../cache';
import { groupByStatus, StatusSection } from '../statusGroups';
import { Empty, ErrorNote, ListCard, Loading, Muted, Pill, Screen, StatGrid, StatTile, tapReset } from '../ui';

/**
 * My work. Unresolved issues plus anything finished recently, so the Done
 * column reflects what was actually completed rather than staying empty.
 */
const MY_WORK_JQL =
  'assignee = currentUser() AND (resolution = Unresolved OR resolutiondate >= -14d) ' +
  'ORDER BY updated DESC';

export function MobileDashboard() {
  const snap = useCached<DashboardSnapshot>('dashboard:snapshot', () => dashboardApi.snapshot(), {
    ttlMs: 60_000,
  });
  const mine = useCached<PagedResult<JiraIssue>>(
    'dashboard:mywork',
    () => issuesApi.search(MY_WORK_JQL, 0, 100),
    { ttlMs: 60_000 },
  );

  const refresh = useCallback(() => {
    snap.refresh();
    mine.refresh();
  }, [snap, mine]);

  const busy = snap.refreshing || mine.refreshing;
  // To Do is sprint-only: the backlog would otherwise bury the planned work.
  const groups = groupByStatus(mine.data?.items ?? [], { toDoSprintOnly: true });
  const sprintLine = formatSprintLine(resolveActiveSprint(mine.data?.items ?? []));

  return (
    <Screen
      kicker="Jira"
      title="Dashboard"
      action={
        <>
          <button
            className="btn btn-primary"
            onClick={() => dialogs.openCreateIssue()}
            style={{ ...tapReset, minHeight: 40, padding: '0 12px' }}
          >
            + Incident
          </button>
          <button className="btn" onClick={refresh} disabled={busy} style={{ ...tapReset, minHeight: 40 }}>
            {busy ? '…' : '↻'}
          </button>
        </>
      }
    >
      {snap.error ? <ErrorNote onRetry={refresh}>{snap.error}</ErrorNote> : null}

      {sprintLine ? (
        <div style={{ margin: '0 2px 10px' }}>
          <Muted>{sprintLine}</Muted>
        </div>
      ) : null}

      {snap.data ? (
        <StatGrid>
          <StatTile label="Open issues" value={snap.data.openIssues} />
          <StatTile
            label="Critical incidents"
            value={snap.data.criticalIncidents}
            tone={snap.data.criticalIncidents > 0 ? 'var(--accent-red)' : undefined}
          />
          <StatTile
            label="Blocked"
            value={snap.data.blocked}
            tone={snap.data.blocked > 0 ? 'var(--accent-orange)' : undefined}
          />
          <StatTile label="Updated today" value={snap.data.updatedToday} />
          <StatTile label="Logged today" value={formatTimeSpan(snap.data.timeLoggedToday)} tone="var(--accent-green)" />
          <StatTile
            label="Logged this week"
            value={formatTimeSpan(snap.data.timeLoggedThisWeek)}
            tone="var(--accent-green)"
          />
        </StatGrid>
      ) : snap.loading ? (
        <Loading what="Loading dashboard" />
      ) : null}

      <div
        style={{
          fontSize: 10.5,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          margin: '6px 2px 8px',
        }}
      >
        My work by status
      </div>

      {mine.error ? <ErrorNote onRetry={() => mine.refresh()}>{mine.error}</ErrorNote> : null}
      {mine.loading ? <Loading what="Loading issues" /> : null}
      {mine.data && groups.length === 0 ? <Empty>Nothing assigned to you is open.</Empty> : null}

      {groups.map(({ group, issues }) => (
        <StatusSection key={group} group={group} count={issues.length}>
          {issues.map((issue) => (
            <IssueCard key={issue.key} issue={issue} onChanged={refresh} />
          ))}
        </StatusSection>
      ))}
    </Screen>
  );
}

export function IssueCard({ issue, onChanged }: { issue: JiraIssue; onChanged?: () => void }) {
  return (
    <ListCard
      accent={statusColor(issue.status)}
      onClick={() => dialogs.openIssueDetails(issue.key)}
      lead={
        <>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
            {issue.key}
          </span>
          <Muted>{issue.issueType}</Muted>
          {(issue.timeSpent ?? 0) > 0 ? (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent-green)', fontWeight: 600 }}>
              {formatTimeSpan(issue.timeSpent ?? 0)}
            </span>
          ) : null}
        </>
      }
      title={issue.summary}
      footer={
        <>
          <Pill tone={statusColor(issue.status)}>{issue.status}</Pill>
          {issue.priority ? <Pill tone={priorityColor(issue.priority)}>{issue.priority}</Pill> : null}
          {issue.sprint ? <Muted>{issue.sprint}</Muted> : null}
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation(); // logging work is not opening the issue
              dialogs.openLogWork(issue.key);
              onChanged?.();
            }}
            style={{ ...tapReset, marginLeft: 'auto', minHeight: 34, padding: '0 12px', fontSize: 12 }}
          >
            Log work
          </button>
        </>
      }
    />
  );
}
