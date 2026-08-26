// Editable timesheet (Task 3): type hours directly into the grid to log
// work — no dialog. Empty/zero cells for the signed-in user become inline
// inputs; filled cells show the day total and open a small "+ add"
// popover for a second worklog. Read-only (plain text, no inputs) whenever
// the scope bar's user picker points at someone other than the signed-in
// user, since the server always logs as the session user.

import { useMemo, useState } from 'react';
import { issues as issuesApi } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { errText } from '../../lib/errors';
import { formatTimeSpan } from '../../lib/format';
import { hoursDisplay, parseYmd } from '../../lib/viewFormat';
import { buildEditableRows, parseCellInput } from '../../lib/viewTimeSpentScope';
import { pushToast } from '../../stores/toasts';
import type { JiraIssue, TimeLoggedReport } from '../../types';

const MAX_CELL_SECONDS = 24 * 3600;
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

/** `Su 23`-style column header for a `yyyy-MM-dd` day. */
function dayHeader(day: string): { weekday: string; num: string } {
  const d = parseYmd(day);
  return { weekday: DAY_ABBR[d.getDay()], num: String(d.getDate()).padStart(2, '0') };
}

/** `26 Aug` — toast-friendly day label. */
function dayLabel(day: string): string {
  const d = parseYmd(day);
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

const dayCell: React.CSSProperties = {
  width: 56,
  minWidth: 56,
  textAlign: 'center',
  padding: '4px 4px',
  borderBottom: '1px solid var(--border-soft)',
};

const stickyCol: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  background: 'var(--surface, var(--bg-panel, #12161c))',
  zIndex: 1,
  textAlign: 'left',
  width: 260,
  minWidth: 260,
  maxWidth: 260,
  padding: '4px 8px',
  borderBottom: '1px solid var(--border-soft)',
};

const cellInputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  textAlign: 'center',
  fontSize: 12.5,
  fontFamily: 'inherit',
  color: 'inherit',
  padding: 0,
};

