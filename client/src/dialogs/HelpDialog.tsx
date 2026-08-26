// Help dialog — the full feature guide for Mission Control: every page,
// action and shortcut across Jira, TestRail, Confluence, Lumo, alerts and
// the editors. The Visual Legend table remains the color contract.

import { useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';

const VERSION = 'v1.1';

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

const TABS = ['Jira', 'Traceability', 'TestRail', 'Confluence', 'Lumo (AI)', 'Alerts', 'Setup & Data', 'Editors & Drafts', 'Shortcuts & Legend'] as const;
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
        <Item name="Backlog">
          your issues as kanban or grid. Search and filter by updated window or column, then use the compact risk
          chips for Blocked, Critical, Unassigned, Stale 7d and Changed. Shift-click table headers for multi-sort.
          Save named monitoring views, delete or reapply them later, and copy a share link that includes the current
          search, risk and filters. Saved JQL queries also support JSON import/export.
        </Item>
        <Item name="Bulk operations (Backlog table)">
          Select rows like in Explorer — click one, <b>Ctrl+Click</b> to add/remove, <b>Shift+Click</b> for a
          range — then right-click any selected row: <b>Bulk change status</b> (type the target status, matched
          per issue), <b>Bulk assign</b> (searchable user picker), bulk add comment, bulk add label, open all,
          copy keys.
        </Item>
        <Item name="Incidents">sticky quick/dropdown filters, removable active-filter chips, summary search, separate all/verification/rejected grids and Jira dashboard links.</Item>
        <Item name="Boards">search and pin Jira boards; pinned boards open as sprint Kanban with Jira quick filters or the full board backlog.</Item>
        <Item name="JQL search (⚡ in the top bar)">saved JQL filters with an editor and results preview — available from every page.</Item>
        <Item name="Time Spent">worklog reports by period/sprint/range, weekly timesheet, Calendar/Epics/Sprint tabs, CSV + PDF export.</Item>
        <Item name="Team">create saved teams, compare workload and logged/remaining hours, and double-click a member for their issue detail.</Item>
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

function TraceabilityTab() {
  return (
    <>
      <Section title="From QA task to release epic">
        Enter the QA task/ISW key and select <b>Inspect</b>. Mission Control follows the Jira parent chain to the
        epic; the hierarchy links open in the in-app issue dialog. It then collects documents linked through the
        epic's SWR, DR, Integration and UX fields or linked Jira document issues, TestRail cases that reference the
        epic, and TestRail runs whose name or references contain the epic key.
      </Section>
      <Section title="Readiness percentage — exactly what it means">
        The score has four equal checks, each worth <b>25%</b>: Epic complete + at least one linked TestRail case +
        at least one matching TestRail execution run + at least one resolved Confluence page. Loading tiles are
        still pending and do not count as ready. This is a traceability checklist, not a test pass-rate or quality
        prediction.
      </Section>
      <Section title="Release cockpit tabs">
        <Item name="Overview">compact lists of linked cases, execution runs and documents; links stay inside Mission Control.</Item>
        <Item name="Coverage">requirement → documentation → test design → execution matrix, with the exact missing link.</Item>
        <Item name="Actions">prioritized gaps such as no owner, stale epic, missing coverage/documents/runs, failed, blocked or untested results.</Item>
        <Item name="Impact">linked Jira issues, documents and tests that may be affected by a change.</Item>
      </Section>
      <Section title="Watchlist">
        Select <b>Watch epic</b> to keep its last score, status and evidence counts in the Impact tab. Inspect a
        watched epic again to refresh its compact daily-review snapshot. The watchlist is stored on this PC.
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
        Project and suite pickers, full run/plan history, free-text search and My runs. Compact risk filters show
        Active, Failing, Blocked, Untested and Low pass-rate runs; table headers support multi-sort. Create or edit
        a run with name, description, references, assignee and Include all / Select specific / Dynamic filtering.
      </Section>
      <Section title="Run execution">
        Live status tiles + pass rate over all tests, execution progress bar, per-test quick marks (✓ ✗ ⊘ ↻) with
        Undo, bulk marking, result-with-details dialog, per-test history, filters by status/assignee/"My tests".
      </Section>
      <Section title="Reports">
        <Item name="Overview">active/completed execution, result distribution and recent run progress by suite.</Item>
        <Item name="Compare runs">case-level regressions, fixes, unchanged failures and additions/removals between two runs.</Item>
        <Item name="Failure triage">failed/blocked/retest queue with text, status and defect filters; open the case or run directly.</Item>
      </Section>
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
        Lumo is Mission Control's personal AI assistant (✦ button). Its self-contained knowledge pack covers all
        installed press series, cluster HW/SW configuration, release notes, code/system knowledge and indexed
        TestRail/Confluence material. When connected, it can also search live Jira, TestRail and Confluence.
      </Section>
      <Section title="Fast paths">
        Cluster/HW/SW questions answer in seconds from live data ("Show all changes for kedem cluster C16").
        Document and press-specification requests search the local databases first. If an answer is not documented
        locally, Lumo searches Confluence automatically. Source cards open in Mission Control so you can verify the
        Jira issue, Confluence page or TestRail item behind an answer.
      </Section>
      <Section title="Context bar">
        The picker above the input pins a program / cluster / HW-SW scope so follow-up questions inherit it.
      </Section>
      <Section title="Model, privacy and offline use">
        With external sharing enabled, Lumo uses GitHub Copilot's <b>Claude Sonnet 5</b> profile with a 1M context
        tier and medium reasoning. Settings → Connections provides the in-app Copilot device-flow login. External
        sharing is explicit: when off, Lumo uses the bundled local Ollama model and does not send work data to the
        external provider. The local model is useful offline but is less capable than Sonnet.
      </Section>
      <Section title="Verify its brain">
        Settings → AI Assistant → <b>Verify Lumo knowledge</b> checks every bundled database and brain file,
        embedding coverage, self-containment, and the live Jira/TestRail/Confluence connections.
      </Section>
    </>
  );
}

function AlertsTab() {
  return (
    <>
      <Section title="Windows alerts (work even when the app is closed)">
        Settings → Alerts &amp; Reminders. All fire as native Windows toasts via scheduled tasks, including while on
        battery; Windows also starts a missed reminder after sleep or downtime:
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

function SetupDataTab() {
  return (
    <>
      <Section title="Connections">
        Settings keeps every connection in one place: Jira email + PAT, TestRail API key (the Jira email is reused
        by default), Confluence PAT, and GitHub Copilot device login. Test or disconnect services individually.
        Saved Jira, TestRail and Confluence credentials are encrypted for the current Windows user with DPAPI and
        are never included in an installer copied to another press.
      </Section>
      <Section title="Preferences & dashboard">
        Choose Dark, Light or Railbook theme; enable auto-refresh, choose its interval and pause it while minimized;
        set the default Jira project; enable, disable and reorder Dashboard widgets. Use the single Save button at
        the bottom to keep these settings.
      </Section>
      <Section title="Diagnostics & cleanup">
        Data → <b>Run diagnostics</b> checks Jira, TestRail and Confluence with latency. Clear only Jira issues, all
        server caches, or browser-local drafts/layouts/filter snapshots separately. <b>Disconnect all services</b>
        removes credentials but keeps cached work data. Destructive choices always show a confirmation.
      </Section>
      <Section title="Offline one-click installation">
        MissionControlSetup.exe installs per user without an administrator prompt, can add desktop/startup entries,
        and bundles the app, Node runtime, production dependencies, Lumo databases/brain, Ollama, embeddings and a
        local chat model. It can be installed without internet; each press still needs its own Jira, TestRail,
        Confluence and optional Copilot credentials for live services.
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
        CSV export. Where shown, Shift-click adds secondary sort columns.
      </Section>
    </>
  );
}

function ShortcutsTab() {
  return (
    <>
      <Section title="Keyboard">
        <Item name="Ctrl+K / Ctrl+L">command palette — navigate; search Jira, Confluence and TestRail; reopen recent issues.</Item>
        <Item name="F1">this help.</Item>
        <Item name="Esc">closes any dialog / drawer / full-screen page.</Item>
        <Item name="Enter">opens the selected palette row; J/K or arrows move kanban selection.</Item>
      </Section>
      <Section title="Top bar">
        + Create Incident · pomodoro timer (logs the elapsed time to the picked issue when stopped) · 🔍 palette ·
        ⚡ JQL search · ✦ Lumo · 🔔 notifications · theme cycle (dark / light / railbook) · Refresh (clears server caches).
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
      {tab === 'Traceability' ? <TraceabilityTab /> : null}
      {tab === 'TestRail' ? <TestRailTab /> : null}
      {tab === 'Confluence' ? <ConfluenceTab /> : null}
      {tab === 'Lumo (AI)' ? <LumoTab /> : null}
      {tab === 'Alerts' ? <AlertsTab /> : null}
      {tab === 'Setup & Data' ? <SetupDataTab /> : null}
      {tab === 'Editors & Drafts' ? <EditorsTab /> : null}
      {tab === 'Shortcuts & Legend' ? <ShortcutsTab /> : null}
    </Modal>
  );
}
