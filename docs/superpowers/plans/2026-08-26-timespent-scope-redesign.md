# Time Spent Scope-First Redesign Implementation Plan

> **REVERTED 2026-08-26** — implemented, deployed, rejected by the user; commits reverted. Kept for history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Time Spent period chips + four tabs with one scope bar (Day/Week/Month/Sprint/Custom + arrows + user) and presentation views (Timesheet/Summary/Epics/Calendar/Board), and make the timesheet cells directly log work (add-only).

**Architecture:** New pure module `client/src/lib/viewTimeSpentScope.ts` owns scope-window math, stepping, editable-row assembly, and cell-input parsing. `TimeLoggedView` shrinks to: scope state + one fetch + view switch. New `client/src/views/timespent/EditableTimesheet.tsx` renders the grid and calls the existing worklog POST. Existing CalendarTab/EpicsTab/SprintTab are re-parametrized (props in, self-managed windows out). No server/core changes.

**Tech Stack:** TypeScript, React, Vitest; client workspace only.

**Spec:** `docs/superpowers/specs/2026-08-26-timespent-scope-redesign-design.md`

## Global Constraints

- Tests `npm run test --workspace client`; typecheck `npx tsc -p client/tsconfig.json --noEmit` (noUnusedLocals — remove imports you orphan).
- Existing endpoints only: `timelogged.range(from, toExclusive, user?)`, `timelogged.sprint(name, user?)`, `issues.addWorklog`, `issues.details`, `issues.search`.
- Reuse `parseJiraTime`, `formatTimeSpan`, `hoursDisplay`, `statusColor`, `dialogs.*`, `pushToast`, `loggedOnlyIssues`, `groupByEpic`, `buildCalendarMonth`, `sprintBars` — do not duplicate logic.
- Editable cells only when the user picker is empty (self); otherwise the grid is read-only.
- `renderToString` markup tests only for components; interaction logic lives in the pure lib.
- Component/state naming: scope ids `'day' | 'week' | 'month' | 'sprint' | 'custom'`; view ids `'timesheet' | 'summary' | 'epics' | 'calendar' | 'board'`.

---

### Task 1: Pure scope logic — `viewTimeSpentScope.ts`

**Files:**
- Create: `client/src/lib/viewTimeSpentScope.ts`
- Test: `client/test/viewTimeSpentScope.test.ts`

**Interfaces (later tasks import exactly these):**

```ts
export type ScopeId = 'day' | 'week' | 'month' | 'sprint' | 'custom';
export type ViewId = 'timesheet' | 'summary' | 'epics' | 'calendar' | 'board';

export interface ScopeWindow {
  /** yyyy-MM-dd inclusive start */ from: string;
  /** yyyy-MM-dd EXCLUSIVE end */ to: string;
  /** e.g. "Wed 26 Aug 2026", "Aug 23 – Aug 29, 2026", "August 2026" */ label: string;
}

/** Window for a scope anchored at `anchor` (any date inside the window). Custom uses the inclusive customTo. */
export function scopeWindow(scope: Exclude<ScopeId, 'sprint'>, anchor: Date, customFrom: string, customTo: string): ScopeWindow;

/** New anchor after stepping ±1 unit (day/week/month). Custom/sprint anchors don't step here. */
export function stepAnchor(scope: 'day' | 'week' | 'month', anchor: Date, dir: 1 | -1): Date;

/** Views legal for a scope: month adds 'calendar', sprint adds 'board'; timesheet hidden for month. */
export function viewsForScope(scope: ScopeId): ViewId[];

/** Day columns of a window, capped at 62. */
export function windowDays(window: { from: string; to: string }): string[]; // yyyy-MM-dd list

export interface EditableRow {
  key: string;
  summary: string;
  /** hours per day, aligned with windowDays */ hours: number[];
  totalHours: number;
  /** true when the row came from the sprint fallback or manual add (no logs yet) */ empty: boolean;
}

/** Merge logged issues (report) + sprint issues + manual keys into ordered rows. */
export function buildEditableRows(
  days: string[],
  report: { issues: JiraIssue[]; dailyByIssue: DailyLogEntry[] } | null,
  sprintIssues: readonly JiraIssue[],
  manual: readonly { key: string; summary: string }[],
): EditableRow[];

/** '2' | '1.5' → hours; '2h 30m' → parseJiraTime. Returns seconds or null. */
export function parseCellInput(raw: string): number | null;
```

