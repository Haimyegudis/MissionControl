# Time Spent Scope-First Redesign + Editable Timesheet — Design

**Date:** 2026-08-26
**Status:** REVERTED 2026-08-26 — the user rejected the scope-first layout after trying it. The original tab layout was restored; only the editable weekly timesheet (inside the Report tab) survives, per the follow-up request.

## Problem

The view accumulated three competing time controls (period chips, timesheet week
arrows, sprint chip + dropdown) and four tabs that re-slice the same worklogs with
separate controls. And logging requires a dialog — the user wants to type hours
directly into the weekly timesheet.

## Design

### One scope, many presentations

Top scope bar (replaces period chips AND the Report/Calendar/Epics/Sprint tabs):

```
[Day] [Week] [Month] [Sprint] [Custom]   ◀  <window label>  ▶   [Today]   [user ▾]   [⬇ CSV] [⬇ PDF]
view: [Timesheet] [Summary] [Epics] [Calendar*] [Board**]
```

- **Day**: one day; arrows ±1 day. Covers old Today/Yesterday.
- **Week**: Sunday-first week; arrows ±7 days.
- **Month**: calendar month; arrows ±1 month.
- **Sprint**: current + recent sprints (`availableSprints`); arrows step the list;
  label = sprint name + dates.
- **Custom**: from/to date inputs, `to` inclusive.
- Scope + user select the DATA (one fetch); the `view:` row only changes presentation.
- Data fetch: Day/Week/Month/Custom → `timelogged.range(from, toExclusive, user?)`
  (worklogAuthor query); Sprint → `timelogged.sprint(name, user?)`.
- \*Calendar view offered when scope is Month (the existing month grid).
- \*\*Board view offered when scope is Sprint (the existing bars + Start + Log rows).

### Views

- **Timesheet** (default, now editable — see below). Columns = the window's days
  (Day: 1 col; Week/Sprint/Custom: all days, horizontally scrollable past 7).
  Month scope defaults to the Calendar view instead (a 31-column sheet is unusable).
- **Summary**: existing hero total + per-status chips + logged-only issues list with
  the Estimated↔Logged bar and per-row Log button. Reused as-is.
- **Epics**: existing epic grouping, but driven by the scope window ("days back"
  input is removed — the scope bar decides).
- **Calendar** (Month scope): existing month grid with sprint tint/today outline.
- **Board** (Sprint scope): existing SprintTab content (Estimated/Logged/Remaining
  bars, Start, + Log).

### Editable timesheet

- **Rows**: issues with logged time in the window, PLUS the signed-in user's
  current-open-sprint issues (empty rows ready for typing), PLUS an "add issue" row:
  an input accepting an issue key (e.g. `ISW-1234`), validated via `issues.details`,
  which adds a row for this session.
- **Cells** (add-only semantics — Jira cannot reduce logged time):
  - Empty cell: focus + type (`2`, `1.5`, `2h 30m` — `parseJiraTime`, plain numbers
    = hours) → Enter/blur logs via existing `POST /api/issues/:key/worklogs`
    (`started` = that day 12:00 local, `adjustEstimate: 'auto'`), then the report
    refreshes.
  - Filled cell: shows the day total; click opens a small inline "+ add" popover with
    the same input, appending a new worklog.
  - Errors surface as a toast; the cell reverts.
- **Read-only** when the user picker is set to someone else (the server logs as the
  session user, so editing another user's sheet would misattribute time).
- Totals row and per-row totals recompute from the refreshed report.

### Removals / migrations

- Old tabs (`Calendar`, `Epics`, `Sprint`) and the period chips + sprint chip are
  removed from `TimeLoggedView`; their components are reused by the new views
  (CalendarTab/EpicsTab get `from`/`to`-style props instead of self-managed state
  where needed; SprintTab becomes the Board view fed by the scope's sprint).
- The standalone timesheet week arrows disappear (the scope bar navigates).
- HelpDialog's Time Spent line updates to describe scope bar + views.
- Mobile screens untouched.

## Out of scope

- Editing/deleting existing worklogs (Jira remove-worklog API — later).
- Logging on behalf of another user.
- Persisting manually-added timesheet rows across sessions.

## Testing

Pure logic in `client/src/lib/viewTimeSpentScope.ts`: scope window math
(day/week/month/custom incl. inclusive-to), scope stepping, timesheet row assembly
(merge logged + sprint + manual rows, dedupe, ordering), cell input parsing
(plain-number-hours rule). Component render tests (`renderToString`): scope bar
renders all scopes, view toggles render, read-only timesheet for foreign user.
Server/core: no changes expected (existing endpoints suffice).
