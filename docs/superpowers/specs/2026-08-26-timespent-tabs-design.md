# Time Spent Tabs: Calendar, Epics, Sprint — Design

**Date:** 2026-08-26
**Status:** Approved

## Problem

Time Spent shows period reports only. The user wants (modeled on the "Jira Worklog
Manager" reference app): a month calendar of logged work per day with the current sprint
range highlighted; an epic-grouped view of work logged in the last X days; and a
current-sprint board of issues with Estimated/Logged/Remaining bars plus a one-click
"Start" (To Do → In Progress). All views default to the signed-in user but follow the
existing user picker so anyone's logs/work can be inspected.

## Design

### Tabs

`TimeLoggedView` gets a tab strip under its header: **Report | Calendar | Epics |
Sprint**. Report is the existing content, untouched (hero strip, issues panel, weekly
timesheet, 13-week heatmap stay as-is — the month calendar complements the weekly
timesheet, it does not replace it). The period chips stay Report-only; the user picker
moves next to the tabs and applies to every tab. Each tab fetches its own data on first
open (and on user change). New tabs reuse the existing building blocks: `statusColor`,
`hoursDisplay`/`formatTimeSpan`, `dialogs.openIssueDetails`/`openTransition`,
`UserSearchPicker`, card styles.

### Data (no new server endpoints)

- Calendar + Epics: existing `timelogged.report('customRange', { from, to, user })`.
- Sprint tab: existing `issues.search` with JQL
  `project = <defaultProject> AND sprint in openSprints() AND assignee = <user>`
  (assignee = currentUser() when the picker is on "me").
- Current-sprint date range: from loaded issues' `allSprints` — first entry with
  `state === 'active'` and non-null dates.
- Epic grouping: `epicKey`/`epicName` already present on `JiraIssue`.

### Calendar tab

- Month navigation: ◀ Previous / month title / Next ▶ / Today.
- Fetch the visible month (1st → last day) as a customRange report.
- 7-column grid (Sun–Sat). Day cell: day number; up to 3 lines `KEY: 4.0h`
  (click → issue details dialog); `+n more` overflow; `Total: 8.0h` when > 0.
- Cells inside the active sprint's [startDate, endDate] get a tinted background;
  today gets a stronger highlight. Legend line under the grid.

### Epics tab

- "Days back" numeric input, default 30 (clamped 1–365). Fetch customRange report
  (today−X → today, chosen user).
- Group report issues by `epicKey`; issues without an epic go to a trailing
  "No epic" group. Per group card: epic name + key (key click → issue details),
  rows of logged issues (`KEY summary — 12.5h`), footer
  `Total: 52.00 hours (6.50 days @ 8h/day)`. Groups sorted by total desc.

### Sprint tab

- Rows for each fetched sprint issue: key, summary, status pill, and a 3-bar block —
  Estimated / Logged / Remaining (hours; bars scaled to the row's max value, colors:
  blue / green / red like the reference app; zero-value bars render as thin baseline).
- Issues in status category `new` (To Do) get a **Start** button:
  1. `issues.transitions(key)` → pick the first transition whose `toStatus` equals
     "In Progress" (case-insensitive); fall back to the first whose `toStatus` or
     name contains "progress". (`JiraTransition` carries `toStatus` only — no
     category — per `client/src/types.ts:72`.) No match → toast "No transition to
     In Progress available."
  2. Fetch its screen; if no required fields → `issues.performTransition` directly,
     then refresh the row. If the screen has required fields → open the existing
     Transition dialog (same flow as elsewhere), refresh on done.
- Sprint header: sprint name + date range when known.

## Out of scope

- Mobile screens (desktop view only; MobileTimeSpent unchanged).
- Editing/dragging worklogs in the calendar.
- Fetching epic children the user did not log (Epics tab shows logged issues only).
- New server/core endpoints.

## Testing

Pure logic extracted to `client/src/lib/viewTimeSpentTabs.ts` and unit-tested:
calendar month-grid assembly from `dailyByIssue` (day cells, totals, overflow),
active-sprint range resolution from issues, epic grouping + totals + sorting,
sprint-bar scaling, and transition picking (`indeterminate` category first, name
fallback). View-level render tests via `renderToString`: tab strip renders, each
tab's empty state renders.