export function EditableTimesheet({
  days,
  report,
  sprintIssues,
  user,
  onLogged,
}: {
  days: string[];
  report: TimeLoggedReport | null;
  sprintIssues: JiraIssue[];
  user: string;
  onLogged: () => void;
}) {
  const self = user.trim() === '';

  const [manual, setManual] = useState<{ key: string; summary: string }[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set());
  const [popoverCell, setPopoverCell] = useState<string | null>(null);
  const [popoverValue, setPopoverValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [addingKey, setAddingKey] = useState(false);

  const rows = useMemo(
    () => buildEditableRows(days, report, self ? sprintIssues : [], manual),
    [days, report, sprintIssues, manual, self],
  );
  const totals = useMemo(() => days.map((_, i) => rows.reduce((sum, r) => sum + r.hours[i], 0)), [days, rows]);
  const grandTotal = totals.reduce((a, b) => a + b, 0);

  const cellId = (key: string, day: string) => `${key}|${day}`;

  const setBusy = (id: string, busy: boolean) =>
    setBusyCells((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const commit = async (key: string, day: string, raw: string, close: () => void) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      close();
      return;
    }
    const seconds = parseCellInput(trimmed);
    if (seconds === null) {
      pushToast({ title: key, body: `Could not parse "${trimmed}" as a time.`, severity: 'error' });
      close();
      return;
    }
    if (seconds > MAX_CELL_SECONDS) {
      pushToast({ title: 'Max 24h per day cell.', body: '', severity: 'error' });
      close();
      return;
    }
    const id = cellId(key, day);
    setBusy(id, true);
    try {
      await issuesApi.addWorklog(key, { seconds, started: new Date(`${day}T12:00:00`).toISOString() });
      pushToast({
        title: `${key} · ${formatTimeSpan(seconds)} logged on ${dayLabel(day)}`,
        body: '',
        severity: 'success',
      });
      close();
      onLogged();
    } catch (err) {
      pushToast({ title: `${key} — log failed`, body: errText(err), severity: 'error' });
      // revert: leave the draft as-is so the user can retry/edit.
    } finally {
      setBusy(id, false);
    }
  };

  const addIssue = async () => {
    const key = newKey.trim().toUpperCase();
    if (!KEY_RE.test(key)) {
      pushToast({ title: 'Invalid issue key', body: `"${newKey}" doesn't look like ISW-1234.`, severity: 'error' });
      return;
    }
    setAddingKey(true);
    try {
      const details = await issuesApi.details(key);
      setManual((prev) => (prev.some((m) => m.key === details.issue.key) ? prev : [...prev, { key: details.issue.key, summary: details.issue.summary }]));
      setNewKey('');
    } catch (err) {
      pushToast({ title: `${key} not found`, body: errText(err), severity: 'error' });
    } finally {
      setAddingKey(false);
    }
  };

  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 260 + days.length * 56 + 80 }}>
      <thead>
        <tr>
          <th style={{ ...stickyCol }} className="muted">
            Issue
          </th>
          {days.map((d) => {
            const h = dayHeader(d);
            return (
              <th key={d} style={dayCell}>
                <div style={{ fontWeight: 700 }}>{h.weekday}</div>
                <div className="muted" style={{ fontSize: 10, opacity: 0.7 }}>
                  {h.num}
                </div>
              </th>
            );
          })}
          <th style={{ ...dayCell, width: 72, minWidth: 72 }} className="muted">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td
              style={{ ...stickyCol, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => dialogs.openIssueDetails(row.key)}
              title={row.summary}
            >
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{row.key}</span>{' '}
              <span className="muted">{row.summary}</span>
            </td>
            {row.hours.map((h, i) => {
              const day = days[i];
              const id = cellId(row.key, day);
              const busy = busyCells.has(id);
              if (!self) {
                return (
                  <td key={day} style={dayCell}>
                    {hoursDisplay(h)}
                  </td>
                );
              }
              if (h > 0) {
                const open = popoverCell === id;
                return (
                  <td key={day} style={{ ...dayCell, position: 'relative' }}>
                    <span
                      role="button"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setPopoverCell(id);
                        setPopoverValue('');
                      }}
                    >
                      {hoursDisplay(h)}
                    </span>
                    {open ? (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          zIndex: 2,
                          background: 'var(--bg-panel, #1a1f27)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: 6,
                          padding: 6,
                          display: 'flex',
                          gap: 4,
                          alignItems: 'center',
                        }}
                      >
                        <input
                          autoFocus
                          value={popoverValue}
                          disabled={busy}
                          placeholder="+ add"
                          style={{ width: 56, fontSize: 11.5 }}
                          onChange={(e) => setPopoverValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commit(row.key, day, popoverValue, () => setPopoverCell(null));
                            else if (e.key === 'Escape') setPopoverCell(null);
                          }}
                        />
                        <button
                          className="btn"
                          style={{ padding: '1px 6px', fontSize: 11 }}
                          disabled={busy}
                          onClick={() => void commit(row.key, day, popoverValue, () => setPopoverCell(null))}
                        >
                          Add
                        </button>
                        <button
                          className="btn"
                          style={{ padding: '1px 6px', fontSize: 11 }}
                          disabled={busy}
                          onClick={() => setPopoverCell(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </td>
                );
              }
              const draft = drafts[id] ?? '';
              return (
                <td key={day} style={dayCell}>
                  <input
                    value={draft}
                    disabled={busy}
                    style={cellInputStyle}
                    placeholder="—"
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      } else if (e.key === 'Escape') {
                        setDrafts((prev) => {
                          const next = { ...prev };
                          delete next[id];
                          return next;
                        });
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    onBlur={() => {
                      const value = drafts[id] ?? '';
                      void commit(row.key, day, value, () =>
                        setDrafts((prev) => {
                          const next = { ...prev };
                          delete next[id];
                          return next;
                        }),
                      );
                    }}
                  />
                </td>
              );
            })}
            <td style={{ ...dayCell, width: 72, minWidth: 72, fontWeight: 700 }}>{hoursDisplay(row.totalHours)}</td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2 + days.length} className="muted" style={{ ...dayCell, textAlign: 'left' }}>
              No work logged in this window.
            </td>
          </tr>
        ) : (
          <tr style={{ fontWeight: 700 }}>
            <td style={{ ...stickyCol }}>Total</td>
            {totals.map((h, i) => (
              <td key={i} style={dayCell}>
                {hoursDisplay(h)}
              </td>
            ))}
            <td style={{ ...dayCell, width: 72, minWidth: 72 }}>{hoursDisplay(grandTotal)}</td>
          </tr>
        )}
      </tbody>
      {self ? (
        <tfoot>
          <tr>
            <td style={{ ...stickyCol, position: 'static' }} colSpan={2 + days.length}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  + Add issue:
                </span>
                <input
                  value={newKey}
                  disabled={addingKey}
                  placeholder="ISW-1234"
                  style={{ width: 110, fontSize: 12 }}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addIssue();
                  }}
                />
              </div>
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