Rules encoded (write tests first for each):
- `scopeWindow('day', …)` = [anchor, anchor+1); `'week'` = Sunday-first 7 days; `'month'` = calendar month; `'custom'` = [customFrom, customTo+1) (inclusive to).
- Labels: day `formatDayLong`-style; week `"23 Aug – 29 Aug 2026"`; month `"August 2026"`; custom `"01 Aug – 10 Aug 2026"` (exact formats your choice — pin them in tests).
- `buildEditableRows`: logged rows first (sorted by key), then sprint-only rows (sorted by key, `empty: true`), then manual rows; dedupe by key (logged wins); hours from `dailyByIssue` summed per (day, key)/3600.
- `parseCellInput`: `''`/garbage → null; plain number (int or decimal, 0 < n <= 24) → hours→seconds; otherwise `parseJiraTime`; result must be > 0 else null.
- `windowDays` caps at 62 entries (guards absurd custom ranges).

Steps: write failing tests (cover every rule above with concrete dates — reuse the date-fixture style of `client/test/viewTimeSpentTabs.test.ts`), see them fail, implement, `npm run test --workspace client -- viewTimeSpentScope`, full suite, tsc, commit:

```bash
git add client/src/lib/viewTimeSpentScope.ts client/test/viewTimeSpentScope.test.ts
git commit -m "feat(client): scope-window logic for Time Spent redesign"
```

---

### Task 2: Scope bar + view switch in TimeLoggedView

**Files:**
- Modify: `client/src/views/TimeLoggedView.tsx` (read fully first — it holds the old period chips, sprint chip + select, tabs, timesheet week arrows)
- Modify: `client/src/views/timespent/CalendarTab.tsx`, `EpicsTab.tsx`, `SprintTab.tsx` (props re-parametrization)
- Modify: `client/src/dialogs/HelpDialog.tsx` (Time Spent line)
- Test: `client/test/timeSpentTabs.test.tsx` (adapt), `client/test/viewsSmoke.test.tsx` (adapt)

**Interfaces:**
- Consumes Task 1's `scopeWindow`, `stepAnchor`, `viewsForScope`.
- Produces new props: `CalendarTab({ year, month, user, onNavigate? })` → drop its internal month state, parent owns it (Month scope anchor); `EpicsTab({ from, to, user })` → drop the days-back input and internal fetch window (keep its own fetch, using the given window); `SprintTab({ sprintName, user })` → fetch by given sprint instead of openSprints JQL when `sprintName` non-empty (JQL `sprint = "<name>"` via `sprintJql`-style quoting — extend `sprintJql(project, resolvedUser, sprintName?)`).

**Behavior:**
- State: `scope` (default `'week'`), `anchor` (Date, default today), `customFrom/customTo`, `sprintName` (default `''` = active), `view` (default `'timesheet'`, coerced to a legal view on scope change via `viewsForScope`).
- One fetch per (scope, anchor, custom, sprintName, user): non-sprint → `timelogged.range(window.from, window.to, user?)`; sprint → `timelogged.sprint(sprintName, user?)` (label from report `fromUtc/toUtc` + name; `availableSprints` feeds ◀ ▶ stepping and a `<select>`).
- Scope bar row exactly per spec ASCII (chips, ◀ label ▶, Today, user picker, CSV/PDF). Second row = view chips from `viewsForScope`.
- Summary view = the existing hero + status chips + logged-only issues panel JSX (move into a local `<SummaryView>` function component in the same file; do not change its internals).
- Timesheet view: THIS task renders the existing read-only `buildTimesheet` grid fed from the scope window's report (weekStart = window.from for week scope; for other scopes render the same grid over `windowDays` — if the old component is week-locked, render a simple table: rows = report issues, cols = windowDays, cells = hours; Task 3 replaces it with the editable grid, so keep this minimal).
- Epics view = `<EpicsTab from={window.from} to={window.to} user={userFilter} />`.
- Calendar view (month scope) = `<CalendarTab year={anchorYear} month={anchorMonth} user={userFilter} />`.
- Board view (sprint scope) = `<SprintTab sprintName={selectedSprint} user={userFilter} />`.
- Delete: period chips array, sprint chip/dropdown block, old tab strip, timesheet week arrows, `periodRange` usage (leave the lib function; other callers may exist — check; if none besides this view, delete it and its tests).
- CSV/PDF keep working from the current report (period label in the export header becomes the scope label).

Steps: adapt tests first (update smoke/render assertions to scope-bar strings: "Day", "Week", "Month", "Sprint", "Custom", "view:"), implement, full suite + tsc, commit:

