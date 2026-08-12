// Help dialog (ui-parity §10.9) — static reference; the Visual Legend table is
// the color contract. Footer shows the app version.

import type { ReactNode } from 'react';
import { Modal } from '../components/Modal';

const VERSION = 'v0.1.0';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Swatch({ color, shape = 'dot' }: { color: string; shape?: 'dot' | 'square' | 'star' }) {
  if (shape === 'star') {
    return (
      <span aria-hidden style={{ color, fontSize: 14, lineHeight: 1 }}>
        ★
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: shape === 'dot' ? '50%' : 3,
        background: color,
        verticalAlign: 'middle',
      }}
    />
  );
}

const legendRows: Array<{ swatch: ReactNode; meaning: string }> = [
  { swatch: <Swatch color="#FFD700" shape="star" />, meaning: 'Starred issue — floats to the top of lists.' },
  { swatch: <Swatch color="#D3D3D3" shape="star" />, meaning: 'Not starred.' },
  { swatch: <Swatch color="#10B981" />, meaning: 'Updated within the last 2 days.' },
  { swatch: <Swatch color="#F59E0B" />, meaning: 'Updated 3–6 days ago.' },
  { swatch: <Swatch color="#EF4444" />, meaning: 'Updated 7+ days ago (stalling).' },
  {
    swatch: <span style={{ color: '#EF4444', fontWeight: 700, fontSize: 12 }}>N / Cap</span>,
    meaning: 'Red column count — over the WIP limit.',
  },
  { swatch: <Swatch color="#4F46E5" shape="square" />, meaning: 'Indigo bar — Original Estimate.' },
  { swatch: <Swatch color="#10B981" shape="square" />, meaning: 'Emerald bar — logged under the estimate.' },
  { swatch: <Swatch color="#F43F5E" shape="square" />, meaning: 'Rose bar — logged over the estimate.' },
  { swatch: <Swatch color="#10C860" shape="square" />, meaning: 'Heatmap: darker green = more hours logged.' },
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      width={960}
      maxHeight={780}
      onClose={onClose}
      title="Help"
      footer={
        <div className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
          JiraWeb {VERSION}
        </div>
      }
    >
      <Section title="Pages">
        Dashboard (KPIs + recently updated), My Work (your issues as kanban/grid), Incidents (sticky incident
        filters), Boards (sprint boards + quick filters), Filters (saved JQL), Recent Updates (change feed), Time
        Spent (worklog reports + timesheet), Dashboards (Jira dashboards), Team (workload per member), Settings.
      </Section>

      <Section title="Visual Legend">
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            {legendRows.map((row, i) => (
              <tr key={i}>
                <td style={{ padding: '4px 14px 4px 0', textAlign: 'center', width: 70 }}>{row.swatch}</td>
                <td style={{ padding: '4px 0' }}>{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Kanban">
        Fixed columns: To Do, In Progress, On Hold, In Review, Done. Drag cards between columns to transition;
        J/K or arrow keys move the selection, Enter opens the issue. The column header shows count / WIP cap.
      </Section>

      <Section title="Charts">
        Value axes always start at 0 with dotted gridlines. The legend sits outside to the top-right. Palette
        order: indigo, cyan, amber, emerald, pink, red, slate.
      </Section>

      <Section title="Issue Details">
        Open any issue key to get details: transitions as buttons (with screens when Jira requires fields), log
        work, comments, worklogs, activity timeline and every custom field. ◀/▶ navigate the in-dialog history.
      </Section>

      <Section title="Top Bar">
        + Create Incident opens the create dialog (ISW / Incident). The pomodoro widget tracks time on a picked
        issue and logs it when stopped (≥ 1 minute). Refresh clears server caches and reloads.
      </Section>

      <Section title="Cmd-K Palette">
        Ctrl+K (or Ctrl+L) opens the palette: navigation entries, live Jira search by key or summary, and your
        recent issues. Enter opens the first result; Esc closes.
      </Section>

      <Section title="Sidebar">
        Navigation plus pinned boards and your 3 most recent issues.
      </Section>

      <Section title="User Picker">
        Type to search users (substring, up to 50 results). Enter in the box commits the raw text; Enter in the
        list commits the selection; ✕ clears the filter.
      </Section>

      <Section title="Worklog Reminder">
        After 17:00, if you logged less than 6 hours today, a toast reminds you once per day.
      </Section>

      <Section title="Data Grids">
        Click headers to sort, drag edges to resize. Right-click a header for column visibility and Export to
        CSV (visible columns, display order, UTF-8).
      </Section>

      <Section title="Persistence">
        Grid layout is stored per view in the browser. Settings, starred issues, saved filters, teams and pinned
        boards are stored server-side.
      </Section>

      <Section title="Backup">
        All server state lives in %APPDATA%\JiraWeb (config.json + jiraweb.db) — copy that folder to back up.
      </Section>

      <Section title="Recent Updates">
        Shows issues whose status, assignee or content changed since the last snapshot, with a change summary
        per row.
      </Section>

      <Section title="Keyboard Shortcuts">
        Ctrl+K / Ctrl+L — command palette · Esc — close dialog · J/K or ↑/↓ — move kanban selection · Enter —
        open selected issue · F1 — this help.
      </Section>
    </Modal>
  );
}
