// Time Spent view — scope-first redesign:
//   · ONE scope bar selects the data window: [Day] [Week] [Month] [Sprint]
//     [Custom] + ◀ label ▶ + Today + user picker + CSV/PDF export
//   · ONE fetch per (scope, anchor, custom range, sprint, user)
//   · a `view:` row switches PRESENTATION only: Timesheet / Summary / Epics /
//     Calendar (month scope) / Board (sprint scope)
// The old period chips, sprint chip + dropdown, tab strip and timesheet week
// arrows are gone — the scope bar drives everything.
// Refresh: session change ONLY — no scheduler tick.

import { useEffect, useMemo, useRef, useState } from 'react';
import { issues as issuesApi, metadata as metadataApi, timelogged as timeloggedApi } from '../api/client';
import { ResponsiveGrid } from '../components/ResponsiveGrid';
import type { GridColumn } from '../components/DataGrid';
import { UserSearchPicker } from '../components/UserSearchPicker';
import { dialogs } from '../dialogs/DialogHost';
import { statusColor } from '../lib/colors';
import { buildCsv, downloadCsv } from '../lib/csv';
import { errText } from '../lib/errors';
import { formatTimeSpan } from '../lib/format';
import { addDays, parseYmd, ymd } from '../lib/viewFormat';
import {
  scopeWindow,
  stepAnchor,
  viewsForScope,
  windowDays,
  type ScopeId,
  type ViewId,
} from '../lib/viewTimeSpentScope';
import { sprintJql } from '../lib/viewTimeSpentTabs';
import {
  ISSUES_CSV_HEADERS,
  aggregateDailyHours,
  dailyCsvRows,
  issuesCsvRow,
  loggedOnlyIssues,
} from '../lib/viewTimeLogged';
import { sessionStore } from '../stores/session';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { JiraIssue, TimeLoggedReport } from '../types';
import { CalendarTab } from './timespent/CalendarTab';
import { EditableTimesheet } from './timespent/EditableTimesheet';
import { EpicsTab } from './timespent/EpicsTab';
import { SprintTab } from './timespent/SprintTab';

const SCOPES: Array<{ id: ScopeId; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'custom', label: 'Custom' },
];

const VIEW_LABELS: Record<ViewId, string> = {
  timesheet: 'Timesheet',
  summary: 'Summary',
  epics: 'Epics',
  calendar: 'Calendar',
  board: 'Board',
};

/** Hours logged per status across the window — the Summary hero's chips. */
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

/** Summary view: hero total + per-status chips + logged-only issues panel. */
function SummaryView({
  report,
  scopeLabel,
  loggedRows,
  columns,
}: {
  report: TimeLoggedReport | null;
  scopeLabel: string;
  loggedRows: JiraIssue[];
  columns: GridColumn<JiraIssue>[];
}) {
  const statusChips = useMemo(() => loggedByStatus(loggedRows), [loggedRows]);
  const loggedIssues = loggedRows.length;
  return (
    <>
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
            Total logged · {scopeLabel}
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
        rows={loggedRows}
        rowKey={(i) => i.key}
        multiSelect
        onRowDoubleClick={(i) => dialogs.openIssueDetails(i.key)}
        emptyText="No work logged in this period."
      />
    </>
  );
}

