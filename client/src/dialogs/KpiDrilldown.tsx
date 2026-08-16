// KPI drill-down — clicking a dashboard KPI card opens this modal with the
// issues behind the number: issue lists for OpenIssues/Critical/OnHold/
// UpdatedToday (same JQL scopes as the snapshot counts), and per-issue +
// per-day logged-time breakdowns for LoggedToday/LoggedThisWeek.

import { useEffect, useState } from 'react';
import { issues as issuesApi, timelogged } from '../api/client';
import { Modal } from '../components/Modal';
import { priorityColor, statusColor } from '../lib/colors';
import { formatDateTime } from '../lib/format';
import {
  filterOnHold,
  formatHoursMinutes,
  kpiDrillJql,
  kpiDrillSubtitle,
} from '../lib/viewDashboard';
import { dialogs } from './DialogHost';
import type { DailyLogEntry, JiraIssue } from '../types';

export interface KpiDrilldownProps {
  kpiId: string;
  kpiTitle: string;
  project: string;
  /** Already-loaded sprint issues — the On Hold drill filters these locally. */
  sprintIssues: JiraIssue[];
  onClose: () => void;
}

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12.5,
  borderBottom: '1px solid var(--border-soft)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 10.5,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  position: 'sticky',
  top: 0,
  background: 'var(--bg-panel-high)',
};

function IssueKeyCell({ issueKey }: { issueKey: string }) {
  return (
    <span
      style={{ color: 'var(--accent-cyan)', fontWeight: 700, cursor: 'pointer' }}
      onClick={() => dialogs.openIssueDetails(issueKey)}
      title="Open issue details"
    >
      {issueKey}
    </span>
  );
}

/** Plain issue table: Key, Summary, Status, Priority, Updated (+Logged col). */
function IssueTable({ rows, loggedColumn }: { rows: JiraIssue[]; loggedColumn: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12.5, padding: '18px 4px' }}>
        Nothing here — no matching issues.
      </div>
    );
  }
  return (
    <div style={{ overflow: 'auto', maxHeight: '52vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 96 }} />
          <col />
          <col style={{ width: 130 }} />
          <col style={{ width: 92 }} />
          {loggedColumn ? <col style={{ width: 96 }} /> : <col style={{ width: 150 }} />}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...headStyle, textAlign: 'left' }}>Key</th>
            <th style={{ ...headStyle, textAlign: 'left' }}>Summary</th>
            <th style={{ ...headStyle, textAlign: 'left' }}>Status</th>
            <th style={{ ...headStyle, textAlign: 'left' }}>Priority</th>
            <th style={{ ...headStyle, textAlign: 'left' }}>{loggedColumn ? 'Logged' : 'Updated'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              style={{ cursor: 'pointer' }}
              onDoubleClick={() => dialogs.openIssueDetails(r.key)}
            >
              <td style={cellStyle}>
                <IssueKeyCell issueKey={r.key} />
              </td>
              <td style={cellStyle} title={r.summary}>
                {r.summary}
              </td>
              <td style={{ ...cellStyle, color: statusColor(r.status) }}>{r.status}</td>
              <td style={{ ...cellStyle, color: priorityColor(r.priority) }}>{r.priority}</td>
              <td style={cellStyle}>
                {loggedColumn ? (
                  <span style={{ color: 'var(--accent-green, #22d38f)', fontWeight: 600 }}>
                    {formatHoursMinutes(r.workLoggedForPeriod ?? 0)}
                  </span>
                ) : (
                  formatDateTime(r.updated)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Day-by-day breakdown for the Logged This Week drill. */
function DailyTable({ entries }: { entries: DailyLogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Per day</div>
      <div style={{ overflow: 'auto', maxHeight: '30vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 110 }} />
            <col style={{ width: 96 }} />
            <col />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...headStyle, textAlign: 'left' }}>Day</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Key</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Summary</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Logged</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.day}-${e.issueKey}`}>
                <td style={cellStyle}>{e.day}</td>
                <td style={cellStyle}>
                  <IssueKeyCell issueKey={e.issueKey} />
                </td>
                <td style={cellStyle} title={e.issueSummary}>
                  {e.issueSummary}
                </td>
                <td style={{ ...cellStyle, color: 'var(--accent-green, #22d38f)', fontWeight: 600 }}>
                  {formatHoursMinutes(e.timeSpent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function KpiDrilldown({ kpiId, kpiTitle, project, sprintIssues, onClose }: KpiDrilldownProps) {
  const [rows, setRows] = useState<JiraIssue[] | null>(null);
  const [daily, setDaily] = useState<DailyLogEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');

  const isLogged = kpiId === 'LoggedToday' || kpiId === 'LoggedThisWeek';

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setDaily([]);
    setTotal(null);
    setError('');

    const load = async () => {
      if (kpiId === 'OnHold') {
        setRows(filterOnHold(sprintIssues));
        return;
      }
      if (isLogged) {
        const report = await timelogged.report(kpiId === 'LoggedToday' ? 'today' : 'thisWeek');
        if (cancelled) return;
        setRows(report.issues.filter((i) => (i.workLoggedForPeriod ?? 0) > 0));
        setDaily(report.dailyByIssue);
        setTotal(report.total);
        return;
      }
      const jql = kpiDrillJql(kpiId, project);
      if (!jql) {
        setRows([]);
        return;
      }
      const page = await issuesApi.search(jql, 0, 100);
      if (cancelled) return;
      setRows(page.items);
    };

    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiId, project]);

  return (
    <Modal title={kpiTitle} width={860} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {kpiDrillSubtitle(kpiId)}
        </div>

        {error !== '' ? (
          <div style={{ color: 'var(--accent-red, #ef4444)', fontSize: 12.5 }}>✕ {error}</div>
        ) : rows === null ? (
          <div className="muted" style={{ fontSize: 12.5, padding: '18px 4px' }}>
            Loading…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {rows.length} issue{rows.length === 1 ? '' : 's'}
              </div>
              {total !== null ? (
                <div style={{ fontSize: 13 }}>
                  Total logged:{' '}
                  <span style={{ color: 'var(--accent-green, #22d38f)', fontWeight: 700 }}>
                    {formatHoursMinutes(total)}
                  </span>
                </div>
              ) : null}
              <div className="muted" style={{ fontSize: 11.5 }}>
                Double-click a row (or click the key) to open the issue.
              </div>
            </div>
            <IssueTable rows={rows} loggedColumn={isLogged} />
            {kpiId === 'LoggedThisWeek' ? <DailyTable entries={daily} /> : null}
          </>
        )}
      </div>
    </Modal>
  );
}
