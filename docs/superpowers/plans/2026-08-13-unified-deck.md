# Deck Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One web app (JiraWeb base, port 5643) containing both Jira and TestRail features with two switchable full themes (Railbook light / Nightdeck dark).

**Architecture:** Express+TS server gains `server/src/testrail/` module (TS port of proven C# client) + `/api/testrail/*` routes + SQLite cache. React client gains `views/testrail/*` at Railbook feature parity. `theme.css` becomes a token sheet driving both themes across every component.

**Tech Stack:** Express 4, better-sqlite3, React 18, Vite 5, vitest. No new dependencies.

## Global Constraints

- Nothing breaks: `npm test` (server+client workspaces) green after every task; standalone TestRailWeb on 5199 stays untouched until final parity check.
- No new npm dependencies.
- Localhost only (127.0.0.1:5643), single user.
- TestRail behaviors preserved exactly (spec table): pagination duplicate-guard, `custom_testcaseowner`, `case_assignedto_id`, plan runs, `get_users&project_id`, `?fresh=1` bypass.
- Theme values: Railbook tokens from `C:\APPS\TestRailWeb\wwwroot\css\app.css` `:root`; Nightdeck tokens = current `client/src/theme.css` dark values.

---

### Phase 1 — Theme tokens (dual themes on existing screens)

- [ ] T1 `client/src/theme.css`: define full token set (`--bg --panel --panel-border --ink --muted --accent --accent-soft --ok --err --warn --info --font-body --font-display --font-mono --radius --shadow --pass --fail --blocked --retest --untested`) under `:root[data-theme="night"]` (current values) and `:root[data-theme="railbook"]` (Railbook values + Google Fonts import with system fallbacks).
- [ ] T2 Sweep `client/src/components/Shell.tsx`, views, dialogs: replace hardcoded colors/fonts in inline styles with `var(--token)`. Grep list: `#0b1430 #050816 #1fe0e0 #e8eefa #8aa0bf rgba(16,26,54` etc.
- [ ] T3 `App.tsx` + Settings: theme values `night|railbook` (migrate stored `dark→night`, `light→railbook`); top-bar toggle button.
- [ ] T4 Verify: vitest green; screenshot both themes on Dashboard/MyWork; commit per task.

### Phase 2 — TestRail server module

- [ ] T5 `server/src/testrail/types.ts` — interfaces: `TrCase{id,title,sectionId,suiteId,priorityId,typeId,createdBy,updatedBy,createdOn,updatedOn,refs,estimate,preconds,steps,expected,ownerId,assignedToId,stepsSeparated[]}`, `TrSuite`, `TrSection`, `TrRun`, `TrTest`, `TrResult`, `TrPlanRun`, `TrStatus`, `TrPriority`, `TrCaseType`, `TrUser`, `TrConnection`.
- [ ] T6 `server/src/testrail/httpClient.ts` — Basic auth, base URL → `…/index.php?/api/v2/`, GET/POST json, error → `TestRailApiError{status,body}`. Vitest with mocked fetch.
- [ ] T7 `server/src/testrail/client.ts` — `getPaged(cmd, prop, {max?})` port of C# dup-guard pagination (vitest: array form, wrapped form, dup-page stop, maxItems); all endpoint wrappers incl. `getPlanRuns` (get_plans→get_plan flatten; vitest), `getResultsForRun`, mapping snake_case→camel incl. `custom_testcaseowner→ownerId`, `case_assignedto_id→assignedToId`.
- [ ] T8 `server/src/storage/` add `TestRailCache(key TEXT PRIMARY KEY, json TEXT, updatedAt INTEGER)` + `TestRailPeople(id INTEGER PRIMARY KEY, name TEXT)`; repository fns. Migration import of `%AppData%\TestRailWeb\people.json` at boot if table empty.
- [ ] T9 `server/src/testrail/service.ts` — session (connect via `get_current_user`), `cachedGet(key, fetch, fresh)` using SQLite; prefetch with progress state + skip-warm; people CRUD.
- [ ] T10 `server/src/routes/testrail.ts` — mirror TestRailWeb API: session/import, meta?projectId, projects, suites, sections, cases, runs (+planruns), tests, results (run+test), add-result, case/section CRUD, copy/move, prefetch, people, cache clear. Credentials fields added to `config/credentialsStore.ts`. Mount in `app.ts`. Vitest route smoke with mocked client.
- [ ] T11 Live verification against hp-testrail: counts equal Railbook (suite 234516 = 5458 cases; owner count 1365/1460 on suite 234511).

### Phase 3 — TestRail React views

- [ ] T12 `client/src/api/testrail.ts` — typed client for all routes.
- [ ] T13 `client/src/stores/testrail.ts` — project/suite selection, cases cache, selection sets, filters, column config (visible+widths, localStorage), people.
- [ ] T14 `views/testrail/CaseLibraryView.tsx` (+`CaseDrawer`, `CaseEditor`, `TransferDialog`, `SectionDialog`, coverage) — full parity per spec table; pure helpers (`groupCasesBySection`, `filterCases`, `sectionPath`, `richText`) in `lib/testrail.ts` with vitest.
- [ ] T15 `views/testrail/RunsView.tsx` + `RunDetailView.tsx` (+ `ResultDialog`, history drawer) — parity: chips, colored rows, qbtns, progress bar, My tests via run results, caps.
- [ ] T16 `views/testrail/TestRailReportsView.tsx` + Settings section (connection, people editor, cache clear).
- [ ] T17 Router + Shell: sidebar groups JIRA/TESTRAIL, routes `#/testrail/{cases,runs,run/:id,reports}`; Ctrl+K palette includes TestRail case search (title/id over cached cases).

### Phase 4 — Unification & retirement

- [ ] T18 Parity checklist vs live Railbook (both open side-by-side; screenshot compare each screen; counts equal).
- [ ] T19 Both themes verified on every TestRail screen.
- [ ] T20 README + retire note for TestRailWeb (leave app on disk; stop auto-start).