export function TimeLoggedView() {
  const session = useStore(sessionStore);
  const connected = session.phase === 'connected';

  const [scope, setScope] = useState<ScopeId>('week');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [customFrom, setCustomFrom] = useState(() => ymd(new Date()));
  const [customTo, setCustomTo] = useState(() => ymd(new Date()));
  const [sprintName, setSprintName] = useState(''); // '' = active sprint
  const [view, setView] = useState<ViewId>('timesheet');
  const [userFilter, setUserFilter] = useState('');
  const [users, setUsers] = useState<string[]>([]);
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSeq = useRef(0);

  const win = useMemo(() => {
    if (scope === 'sprint') return null;
    if (scope === 'custom' && (!customFrom || !customTo)) return null; // cleared date input
    return scopeWindow(scope, anchor, customFrom, customTo);
  }, [scope, anchor, customFrom, customTo]);

  const availableSprints = report?.availableSprints ?? [];
  const selectedSprint = sprintName || availableSprints[0] || '';

  // Sprint scope: the data window comes from the report's UTC bounds.
  const sprintWin = useMemo(() => {
    if (scope !== 'sprint' || !report?.fromUtc || !report?.toUtc) return null;
    const from = report.fromUtc.slice(0, 10);
    const toInclusive = report.toUtc.slice(0, 10);
    return {
      from,
      to: ymd(addDays(parseYmd(toInclusive), 1)),
      label: `${selectedSprint || 'Active sprint'} · ${from} → ${toInclusive}`,
    };
  }, [scope, report, selectedSprint]);

  const dataWin = scope === 'sprint' ? sprintWin : win;
  const scopeLabel = scope === 'sprint' ? sprintWin?.label ?? (selectedSprint || 'Active sprint') : win?.label ?? '';

  const load = async () => {
    if (sessionStore.get().phase !== 'connected') return;
    if (scope === 'custom' && (!customFrom || !customTo)) return;
    const seq = ++loadSeq.current;
    setBusy(true);
    setError(null);
    try {
      const user = userFilter.trim() || undefined;
      let r: TimeLoggedReport;
      if (scope === 'sprint') {
        r = await timeloggedApi.sprint(sprintName, user);
      } else {
        // worklogAuthor range query: every issue the user logged in the
        // window, regardless of sprint.
        const w = scopeWindow(scope, anchor, customFrom, customTo);
        r = await timeloggedApi.range(w.from, w.to, user);
      }
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
  }, [connected, scope, win?.from, win?.to, sprintName, userFilter]);

  const legalViews = viewsForScope(scope);

  const changeScope = (s: ScopeId) => {
    setScope(s);
    const legal = viewsForScope(s);
    if (!legal.includes(view)) setView(s === 'month' ? 'calendar' : legal[0]);
  };

  const stepSprint = (delta: number) => {
    if (availableSprints.length === 0) return;
    const idx = availableSprints.indexOf(selectedSprint);
    const nextIdx = Math.min(availableSprints.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + delta));
    setSprintName(availableSprints[nextIdx]);
  };

  const step = (dir: 1 | -1) => {
    if (scope === 'sprint') stepSprint(dir);
    else if (scope !== 'custom') setAnchor(stepAnchor(scope, anchor, dir));
  };

  const goToday = () => {
    if (scope === 'sprint') {
      setSprintName('');
    } else if (scope === 'custom') {
      const today = ymd(new Date());
      setCustomFrom(today);
      setCustomTo(today);
    } else {
      setAnchor(new Date());
    }
  };

  const days = useMemo(() => (dataWin ? windowDays(dataWin) : []), [dataWin]);
  const loggedRows = useMemo(() => loggedOnlyIssues(report?.issues ?? []), [report]);

  // Sprint issues for the signed-in user, feeding empty (not-yet-logged)
  // timesheet rows. Only fetched when the user picker is self — logging on
  // behalf of someone else is out of scope, and their sprint isn't ours to show.
  const [sprintIssues, setSprintIssues] = useState<JiraIssue[]>([]);
  useEffect(() => {
    if (!connected || userFilter.trim()) {
      setSprintIssues([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const project = sessionStore.get().profile?.defaultProjectKey || 'ISW';
        const page = await issuesApi.search(sprintJql(project, null), 0, 100);
        if (!cancelled) setSprintIssues(page.items ?? []);
      } catch {
        if (!cancelled) setSprintIssues([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, userFilter]);

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
          loggedRows,
        ),
      );
      downloadCsv(
        `${stem}-daily.csv`,
        buildCsv(
          [
            { header: 'Date', value: (r: [string, string]) => r[0] },
            { header: 'Hours', value: (r: [string, string]) => r[1] },
          ],
          dailyCsvRows(aggregateDailyHours(report.dailyByIssue)),
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

  const activeChip = { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', fontWeight: 700 } as const;

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

      {/* ------------------------------------------------ scope bar -------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontFamily: 'var(--font-display)' }}>Time Spent</h2>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className="btn"
              onClick={() => changeScope(s.id)}
              style={scope === s.id ? activeChip : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scope === 'custom' ? (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="btn btn-icon" onClick={() => step(-1)} title={scope === 'sprint' ? 'Older sprint' : 'Previous'}>
              ◀
            </button>
            {scope === 'sprint' ? (
              <select value={selectedSprint} onChange={(e) => setSprintName(e.target.value)}>
                {availableSprints.length === 0 ? (
                  <option value="">{selectedSprint || 'Active sprint'}</option>
                ) : (
                  availableSprints.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <span style={{ padding: '4px 14px', borderRadius: 999, border: '1px solid var(--border-strong)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                {scopeLabel}
              </span>
            )}
            <button className="btn btn-icon" onClick={() => step(1)} title={scope === 'sprint' ? 'Newer sprint' : 'Next'}>
              ▶
            </button>
          </div>
        )}
        <button className="btn" onClick={goToday}>
          Today
        </button>
        {busy ? <span className="accent-cyan">…</span> : null}
        <div style={{ flex: 1 }} />
        <UserSearchPicker users={users} value={userFilter} onCommit={setUserFilter} />
        <button className="btn" onClick={exportCsv} disabled={!report}>
          ⬇ CSV
        </button>
        <button className="btn" onClick={exportPdf} disabled={!report}>
          ⬇ PDF
        </button>
      </div>

      {/* ------------------------------------------------ view switch ------ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12 }}>view:</span>
        {legalViews.map((v) => (
          <button key={v} className="btn" onClick={() => setView(v)} style={view === v ? activeChip : undefined}>
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      {view === 'summary' ? (
        <SummaryView report={report} scopeLabel={scopeLabel} loggedRows={loggedRows} columns={columns} />
      ) : null}

      {/* -------------------------------------------- timesheet ------------ */}
      {view === 'timesheet' ? (
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>Timesheet</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{scopeLabel}</span>
            <div style={{ flex: 1 }} />
            <span>
              Total: <b style={{ color: 'var(--accent-green)' }}>{formatTimeSpan(report?.total ?? 0)}</b>
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <EditableTimesheet
              days={days}
              report={report}
              sprintIssues={sprintIssues}
              user={userFilter}
              onLogged={() => void loadRef.current()}
            />
          </div>
        </div>
      ) : null}

      {view === 'epics' ? (
        dataWin ? (
          <EpicsTab from={dataWin.from} to={dataWin.to} user={userFilter} />
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>Loading sprint window…</div>
        )
      ) : null}

      {view === 'calendar' ? <CalendarTab year={anchor.getFullYear()} month={anchor.getMonth()} user={userFilter} /> : null}

      {view === 'board' ? <SprintTab sprintName={selectedSprint} user={userFilter} /> : null}

      {/* Print-only section for the PDF export (window.print). */}
      <div className="tl-print" aria-hidden="true">
        <h2>Time Spent — {scopeLabel} — {formatPrintStamp(new Date())}</h2>
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
            {loggedRows.map((i) => (
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
