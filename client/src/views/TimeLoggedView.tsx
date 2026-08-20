// Time Spent view — redesigned for at-a-glance clarity, zero duplication:
//   · period chips + user picker + ONE export menu (CSV / PDF)
//   · hero strip: total logged for the period + logged-hours-per-STATUS chips
//     (every task's state visible instantly)
//   · one issues panel: status pill, bold logged-this-period, and an inline
//     Estimated↔Logged progress bar per row (replaces the old separate
//     "Logged vs Estimated" chart) + per-row Log work button (replaces the
//     old select-then-expander flow)
//   · weekly timesheet (unique per-day × per-issue) + 13-week heatmap
// The old sprint-per-day chart duplicated timesheet+heatmap and is gone.
// Refresh: session change ONLY — no scheduler tick.

import { useEffect, useMemo, useRef, useState } from 'react';
import { metadata as metadataApi, timelogged as timeloggedApi } from '../api/client';
import { Heatmap } from '../charts/Heatmap';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import type { GridColumn } from '../components/DataGrid';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { statusColor } from '../lib/colors';
import { buildCsv, downloadCsv } from '../lib/csv';
import { errText } from '../lib/errors';
import { formatTimeSpan } from '../lib/format';
import { addDays, formatDMmmYy, hoursDisplay, startOfWeekSunday, ymd } from '../lib/viewFormat';
import {
  ISSUES_CSV_HEADERS,
  aggregateDailyHours,
  buildTimesheet,
  dailyCsvRows,
  issuesCsvRow,
  timesheetHeaders,
} from '../lib/viewTimeLogged';
import { sessionStore } from '../stores/session';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { JiraIssue, TimeLoggedReport } from '../types';

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'previousWeek', label: 'Last week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'customRange', label: 'Custom…' },
] as const;

type PeriodId = (typeof PERIODS)[number]['id'];

