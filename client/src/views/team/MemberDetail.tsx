// Team member detail modal (ui-parity-contract.md §9.2, 980 wide): stats
// (Features / Logged (h) / Remaining (h)), two charts (hours/day last 7 days
// stacked per issue; logged vs estimated per feature top-12), feature grid.
// Load: seed rows from passed issues (TimeSpent DESC), fetch worklogs in
// parallel (gate 8), filter to the member by normalized name, overwrite
// loggedHours with the member sum when > 0, sort LastLogged DESC.

import { useEffect, useMemo, useState } from 'react';
import { issues as issuesApi } from '../../api/client';
import { Bars } from '../../charts/Bars';
import { StackedBarsH } from '../../charts/StackedBarsH';
import { CHART_PALETTE } from '../../lib/colors';
import { DataGrid } from '../../components/DataGrid';
import type { GridColumn } from '../../components/DataGrid';
import { Modal } from '../../components/Modal';
import { priorityColor, statusColor } from '../../lib/colors';
import { formatDateTime } from '../../lib/format';
import { addDays, fmtHours, formatDayShort } from '../../lib/viewFormat';
import { mapWithConcurrency, matchesMember } from '../../lib/viewTeam';
import type { JiraIssue, JiraWorklog } from '../../types';

const WORKLOG_CONCURRENCY = 8;

interface FeatureRow {
  key: string;
  type: string;
  summary: string;
  status: string;
  priority: string;
  loggedHours: number;
  remainingHours: number;
  lastLogged: string | null;
}

export interface MemberDetailProps {
  member: string;
  issues: JiraIssue[];
  onClose: () => void;
}

export function MemberDetail({ member, issues, onClose }: MemberDetailProps) {
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [logsByIssue, setLogsByIssue] = useState<Map<string, JiraWorklog[]>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const featureCount = issues.length;
  const totalLogged = issues.reduce((s, i) => s + (i.timeSpent ?? 0) / 3600, 0);
  const totalRemaining = issues.reduce((s, i) => s + (i.remainingEstimate ?? 0) / 3600, 0);

  useEffect(() => {
    // Seed rows immediately from the passed issues, TimeSpent DESC.
    const seeded: FeatureRow[] = [...issues]
      .sort((a, b) => (b.timeSpent ?? 0) - (a.timeSpent ?? 0))
      .map((i) => ({
        key: i.key,
        type: i.issueType ?? '',
        summary: i.summary,
        status: i.status,
        priority: i.priority,
        loggedHours: (i.timeSpent ?? 0) / 3600,
        remainingHours: (i.remainingEstimate ?? 0) / 3600,
        lastLogged: null,
      }));
    setRows(seeded);

    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const results = await mapWithConcurrency(issues, WORKLOG_CONCURRENCY, async (issue) => {
          try {
            const logs = await issuesApi.worklogs(issue.key);
            return { key: issue.key, logs: logs.filter((w) => matchesMember(w.author, member)) };
          } catch {
            return { key: issue.key, logs: [] as JiraWorklog[] };
          }
        });
        if (cancelled) return;
        const map = new Map<string, JiraWorklog[]>();
        for (const r of results) map.set(r.key, r.logs);
        setLogsByIssue(map);
        setRows((prev) => {
          const next = prev.map((row) => {
            const logs = map.get(row.key) ?? [];
            const lastLogged = logs.reduce<string | null>(
              (max, w) => (max === null || w.started > max ? w.started : max),
              null,
            );
            const total = logs.reduce((s, w) => s + w.timeSpent, 0) / 3600;
            return {
              ...row,
              lastLogged,
              loggedHours: total > 0 ? total : row.loggedHours,
            };
          });
          next.sort((a, b) => (b.lastLogged ?? '').localeCompare(a.lastLogged ?? ''));
          return next;
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  // Chart 1 — hours per day (last 7 days), stacked per issue.
  const dailyChart = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const perIssue: Array<{ key: string; hours: number[] }> = [];
    for (const [key, logs] of logsByIssue) {
      if (logs.length === 0) continue;
      const hours = days.map((d) =>
        logs
          .filter((w) => {
            const started = new Date(w.started);
            return (
              started.getFullYear() === d.getFullYear() &&
              started.getMonth() === d.getMonth() &&
              started.getDate() === d.getDate()
            );
          })
          .reduce((s, w) => s + w.timeSpent / 3600, 0),
      );
      if (hours.reduce((a, b) => a + b, 0) > 0) perIssue.push({ key, hours });
    }
    return {
      series: perIssue.map((x, i) => ({ name: x.key, color: CHART_PALETTE[i % CHART_PALETTE.length] })),
      rows: days.map((d, di) => ({
        label: formatDayShort(d),
        values: perIssue.map((x) => x.hours[di]),
      })),
    };
  }, [logsByIssue]);

  // Chart 2 — logged vs estimated per feature, top-12 by est+logged.
  const featureChart = useMemo(() => {
    const data = issues.map((i) => {
      const logs = logsByIssue.get(i.key) ?? [];
      const logged = logs.reduce((s, w) => s + w.timeSpent, 0) / 3600;
      const estimated = (i.originalEstimate ?? 0) / 3600;
      return { key: i.key, logged, estimated };
    });
    data.sort((a, b) => b.estimated + b.logged - (a.estimated + a.logged));
    return data.slice(0, 12);
  }, [issues, logsByIssue]);

  const columns: GridColumn<FeatureRow>[] = useMemo(
    () => [
      {
        key: 'key',
        header: 'Key',
        width: 100,
        render: (r) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{r.key}</span>,
      },
      { key: 'type', header: 'Type', width: 90 },
      { key: 'summary', header: 'Summary', width: 300 },
      {
        key: 'status',
        header: 'Status',
        width: 120,
        render: (r) => <span style={{ color: statusColor(r.status) }}>{r.status}</span>,
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 90,
        render: (r) => <span style={{ color: priorityColor(r.priority) }}>{r.priority}</span>,
      },
      { key: 'loggedHours', header: 'Logged (h)', width: 90, format: (r) => fmtHours(r.loggedHours) },
      { key: 'remainingHours', header: 'Remaining (h)', width: 100, format: (r) => fmtHours(r.remainingHours) },
      {
        key: 'lastLogged',
        header: 'Last Logged',
        width: 140,
        format: (r) => (r.lastLogged ? formatDateTime(r.lastLogged) : ''),
      },
    ],
    [],
  );

  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 120 }}>
      <div className="muted" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );

  return (
    <Modal title={member} width={980} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {stat('Features', String(featureCount))}
          {stat('Logged (h)', fmtHours(totalLogged))}
          {stat('Remaining (h)', fmtHours(totalRemaining))}
          {busy ? <span className="accent-cyan">Loading worklogs…</span> : null}
        </div>
        {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card card-high" style={{ padding: 12 }}>
            <StackedBarsH
              title="Hours per day (last 7 days)"
              rows={dailyChart.rows}
              series={dailyChart.series}
              valueSuffix="h"
            />
          </div>
          <div className="card card-high" style={{ padding: 12 }}>
            <Bars
              title="Logged vs Estimated per feature (h)"
              height={220}
              groups={featureChart.map((f) => ({ label: f.key, values: [f.logged, f.estimated] }))}
              series={[
                { name: 'Logged', color: '#6366F1' },
                { name: 'Estimated', color: '#64748B' },
              ]}
              valueSuffix="h"
            />
          </div>
        </div>
        <DataGrid<FeatureRow>
          stateKey="TeamMemberDetail.Features"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          emptyText="No sprint issues for this member."
          maxHeight={320}
        />
      </div>
    </Modal>
  );
}
