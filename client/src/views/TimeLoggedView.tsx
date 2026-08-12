// Time Spent view (ui-parity-contract.md §7): toolbar exports (CSV + PNG,
// PDF via window.print of a print-styled section — accepted web equivalent of
// the WPF QuestPDF export), Log work expander, three chart expanders
// (logged-vs-estimated, per-day sprint stack, 13-week heatmap fed from
// /api/timelogged/range over the last 91 days), weekly timesheet card, issues
// grid 'TimeLogged.Issues', sticky footer total, period selector + user
// picker. Refresh: session change ONLY — no scheduler tick.

import { useEffect, useMemo, useRef, useState } from 'react';
import { metadata as metadataApi, timelogged as timeloggedApi } from '../api/client';
import { Bars } from '../charts/Bars';
import { Heatmap } from '../charts/Heatmap';
import { StackedBarsH } from '../charts/StackedBarsH';
import { DataGrid } from '../components/DataGrid';
import type { GridColumn } from '../components/DataGrid';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { statusColor } from '../lib/colors';
import { buildCsv, downloadCsv } from '../lib/csv';
import { formatTimeSpan } from '../lib/format';
import { addDays, formatDMmmYy, hoursDisplay, startOfWeekSunday, ymd } from '../lib/viewFormat';
import {
  ISSUES_CSV_HEADERS,
  aggregateDailyHours,
  buildLoggedVsEstimated,
  buildSprintDailyChart,
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
  { id: 'thisWeek', label: 'ThisWeek' },
  { id: 'previousWeek', label: 'PreviousWeek' },
  { id: 'thisMonth', label: 'ThisMonth' },
  { id: 'customRange', label: 'CustomRange' },
] as const;

type PeriodId = (typeof PERIODS)[number]['id'];