/** Hours logged per status across the period — the hero strip's chips. */
export function loggedByStatus(issues: JiraIssue[]): Array<{ status: string; seconds: number; count: number }> {
  const map = new Map<string, { seconds: number; count: number }>();
  for (const i of issues) {
    const status = i.status || '—';
    const entry = map.get(status) ?? { seconds: 0, count: 0 };
    entry.seconds += i.workLoggedForPeriod ?? 0;
    entry.count += 1;
    map.set(status, entry);
  }
  return [...map.entries()]
    .map(([status, v]) => ({ status, ...v }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Inline Estimated↔Logged bar: green fill while under, red overflow beyond. */
function EstBar({ issue }: { issue: JiraIssue }) {
  const est = issue.originalEstimate ?? 0;
  const logged = issue.timeSpent ?? 0;
  if (est <= 0 && logged <= 0) return <span className="muted">—</span>;
  const scale = Math.max(est, logged, 1);
  const estPct = (est / scale) * 100;
  const underPct = (Math.min(logged, est) / scale) * 100;
  const overPct = logged > est ? ((logged - est) / scale) * 100 : 0;
  return (
    <div
      title={`Estimated ${formatTimeSpan(est)} · Logged ${formatTimeSpan(logged)}${logged > est ? ' — OVER estimate' : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <div style={{ position: 'relative', flex: 1, height: 10, borderRadius: 5, background: 'var(--border-soft)', overflow: 'hidden' }}>
        {est > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${estPct}%`,
              borderRight: '2px solid var(--border-strong)',
            }}
          />
        ) : null}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${underPct}%`, background: 'var(--accent-green)', opacity: 0.85 }} />
        {overPct > 0 ? (
          <div style={{ position: 'absolute', left: `${underPct}%`, top: 0, bottom: 0, width: `${overPct}%`, background: 'var(--accent-red)' }} />
        ) : null}
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: logged > est ? 'var(--accent-red)' : 'var(--muted)' }}>
        {est > 0 ? `${Math.round((logged / est) * 100)}%` : '—'}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  const color = statusColor(status);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 9px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >
      {status ?? '—'}
    </span>
  );
}

export function TimeLoggedView() {
  const session = useStore(sessionStore);
  const connected = session.phase === 'connected';

  const [period, setPeriod] = useState<PeriodId>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [users, setUsers] = useState<string[]>([]);
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [heatmapHours, setHeatmapHours] = useState<Record<string, number>>({});
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekSunday(new Date()));
  const [weekReport, setWeekReport] = useState<TimeLoggedReport | null>(null);

  const loadSeq = useRef(0);

  const loadHeatmap = async () => {
    try {
      const today = new Date();
      const r = await timeloggedApi.range(ymd(addDays(today, -91)), ymd(addDays(today, 1)));
      setHeatmapHours(aggregateDailyHours(r.dailyByIssue));
    } catch (err) {
      pushToast({ title: 'Heatmap unavailable', body: errText(err), severity: 'error' });
    }
  };

  const loadTimesheet = async (start: Date) => {
    try {
      setWeekReport(await timeloggedApi.range(ymd(start), ymd(addDays(start, 7))));
    } catch (err) {
      pushToast({ title: 'Timesheet unavailable', body: errText(err), severity: 'error' });
    }
  };

  const load = async () => {
    if (sessionStore.get().phase !== 'connected') return;
    if (period === 'customRange' && (!customFrom || !customTo)) return;
    const seq = ++loadSeq.current;
    setBusy(true);
    setError(null);
    try {
      const opts: { from?: string; to?: string; user?: string } = {};
      if (period === 'customRange') {
        opts.from = customFrom;
        opts.to = customTo;
      }
      if (userFilter.trim()) opts.user = userFilter;
      const r = await timeloggedApi.report(period, opts);
      if (seq !== loadSeq.current) return;
      setReport(r);

      const roster = new Set<string>();
      for (const i of r.issues) {
        if (i.assignee?.trim()) roster.add(i.assignee);
      }
      try {
        const project = sessionStore.get().profile?.defaultProjectKey || 'ISW';
        for (const u of await metadataApi.distinct(project, 'assignee', 2000)) roster.add(u);
      } catch {
        /* best-effort roster */
      }
      if (seq !== loadSeq.current) return;
      setUsers([...roster].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));

      void loadHeatmap();
      void loadTimesheet(weekStart);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(errText(err));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (connected) void loadRef.current();
  }, [connected, period, customFrom, customTo, userFilter]);

  const changeWeek = (start: Date) => {
    setWeekStart(start);
    void loadTimesheet(start);
  };

  const timesheet = useMemo(
    () => (weekReport ? buildTimesheet(weekStart, weekReport) : null),
    [weekReport, weekStart],
  );
  const weekHeaders = useMemo(() => timesheetHeaders(weekStart), [weekStart]);
  const statusChips = useMemo(() => loggedByStatus(report?.issues ?? []), [report]);
  const loggedIssues = useMemo(
    () => (report?.issues ?? []).filter((i) => (i.workLoggedForPeriod ?? 0) > 0).length,
    [report],
  );

  const exportCsv = () => {
    if (!report) return;
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stem = `timespent-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      downloadCsv(
        `${stem}-issues.csv`,
        buildCsv(
          ISSUES_CSV_HEADERS.map((header, idx) => ({ header, value: (i: JiraIssue) => issuesCsvRow(i)[idx] })),
          report.issues,
        ),
      );
      downloadCsv(
        `${stem}-daily.csv`,
        buildCsv(
          [
            { header: 'Date', value: (r: [string, string]) => r[0] },
            { header: 'Hours', value: (r: [string, string]) => r[1] },
          ],
          dailyCsvRows(heatmapHours),
        ),
      );
      pushToast({ title: 'Export complete', body: `${stem}-issues.csv, ${stem}-daily.csv`, severity: 'success' });
    } catch (err) {
      pushToast({ title: 'Export failed', body: errText(err), severity: 'error' });
    }
  };

  const exportPdf = () => window.print();

  const columns: GridColumn<JiraIssue>[] = useMemo(
    () => [
      {
        key: 'key',
        header: 'Key',
        width: 96,
        render: (i) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{i.key}</span>,
      },
      { key: 'summary', header: 'Summary', width: 330 },
      {
        key: 'status',
        header: 'Status',
        width: 130,
        render: (i) => <StatusPill status={i.status} />,
      },
      {
        key: 'workLoggedForPeriod',
        header: 'Logged (period)',
        width: 116,
        render: (i) => (
          <b style={{ color: (i.workLoggedForPeriod ?? 0) > 0 ? 'var(--accent-green)' : 'var(--muted)' }}>
            {formatTimeSpan(i.workLoggedForPeriod)}
          </b>
        ),
        sortValue: (i) => i.workLoggedForPeriod ?? 0,
      },
      {
        key: 'estbar',
        header: 'Estimated ↔ Logged',
        width: 190,
        render: (i) => <EstBar issue={i} />,
        sortValue: (i) => ((i.originalEstimate ?? 0) > 0 ? (i.timeSpent ?? 0) / (i.originalEstimate ?? 1) : 0),
        format: (i) => `${formatTimeSpan(i.timeSpent)} / ${formatTimeSpan(i.originalEstimate)}`,
      },
      {
        key: 'remainingEstimate',
        header: 'Remaining',
        width: 100,
        format: (i) => formatTimeSpan(i.remainingEstimate),
        sortValue: (i) => i.remainingEstimate ?? 0,
      },
      { key: 'sprint', header: 'Sprint', width: 150, format: (i) => i.sprint ?? '' },
      {
        key: 'log',
        header: '',
        width: 88,
        format: () => '',
        sortValue: () => null,
        render: (i) => (
          <button
            className="btn"
            style={{ padding: '2px 10px', fontSize: 11.5 }}
            title={`Log work on ${i.key} (format: 1h 30m)`}
            onClick={(e) => {
              e.stopPropagation();
              dialogs.openLogWork(i.key, {
                remainingEstimate: i.remainingEstimate,
                onLogged: () => void loadRef.current(),
              });
            }}
          >
            + Log
          </button>
        ),
      },
    ],
    [],
  );

  const dayCell: React.CSSProperties = {
    width: 48,
    minWidth: 48,
    textAlign: 'center',
    padding: '4px 2px',
    borderBottom: '1px solid var(--border-soft)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <style>{`
        .tl-print { position: absolute; left: -99999px; top: 0; }
        @media print {
          body * { visibility: hidden; }
          .tl-print, .tl-print * { visibility: visible; }
          .tl-print { position: absolute; left: 0; top: 0; width: 100%; color: #000; background: #fff; }
          .tl-print table { border-collapse: collapse; width: 100%; font-size: 11px; }
          .tl-print th, .tl-print td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
        }
        .tl-chip { transition: transform 120ms ease; }
        .tl-chip:hover { transform: translateY(-1px); }
      `}</style>

      {/* ------------------------------------------------ toolbar ---------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontFamily: 'var(--font-display)' }}>Time Spent</h2>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              className="btn"
              onClick={() => setPeriod(p.id)}
              style={
                period === p.id
                  ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', fontWeight: 700 }
                  : undefined
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'customRange' ? (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        ) : null}
        <UserSearchPicker users={users} value={userFilter} onCommit={setUserFilter} />
        {busy ? <span className="accent-cyan">…</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={exportCsv} disabled={!report}>
          ⬇ CSV
        </button>
        <button className="btn" onClick={exportPdf} disabled={!report}>
          ⬇ PDF
        </button>
      </div>

      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      {/* ------------------------------------------- hero summary ---------- */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Total logged · {PERIODS.find((p) => p.id === period)?.label}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--accent-green)', lineHeight: 1.15 }}>
            {formatTimeSpan(report?.total ?? 0)}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            across {loggedIssues} issue{loggedIssues === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-soft)' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
          {statusChips.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Nothing logged in this period yet.
            </span>
          ) : (
            statusChips.map((c) => (
              <div
                key={c.status}
                className="tl-chip"
                title={`${c.count} issue(s) in "${c.status}" — ${formatTimeSpan(c.seconds)} logged in this period`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: `1px solid ${statusColor(c.status)}`,
                  background: `color-mix(in srgb, ${statusColor(c.status)} 8%, transparent)`,
                  minWidth: 110,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(c.status) }}>{c.status}</span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{formatTimeSpan(c.seconds)}</span>
                <span className="muted" style={{ fontSize: 10.5 }}>
                  {c.count} issue{c.count === 1 ? '' : 's'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ------------------------------------------- issues panel ---------- */}
      <ResponsiveGrid<JiraIssue>
        stateKey="TimeLogged.Issues"
        columns={columns}
        rows={report?.issues ?? []}
        rowKey={(i) => i.key}
        multiSelect
        onRowDoubleClick={(i) => dialogs.openIssueDetails(i.key)}
        emptyText="No work logged in this period."
      />

      {/* -------------------------------------------- timesheet ------------ */}
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>Weekly timesheet</span>
          <button className="btn btn-icon" onClick={() => changeWeek(addDays(weekStart, -7))} title="Previous week">
            ◀
          </button>
          <span style={{ padding: '4px 14px', borderRadius: 999, border: '1px solid var(--border-strong)', fontSize: 12.5 }}>
            {formatDMmmYy(weekStart)} – {formatDMmmYy(addDays(weekStart, 6))}
          </span>
          <button className="btn btn-icon" onClick={() => changeWeek(addDays(weekStart, 7))} title="Next week">
            ▶
          </button>
          <button className="btn" onClick={() => changeWeek(startOfWeekSunday(new Date()))}>
            This week
          </button>
          <div style={{ flex: 1 }} />
          <span>
            Week total:{' '}
            <b style={{ color: 'var(--accent-green)' }}>
              {formatTimeSpan(Math.round((timesheet?.weeklyTotalHours ?? 0) * 3600))}
            </b>
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 420 + 7 * 48 }}>
            <thead>
              <tr>
                <th style={{ ...dayCell, width: 240, minWidth: 240, textAlign: 'left' }} className="muted">
                  Issue
                </th>
                <th style={{ ...dayCell, width: 100, minWidth: 100, textAlign: 'left' }} className="muted">
                  Key
                </th>
                <th style={{ ...dayCell, width: 80, minWidth: 80 }} className="muted">
                  Logged
                </th>
                {weekHeaders.map((h, i) => (
                  <th key={i} style={dayCell}>
                    <div style={{ fontWeight: 700 }}>{h.dayNumber}</div>
                    <div className="muted" style={{ fontSize: 10, opacity: 0.7 }}>
                      {h.dayLabel}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(timesheet?.rows ?? []).map((r) => (
                <tr key={r.issueKey}>
                  <td style={{ ...dayCell, textAlign: 'left', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.summary}
                  </td>
                  <td style={{ ...dayCell, textAlign: 'left', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                    {r.issueKey}
                  </td>
                  <td style={dayCell}>{hoursDisplay(r.loggedHours)}</td>
                  {r.days.map((h, i) => (
                    <td key={i} style={dayCell}>
                      {hoursDisplay(h)}
                    </td>
                  ))}
                </tr>
              ))}
              {timesheet ? (
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ ...dayCell, textAlign: 'left' }}>Total</td>
                  <td style={dayCell} />
                  <td style={dayCell}>{hoursDisplay(timesheet.weeklyTotalHours)}</td>
                  {timesheet.totals.map((h, i) => (
                    <td key={i} style={dayCell}>
                      {hoursDisplay(h)}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* --------------------------------------------- heatmap ------------- */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Activity — last 13 weeks</div>
        <Heatmap hoursByDay={heatmapHours} />
      </div>

      {/* Print-only section for the PDF export (window.print). */}
      <div className="tl-print" aria-hidden="true">
        <h2>Time Spent — {formatPrintStamp(new Date())}</h2>
        <p>
          <b>Total work logged: {formatTimeSpan(report?.total ?? 0)}</b>
        </p>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Logged</th>
              <th>Total</th>
              <th>Est</th>
              <th>Rem</th>
            </tr>
          </thead>
          <tbody>
            {(report?.issues ?? []).map((i) => (
              <tr key={i.key}>
                <td>{i.key}</td>
                <td>{i.summary}</td>
                <td>{i.status}</td>
                <td>{issuesCsvRow(i)[4]}</td>
                <td>{issuesCsvRow(i)[5]}</td>
                <td>{issuesCsvRow(i)[6]}</td>
                <td>{issuesCsvRow(i)[7]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** `yyyy-MM-dd HH:mm` header stamp for the print/PDF section. */
export function formatPrintStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
