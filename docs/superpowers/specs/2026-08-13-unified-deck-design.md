# Deck — Unified Jira + TestRail Web App

Date: 2026-08-13 · Status: approved by user (chat) · Supersedes: standalone TestRailWeb (C:\APPS\TestRailWeb, port 5199)

## Goal

Merge TestRailWeb into JiraWeb so there is **one web application** (one server, one port 5643, one codebase, one navigation shell) with **two complete, user-switchable design themes** applied to every screen:

- **Railbook** — light paper: Fraunces display serif + Archivo body + Spline Sans Mono, cream background `#f2ecdd`, vermilion accent `#c7431d`, stamp-style status pills, hairline rules.
- **Nightdeck** — the current JiraWeb dark glass: radial `#0b1430→#050816`, translucent blurred panels, cyan `#1fe0e0` accent, Segoe UI.

## Non-goals

- No change to Jira feature behavior (parity contract stays).
- No multi-user/auth server hardening (stays localhost, single user).
- No rewrite of JiraWeb views beyond tokenizing their styles.

## Architecture

Base: existing JiraWeb monorepo (Express + TS server, React 18 + Vite client, SQLite storage, npm workspaces).

### Server — new module `server/src/testrail/`

TypeScript port of the proven C# client (`C:\APPS\TestRailWeb\TestRail\TestRailClient.cs`), preserving hard-won behaviors:

- REST v2 over Basic auth (`email:apiKey`), base URL normalized to `…/index.php?/api/v2/`.
- Pagination: array-form and wrapped-form with duplicate-page guard (`GetPagedItemsAsync` logic).
- `get_users&project_id={id}` (non-admin), tolerated 403 → empty list.
- Case fields incl. `custom_testcaseowner` (owner) and `case_assignedto_id` (assignee).
- Plan runs via `get_plans` + `get_plan` entries (runs invisible to `get_runs`).
- `get_results_for_run` (executed-by-me), `get_results` per test, add result (extended), add/update/delete case & section, copy/move cases (cross-project copy), add/update/close/delete run.

Files:

- `testrail/httpClient.ts` — auth, fetch, error mapping (mirror jira/httpClient.ts style, 60s timeout).
- `testrail/client.ts` — endpoint wrappers + pagination.
- `testrail/types.ts` — Case, Suite, Section, Run, Test, Result, PlanRun, Status, Priority, CaseType, User.
- `testrail/service.ts` — session (connect/disconnect/status), prefetch orchestration, people store.
- `routes/testrail.ts` — REST surface mirroring TestRailWeb's `/api/*`, mounted at `/api/testrail/*`, `?fresh=1` cache bypass.

### Caching & storage

- TestRail responses cached in SQLite (new `TestRailCache` table: key, json, updatedAt) via the same stale-serving decorator pattern as `jira/cached.ts`. Replaces TestRailWeb's `cache.json`.
- People map (`id → display name`) in SQLite table `TestRailPeople`; seed by importing `%AppData%\TestRailWeb\people.json` if present (one-time migration).
- Prefetch: POST `/api/testrail/prefetch` warms suites/sections/cases/runs/meta for the configured project ids; status endpoint for progress; skip already-warm projects.

### Credentials

- Extend `config/credentialsStore.ts` schema with `testRailBaseUrl`, `testRailEmail`, `testRailApiKey` (same file `%APPDATA%\JiraWeb\config.json`, atomic write). One-time migration: if TestRailWeb's DPAPI vault exists, offer import via a small PowerShell decrypt step (like `scripts/migrate-credentials.ps1`).
- Known weakness (pre-existing): plaintext storage. Out of scope to fix; documented.

### Client — new views `client/src/views/testrail/`

React ports of every Railbook screen at feature parity:

| View | Parity features |
|---|---|
| `CaseLibraryView` | suite picker (incl. ★ All suites), sections tree w/ hide-panel toggle, grouped-by-section rows (collapse, select-all, pinned copy/move at right edge), filters: title-contains / owner / assigned-to (datalist of all people), column chooser + drag-resize persisted, 800-row paint cap, CSV export, bulk copy/move/delete w/ typed confirm, case drawer (steps rich-text flattened, execution status from recent runs+plans), case editor (steps editor, owner select), never-ran coverage (all runs + plan runs, retry + partial warning) |
| `RunsView` | search all runs, suite filter, My runs chip, display cap 500, create/edit/close/delete run (scope: whole suite / section with case-count preview) |
| `RunDetailView` | status-colored rows, colored quick buttons ✓✗⊘↻, execution progress bar, status chips with counts, My tests (assigned ∪ executed-by-me via run results), bulk marking, extended result modal, per-test history drawer |
| `TestRailReportsView` | totals, overall + per-run distribution, suite filter + search |
| Settings additions | TestRail connection fields + test button, people editor (bulk paste id=name), clear TestRail cache |

Shared client pieces: api client extension (`client/src/api/testrail.ts`), stores for testrail state, reuse DataGrid/toasts/DialogHost where natural — but table behaviors that Railbook already solved (resize, grouping, caps) port as-is.

### Navigation & shell

- Sidebar gains two labeled groups: **JIRA** (existing 10 routes) and **TESTRAIL** (Cases, Runs, Reports). Hash routes: `#/testrail/cases`, `#/testrail/runs`, `#/testrail/run/{id}`, `#/testrail/reports`.
- Command palette (Ctrl+K) searches Jira issues *and* TestRail cases (grouped results).
- Top bar: theme switch (Railbook/Nightdeck), connection dots for both services.

## Theme system

- Single source of truth: `client/src/theme.css` grows into a token sheet — colors, fonts, radii, shadows, panel treatments — defined per `:root[data-theme="railbook"]` and `:root[data-theme="night"]`.
- Sweep JiraWeb components: replace hardcoded hex/inline `CSSProperties` colors with `var(--token)` references so both themes fully restyle every screen (fonts included: Railbook loads Fraunces/Archivo/Spline Sans Mono via Google Fonts with system fallback).
- Persisted in settings (existing theme plumbing `App.tsx` extends from light/dark to railbook/night).
- Status colors (pass/fail/blocked/retest/untested) are tokens shared by both themes with per-theme values.

## Error handling

- TestRail API failures → structured `{ error, statusCode, body }` (mirror Jira routes' error style); client toasts.
- Partial-data honesty: prefetch/coverage report failures explicitly (no silent skips).

## Testing

- Server: vitest for the pagination logic, plan-run flattening, cache decorator, and route wiring with a mocked http client (same pattern as existing `server/test/*`).
- Client: vitest for CaseLibrary grouping/filter logic and RunDetail chip filtering (pure functions extracted for testability).
- Manual parity checklist vs live Railbook before retiring port 5199.

## Rollout phases

1. **Theme tokens** — dual themes working on existing JiraWeb screens.
2. **TestRail server module** — client port + routes + SQLite cache + credentials; verified against live hp-testrail.
3. **TestRail React views** — parity per table above.
4. **Unification** — palette, settings, nav polish; parity check; retire standalone TestRailWeb.

Each phase lands as a separate commit series; app stays usable between phases.