/** Serialize the first <svg> under `container` and download it as a PNG (best-effort). */
async function exportSvgPng(container: HTMLElement | null, filename: string, width = 1400, height = 700): Promise<void> {
  const svg = container?.querySelector('svg');
  if (!svg) return;
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG rasterize failed'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(pngUrl);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Best-effort — theme CSS variables inside the SVG may not resolve
    // off-document; the CSVs are the canonical export.
  }
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

  const [selectedIssue, setSelectedIssue] = useState<JiraIssue | null>(null);
  const [logStatus, setLogStatus] = useState('');

  const [availableSprints, setAvailableSprints] = useState<string[]>([]);
  const [selectedSprint, setSelectedSprint] = useState('');
  const [sprintReport, setSprintReport] = useState<TimeLoggedReport | null>(null);
  const [heatmapHours, setHeatmapHours] = useState<Record<string, number>>({});

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekSunday(new Date()));
  const [weekReport, setWeekReport] = useState<TimeLoggedReport | null>(null);

  const chart1Ref = useRef<HTMLDivElement>(null);
  const chart2Ref = useRef<HTMLDivElement>(null);
  const loadSeq = useRef(0);

  const loadSprint = async (name: string) => {
    try {
      const r = await timeloggedApi.sprint(name);
      setSprintReport(r);
      setAvailableSprints((prev) => {
        if (prev.length === 0 && r.availableSprints.length > 0) {
          if (!name) setSelectedSprint(r.availableSprints[0]);
          return r.availableSprints;
        }
        return prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadHeatmap = async () => {
    try {
      // §7 (JiraWeb): 13-week heatmap from the range report over the last 91 days.
      const today = new Date();
      const r = await timeloggedApi.range(ymd(addDays(today, -91)), ymd(addDays(today, 1)));
      setHeatmapHours(aggregateDailyHours(r.dailyByIssue));
    } catch {
      /* best-effort */
    }
  };

  const loadTimesheet = async (start: Date) => {
    try {
      setWeekReport(await timeloggedApi.range(ymd(start), ymd(addDays(start, 7))));
    } catch {
      /* best-effort */
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
      // ?user= makes the server swap in the §7 JQL verbatim:
      // project = {X} AND sprint in openSprints() AND assignee = "{user}"
      //   AND issuetype != Incident ORDER BY updated DESC
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

      void loadSprint(selectedSprint);
      void loadHeatmap();
      void loadTimesheet(weekStart);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  // §7: session change reload ONLY (no scheduler tick); period/user reload too.
  useEffect(() => {
    if (connected) void loadRef.current();
  }, [connected, period, customFrom, customTo, userFilter]);

  const onSprintChange = (name: string) => {
    setSelectedSprint(name);
    void loadSprint(name);
  };

  const changeWeek = (start: Date) => {
    setWeekStart(start);
    void loadTimesheet(start);
  };

  // Derived chart/timesheet data.
  const lveGroups = useMemo(() => buildLoggedVsEstimated(report?.issues ?? []), [report]);
  const sprintChart = useMemo(() => buildSprintDailyChart(sprintReport?.dailyByIssue ?? []), [sprintReport]);
  const timesheet = useMemo(
    () => (weekReport ? buildTimesheet(weekStart, weekReport) : null),
    [weekReport, weekStart],
  );
  const weekHeaders = useMemo(() => timesheetHeaders(weekStart), [weekStart]);

  const openLogWork = () => {
    if (!selectedIssue) return;
    const key = selectedIssue.key;
    dialogs.openLogWork(key, {
      remainingEstimate: selectedIssue.remainingEstimate,
      onLogged: () => {
        setLogStatus(`Logged work on ${key}.`);
        void loadRef.current();
      },
    });
  };

  const exportExcelPng = async () => {
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
      await exportSvgPng(chart1Ref.current, `${stem}-logged-vs-estimated.png`);
      await exportSvgPng(chart2Ref.current, `${stem}-daily-chart.png`);
      pushToast({ title: 'Export complete', body: `${stem}-issues.csv, ${stem}-daily.csv` });
    } catch (err) {
      pushToast({ title: 'Export failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  // PDF export = window.print() over the print-styled section below — the
  // accepted web equivalent of the WPF QuestPDF A4 export (§7).
  const exportPdf = () => window.print();

  const columns: GridColumn<JiraIssue>[] = useMemo(
    () => [
      {
        key: 'key',
        header: 'Key',
        width: 100,
        render: (i) => <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{i.key}</span>,
      },
      { key: 'summary', header: 'Summary', width: 380 },
      {
        key: 'status',
        header: 'Status',
        width: 120,
        render: (i) => <span style={{ color: statusColor(i.status) }}>{i.status}</span>,
      },
      { key: 'sprint', header: 'Sprint', width: 160, format: (i) => i.sprint ?? '' },
      {
        key: 'workLoggedForPeriod',
        header: 'Work Logged',
        width: 120,
        format: (i) => formatTimeSpan(i.workLoggedForPeriod),
        sortValue: (i) => i.workLoggedForPeriod ?? 0,
      },
      {
        key: 'timeSpent',
        header: 'Total Spent',
        width: 120,
        format: (i) => formatTimeSpan(i.timeSpent),
        sortValue: (i) => i.timeSpent ?? 0,
      },
      {
        key: 'originalEstimate',
        header: 'Estimated',
        width: 120,
        format: (i) => formatTimeSpan(i.originalEstimate),
        sortValue: (i) => i.originalEstimate ?? 0,
      },
      {
        key: 'remainingEstimate',
        header: 'Remaining',
        width: 120,
        format: (i) => formatTimeSpan(i.remainingEstimate),
        sortValue: (i) => i.remainingEstimate ?? 0,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, paddingBottom: 0 }}>
      <style>{`
        .tl-print { position: absolute; left: -99999px; top: 0; }
        @media print {
          body * { visibility: hidden; }
          .tl-print, .tl-print * { visibility: visible; }
          .tl-print { position: absolute; left: 0; top: 0; width: 100%; color: #000; background: #fff; }
          .tl-print table { border-collapse: collapse; width: 100%; font-size: 11px; }
          .tl-print th, .tl-print td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18 }}>Time Spent</h2>
        <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)}>
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {period === 'customRange' ? (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        ) : null}
        <UserSearchPicker users={users} value={userFilter} onCommit={setUserFilter} />
        {busy ? <span className="accent-cyan">…</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => void exportExcelPng()} disabled={!report}>
          Export to Excel/PNG
        </button>
        <button className="btn" onClick={exportPdf} disabled={!report}>
          Export PDF
        </button>
      </div>

      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      <details className="card" style={{ padding: '10px 14px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Log work</summary>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 10 }}>
          <span>
            Selected: <b style={{ color: 'var(--accent-cyan)' }}>{selectedIssue?.key ?? '—'}</b>
            {'  '}Epic: <b>{selectedIssue?.epicKey ?? '—'}</b>
          </span>
          <button
            className="btn btn-primary"
            onClick={openLogWork}
            disabled={!selectedIssue}
            title="Time format: 1h 30m, 45m, 2h"
          >
            Log work
          </button>
          {logStatus ? <span style={{ color: 'var(--accent-green)' }}>{logStatus}</span> : null}
        </div>
      </details>

      <div className="card" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Logged vs Estimated chart</summary>
          <div ref={chart1Ref} style={{ paddingTop: 10 }}>
            <Bars
              title="Sprint time per issue (hours)"
              height={220}
              groups={lveGroups.map((g) => ({
                label: g.key,
                values: [g.estimatedHours, g.loggedHours],
                colors: [undefined, g.over ? '#EF4444' : undefined],
                tooltip: g.tooltip,
              }))}
              series={[
                { name: 'Estimated', color: '#4F46E5' },
                { name: 'Logged (under)', color: '#10B981' },
              ]}
              extraLegend={[{ name: 'Logged (over)', color: '#EF4444' }]}
              valueSuffix="h"
            />
          </div>
        </details>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Logging per day in sprint</summary>
          <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select value={selectedSprint} onChange={(e) => onSprintChange(e.target.value)} style={{ maxWidth: 360 }}>
              {availableSprints.length === 0 ? <option value="">(active sprint)</option> : null}
              {availableSprints.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div ref={chart2Ref}>
              <StackedBarsH
                title="Logging per day (sprint)"
                rows={sprintChart.rows}
                series={sprintChart.series}
                valueSuffix="h"
              />
            </div>
          </div>
        </details>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Activity heatmap (last 13 weeks)</summary>
          <div style={{ paddingTop: 10 }}>
            <Heatmap hoursByDay={heatmapHours} />
          </div>
        </details>
      </div>

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-icon" onClick={() => changeWeek(addDays(weekStart, -7))} title="Previous week">
            ◀
          </button>
          <span
            style={{
              padding: '4px 14px',
              borderRadius: 999,
              border: '1px solid var(--border-strong)',
              fontSize: 12.5,
            }}
          >
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
            Total:{' '}
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

      <DataGrid<JiraIssue>
        stateKey="TimeLogged.Issues"
        columns={columns}
        rows={report?.issues ?? []}
        rowKey={(i) => i.key}
        multiSelect
        onSelectionChange={(rows) => setSelectedIssue(rows[0] ?? null)}
        onRowDoubleClick={(i) => dialogs.openIssueDetails(i.key)}
        emptyText="No work logged in this period."
      />

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: '10px 14px',
          background: 'var(--bg-panel-high)',
          borderTop: '1px solid var(--border-strong)',
          margin: '0 -16px',
        }}
      >
        Total Work Logged:{' '}
        <b style={{ color: 'var(--accent-green)' }}>{formatTimeSpan(report?.total ?? 0)}</b>
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
