// Help dialog — the full feature guide for Mission Control: every page,
// action and shortcut across Jira, TestRail, Confluence, Lumo, alerts and
// the editors. The Visual Legend table remains the color contract.

import { useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';

const VERSION = 'v1.0';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Item({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <b>{name}</b> — {children}
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
  { swatch: <Swatch color="#10B981" />, meaning: 'Updated within the last 2 days.' },
  { swatch: <Swatch color="#F59E0B" />, meaning: 'Updated 3–6 days ago.' },
  { swatch: <Swatch color="#EF4444" />, meaning: 'Updated 7+ days ago (stalling).' },
  { swatch: <Swatch color="#22d38f" shape="square" />, meaning: 'TestRail: Passed.' },
  { swatch: <Swatch color="#e5484d" shape="square" />, meaning: 'TestRail: Failed.' },
  { swatch: <Swatch color="#e8890c" shape="square" />, meaning: 'TestRail: Blocked.' },
  { swatch: <Swatch color="#ffd23a" shape="square" />, meaning: 'TestRail: Retest.' },
  { swatch: <Swatch color="#8aa0bf" shape="square" />, meaning: 'TestRail: Untested.' },
  { swatch: <Swatch color="#b558f6" shape="square" />, meaning: 'Issue-type chip: Epic (green Story, red Bug, blue Task).' },
];

const TABS = ['Jira', 'TestRail', 'Confluence', 'Lumo (AI)', 'Alerts', 'Editors & Drafts', 'Shortcuts & Legend'] as const;
type Tab = (typeof TABS)[number];

function JiraTab() {
  return (
    <>
      <Section title="Pages">
        <Item name="Dashboard">
          Clickable KPI cards (Open / Critical / On Hold / Updated Today / Logged Today / Logged This Week) — click
          any card to see the exact issues and per-day logged time behind the number. Below: your current sprint as
          Kanban (drag cards to transition; right-click a column header to set a WIP limit) or a table. The user
          picker shows any teammate's sprint.
        </Item>
        <Item name="Backlog">your issues as kanban or grid, saved queries (with JSON import/export), bulk actions on multi-selected rows.</Item>
        <Item name="Bulk operations (Backlog table)">
          Select rows like in Explorer — click one, <b>Ctrl+Click</b> to add/remove, <b>Shift+Click</b> for a
          range — then right-click any selected row: <b>Bulk change status</b> (type the target status, matched
          per issue), <b>Bulk assign</b> (searchable user picker), bulk add comment, bulk add label, open all,
          copy keys.
        </Item>
        <Item name="Incidents">sticky incident filters with dashboard links.</Item>
        <Item name="Boards">sprint boards with Jira quick filters.</Item>
        <Item name="JQL search (⚡ in the top bar)">saved JQL filters with an editor and results preview — available from every page.</Item>
        <Item name="Time Spent">worklog reports by period/sprint/range, weekly timesheet, 13-week heatmap, CSV + PNG export.</Item>
        <Item name="Team">workload and logged hours per member of a saved team.</Item>
      </Section>
      <Section title="Issue dialog">
        Open any issue key (click, double-click or the palette). Transitions run as buttons — when Jira needs
        fields a form opens. Log work, comments, worklogs, activity timeline (collapsed by default), every custom
        field (Time in Status is decoded to readable durations), ◀/▶ history navigation, Copy key, Open in Jira.
        <br />
        <b>TestRail panel</b>: donut chart of linked-run results, per-run progress bars with a "Run N" button for
        unexecuted tests, one-click run creation from the linked cases (scoped by the issue's Program), and the
        linked cases deep-linking into the Case Library.
      </Section>
      <Section title="Create Incident">
        The + Create Incident button (top bar) opens the create dialog for your default project (Settings).
        Priority auto-computes from Severity / Environment / Reproducibility. Field defaults can be saved per
        project.
      </Section>
    </>
  );
}

function TestRailTab() {
  return (
    <>
      <Section title="Case Library">
        Suite picker (or ★ All suites), section tree with per-row "+" (top level: add subsection; subsection: add
        case there), search matching title / C-id / steps / section names, owner and assigned-to filters, column
        chooser + drag-resize, section-grouped rows with collapse, CSV export, never-ran coverage check,
        typed-name confirms for deletion.
      </Section>
      <Section title="Bulk operations (Case Library)">
        Check cases with the row checkboxes (header checkbox or a section row's checkbox selects a whole group) —
        the bulk bar appears with: <b>Edit…</b> (set Assigned to / Test case owner via searchable pickers, plus
        Priority and Type — only picked fields change), <b>Copy to…</b> / <b>Move to…</b> (cross-project with
        target search), <b>Export CSV</b> and <b>Delete</b> (typed confirmation for 5+).
      </Section>
      <Section title="Bulk operations (Run execution)">
        In a run, check tests → the bulk bar marks all of them Passed / Failed / Blocked / Retest at once (with
        Undo in the toast), or opens "Result with details…" to record one detailed result for the whole
        selection.
      </Section>
      <Section title="Case editor (WYSIWYG)">
        Bold / italic / code / lists (Enter continues numbering) / tables (any size, add-remove rows and columns) /
        links / text colors and highlights render live. Content saves as TestRail markdown; colors persist as
        {' {color}'} tags (Mission Control renders them, TestRail shows plain marks). Everything you type autosaves
        as a draft — a refresh, crash or accidental close restores it with a banner.
      </Section>
      <Section title="Runs">
        Project picker → runs and plan runs (full history). New run = full TestRail flow: name, description, refs,
        assign-to (defaults to you), Include all / Select specific / Dynamic filtering.
      </Section>
      <Section title="Run execution">
        Live status tiles + pass rate over all tests, execution progress bar, per-test quick marks (✓ ✗ ⊘ ↻) with
        Undo, bulk marking, result-with-details dialog, per-test history, filters by status/assignee/"My tests".
      </Section>
      <Section title="Reports">per-suite distribution and coverage reporting.</Section>
    </>
  );
}

function ConfluenceTab() {
  return (
    <>
      <Section title="Browse & search">
        Space picker (all Indigo spaces), page tree with expand/collapse, full-text search with filters. The
        sidebar hides for a wider page; pages open in-app with Ctrl+wheel zoom and a ⛶ full-screen mode (Esc
        exits).
      </Section>
      <Section title="Create & edit">
        Rich editor with headings, lists, alignment, links, images, tables, layouts, colors, highlights, status
        lozenges, panels, expand sections and task lists. Creating a page lets you pick the exact location: space
        → page tree → any parent. Unsaved edits autosave as drafts and restore on reopen.
      </Section>
      <Section title="Deep links">
        Lumo's Confluence cards and #/confluence/&lt;pageId&gt; URLs open pages directly in-app.
      </Section>
    </>
  );
}

function LumoTab() {
  return (
    <>
      <Section title="What Lumo knows">
        Lumo is the AI assistant (✦ button). It runs on GitHub Copilot CLI with your chosen model and has the full
        Yaki knowledge pack: cluster HW/SW configuration, release notes, Confluence documentation (vector search)
        and live Jira access.
      </Section>
      <Section title="Fast paths">
        Cluster/HW/SW questions answer in seconds from live data ("Show all changes for kedem cluster C16").
        Document requests return instantly from the knowledge index and open in-app. Everything else goes through
        the full agent with Jira/Confluence tools.
      </Section>
      <Section title="Context bar">
        The picker above the input pins a program / cluster / HW-SW scope so follow-up questions inherit it.
      </Section>
      <Section title="Login">Settings → Connections → Copilot: in-app device-flow login (code + link).</Section>
    </>
  );
}

function AlertsTab() {
  return (
    <>
      <Section title="Windows alerts (work even when the app is closed)">
        Settings → Alerts &amp; Reminders. All fire as native Windows toasts via scheduled tasks:
        <Item name="Log-work reminder">chosen days + time; opens Time Spent.</Item>
        <Item name="In Progress summary">lists your current In Progress tasks live from Jira; silent when empty.</Item>
        <Item name="To Do nudge">reminds you to move waiting tasks to In Progress.</Item>
        <Item name="Specific task alerts">one-time alert for an issue key at a date + time with an optional note.</Item>
      </Section>
      <Section title="In-app notifications">
        Toasts show successes (green edge), errors (red), info (cyan); some carry an Undo button. The 🔔 bell in
        the top bar keeps the full session history with an unread badge. Settings → Notifications: mute all or
        errors-only.
      </Section>
    </>
  );
}

function EditorsTab() {
  return (
    <>
      <Section title="Drafts — nothing gets lost">
        New/edited TestRail cases, sections and Confluence pages autosave while you type. Refresh, timeout, crash
        or accidental close — reopening the same editor restores everything with an "Unsaved draft restored"
        banner and a Discard button. Drafts clear automatically on successful save and expire after 14 days.
      </Section>
      <Section title="Editor dialogs">
        Editors never close from a stray click outside the window — only Cancel, ✕ or Esc.
      </Section>
      <Section title="Data grids">
        Click headers to sort, drag edges to resize (persisted). Right-click a header for column visibility and
        CSV export.
      </Section>
    </>
  );
}

function ShortcutsTab() {
  return (
    <>
      <Section title="Keyboard">
        <Item name="Ctrl+K / Ctrl+L">command palette — navigate, search Jira (with issue-type chips), search loaded TestRail cases, recents.</Item>
        <Item name="F1">this help.</Item>
        <Item name="Esc">closes any dialog / drawer / full-screen page.</Item>
        <Item name="Enter">opens the selected palette row; J/K or arrows move kanban selection.</Item>
      </Section>
      <Section title="Top bar">
        + Create Incident · pomodoro timer (logs the elapsed time to the picked issue when stopped) · 🔍 palette ·
        🔔 notifications · theme cycle (dark / light / railbook) · Refresh (clears server caches).
      </Section>
      <Section title="Visual legend">
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
    </>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Jira');
  return (
    <Modal
      width={960}
      maxHeight={780}
      onClose={onClose}
      title="Help — everything Mission Control does"
      footer={
        <div className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
          Mission Control {VERSION} — Jira · TestRail · Confluence · Lumo
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t}
            className="btn"
            onClick={() => setTab(t)}
            style={
              tab === t
                ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', fontWeight: 700 }
                : undefined
            }
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Jira' ? <JiraTab /> : null}
      {tab === 'TestRail' ? <TestRailTab /> : null}
      {tab === 'Confluence' ? <ConfluenceTab /> : null}
      {tab === 'Lumo (AI)' ? <LumoTab /> : null}
      {tab === 'Alerts' ? <AlertsTab /> : null}
      {tab === 'Editors & Drafts' ? <EditorsTab /> : null}
      {tab === 'Shortcuts & Legend' ? <ShortcutsTab /> : null}
    </Modal>
  );
}
