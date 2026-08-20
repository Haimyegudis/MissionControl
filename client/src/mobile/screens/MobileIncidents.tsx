// Jira → Incidents, grouped by status.
//
// The desktop screen stacks three paged tables (open / verification /
// rejected) under a row of dropdowns. On a phone the bucket is chosen with a
// tab strip and, within it, incidents are grouped by status — the same
// question the Dashboard answers, because "which of these is actually moving"
// is what you want to know while away from a desk.

import { useCallback } from 'react';
import { incidents as incidentsApi } from '../../api/client';
import type { JiraIssue } from '../../types';
import { useCached } from '../cache';
import { groupByStatus, StatusSection } from '../statusGroups';
import { Empty, ErrorNote, Loading, Screen, Segmented, tapReset } from '../ui';
import { IssueCard } from './MobileDashboard';
import { useState } from 'react';

type Bucket = 'all' | 'verification' | 'rejected';

interface Buckets {
  all: JiraIssue[];
  verification: JiraIssue[];
  rejected: JiraIssue[];
}

export function MobileIncidents() {
  const [bucket, setBucket] = useState<Bucket>('all');

  // One request serves all three buckets, so switching tabs is instant.
  const res = useCached<Buckets>('incidents:all', () => incidentsApi.search([], null), { ttlMs: 120_000 });

  const refresh = useCallback(() => res.refresh(), [res]);
  const rows = res.data ? res.data[bucket] : [];
  const groups = groupByStatus(rows);

  return (
    <Screen
      kicker="Jira"
      title="Incidents"
      action={
        <button className="btn" onClick={refresh} disabled={res.refreshing} style={{ ...tapReset, minHeight: 40 }}>
          {res.refreshing ? '…' : '↻'}
        </button>
      }
    >
      <Segmented
        value={bucket}
        options={[
          { value: 'all', label: res.data ? `Open ${res.data.all.length}` : 'Open' },
          { value: 'verification', label: res.data ? `Verify ${res.data.verification.length}` : 'Verify' },
          { value: 'rejected', label: res.data ? `Rejected ${res.data.rejected.length}` : 'Rejected' },
        ]}
        onChange={setBucket}
      />

      {res.error ? <ErrorNote onRetry={refresh}>{res.error}</ErrorNote> : null}
      {res.loading ? <Loading what="Loading incidents" /> : null}
      {res.data && rows.length === 0 ? <Empty>No incidents in this bucket.</Empty> : null}

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