```bash
git add client/src/views/TimeLoggedView.tsx client/src/views/timespent/*.tsx client/src/dialogs/HelpDialog.tsx client/test/timeSpentTabs.test.tsx client/test/viewsSmoke.test.tsx client/src/lib/viewTimeLogged.ts client/test/viewTimeLogged.test.ts
git commit -m "feat(client): scope-first Time Spent with view switcher"
```

---

### Task 3: Editable timesheet

**Files:**
- Create: `client/src/views/timespent/EditableTimesheet.tsx`
- Modify: `client/src/views/TimeLoggedView.tsx` (swap the minimal grid for the new component)
- Test: `client/test/editableTimesheet.test.tsx` (create)

**Interfaces:**
- Props: `EditableTimesheet({ days, report, sprintIssues, user, onLogged }: { days: string[]; report: TimeLoggedReport | null; sprintIssues: JiraIssue[]; user: string; onLogged: () => void })`.
- Consumes Task 1's `buildEditableRows`, `parseCellInput`; `issues.addWorklog`, `issues.details`.
- `sprintIssues`: TimeLoggedView fetches once per session/user via `issuesApi.search(sprintJql(project, resolvedUser), 0, 100)` when the picker is self (reuse SprintTab's resolve logic — extract a tiny shared helper if needed).

**Behavior:**
- Grid: sticky first column (key + truncated summary, click → issue details), one column per day (header `Su 23`-style), totals row and per-row total column.
- Cell rendering: hours > 0 → `4.0` with a click-to-open inline "+ add" mini-popover (input + Add/Cancel); zero/empty AND `user` self → borderless `<input>` accepting `parseCellInput` grammar, committing on Enter/blur, Escape cancels.
- Commit flow: `await issuesApi.addWorklog(key, { seconds, started: new Date(day + 'T12:00:00').toISOString() })`; success → toast `ISW-1 · 2h logged on 26 Aug` + `onLogged()` (parent refetches report); failure → toast error + revert.
- Busy cell state while posting (disable input).
- Add-issue row at the bottom: key input (uppercase-normalized, `/^[A-Z][A-Z0-9_]*-\d+$/`), on Enter → `issues.details(key)` → adds `{key, summary}` to local `manual` list (toast on invalid/error).
- `user` non-self → plain text everywhere, no inputs, no add row.
- Tests (`renderToString`): self-mode renders inputs + add-issue row; foreign-user mode renders no `<input>`; rows include a sprint-only empty row when sprintIssues has an unlogged issue. Logic-level tests already live in Task 1's lib.

Steps: failing tests → implement → wire into TimeLoggedView (replace the Task 2 placeholder grid) → full suite + tsc → commit:

```bash
git add client/src/views/timespent/EditableTimesheet.tsx client/src/views/TimeLoggedView.tsx client/test/editableTimesheet.test.tsx
git commit -m "feat(client): editable timesheet — type hours to log work"
```

---

### Task 4: Sprint stepping polish + dead-code sweep

**Files:**
- Modify: `client/src/views/TimeLoggedView.tsx`, `client/src/views/timespent/SprintTab.tsx`
- Test: existing suites

**Behavior:**
- Sprint scope: `availableSprints` list drives ◀ ▶ (clamped at ends) + `<select>`; changing sprint refetches; label `"<name> · 23 Aug – 10 Sep"`.
- Verify Month↔Calendar and Sprint↔Board coercion round-trips (switching scope away and back keeps a legal view).
- Sweep: no remaining references to removed periods/tabs (`grep -rn "previousWeek\|thisMonth\|'customRange'" client/src` — the timelogged API literal may legitimately remain in `client.ts` types; view code should not use it), no unused exports left in `viewTimeLogged.ts` (delete `periodRange` if orphaned), HelpDialog text final.
- Full suite + tsc + `npm run build` (all workspaces). Commit:

```bash
git add -u client/src client/test
git commit -m "feat(client): sprint stepping and scope redesign cleanup"
```

(`git add -u` limited to client/src + client/test is acceptable here ONLY because every change in this task is confined to those trees; verify `git status` first — unrelated WIP files (testrail, android, mobile) must not be staged.)

---

## Final verification

- [ ] `npm test` (root) all green; `npm run build` clean.
- [ ] Manual smoke: scope chips switch windows; arrows step; sprint scope lists sprints; typing `2` into an empty timesheet cell logs 2h and the grid + totals refresh; filled cell "+ add" appends; foreign user → read-only; Epics/Calendar/Board views track the scope.
