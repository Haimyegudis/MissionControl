# JiraWeb — Design Spec

**Date:** 2026-08-12
**Status:** Approved (brainstorm 2026-08-12)
**Owner:** haim036688893@gmail.com

## Goal

Extract the Jira workspace out of Mission Control (WPF desktop) into a **standalone local web tool** called **JiraWeb**, living at `C:\APPS\JiraWeb` in its own git repository. Full feature parity with the WPF Jira workspace. Pure web stack — no .NET.

## Decisions captured during brainstorm

| # | Topic | Choice |
|---|-------|--------|
| 1 | Stack | Pure web, no .NET. React + Vite + TypeScript SPA; Express + TypeScript server. |
| 2 | Deployment | Local, single user. Node server on localhost serves UI and proxies Jira REST. PAT stays server-side. |
| 3 | Scope | Full parity with WPF Jira workspace (all views, dialogs, Lumo AI). |
| 4 | WPF fate | Mission Control's Jira workspace stays until JiraWeb reaches parity and is trusted; removed after. |
| 5 | Location | New sibling folder `C:\APPS\JiraWeb`, own repo. Mission Control untouched. |

## Architecture

```
JiraWeb/
  server/          Express + TypeScript (tsx runtime)
    src/
      jira/        Jira REST client: auth, issues, boards, sprints, worklogs,
                   dashboards, filters, metadata, create-issue, comments, transitions
      storage/     better-sqlite3: issue cache, metadata cache, saved filters,
                   teams, pinned boards, board workspaces, app settings, starred
      ai/          Lumo — spawn AI CLI child process, stream over SSE/WebSocket
      config/      credentials + settings in %APPDATA%\JiraWeb\config.json
      routes/      REST API consumed by the SPA
  client/          React + Vite + TypeScript SPA
    src/
      views/       one per WPF view (parity contract)
      components/  kanban board, charts, dialogs, command palette, toasts
      api/         typed client for server routes
  docs/superpowers/{specs,plans}
  package.json     npm start = build client, run server, open browser
```

**Flow:** Browser → Express (localhost only) → Jira REST. PAT never reaches the browser. SQLite caches mirror the WPF repositories (`IssueCacheRepository`, `MetadataCacheRepository`, `SavedFilterRepository`, `TeamRepository`, `PinnedBoardRepository`, `BoardWorkspaceRepository`, `AppSettingsRepository`).

**Auth:** first run shows login page (base URL + email + PAT + test button, ping `GET /rest/api/2/myself`). Saved to `%APPDATA%\JiraWeb\config.json`; login skipped afterward. No DPAPI in Node — plain file, single-user machine, same practical threat model as today's local files. Logout clears file.

## Feature parity contract (from WPF Jira workspace)

Views: Dashboard, My Work, Incidents, Boards/Kanban (drag-drop, columns, board search, pinning), Filters, Recent Updates, Time Logged (charts), Dashboards, Team dashboard (+ member detail, team editor), Settings, Profile editor.
Dialogs: Issue details (comments, worklogs, transitions), Create issue (metadata-driven fields), Log work, Transition, User search picker, text prompts, help.
Cross-cutting: command palette, starring, toasts, aging dots, epic display, auto-refresh scheduler, worklog reminder, Lumo AI panel (spawns local AI CLI, streamed chat).
WPF `JiraBrowserView` (embedded WebView2) becomes "open Jira in new tab" links — browsers cannot embed Jira in iframes.

Authoritative behavior reference: WPF source under `C:\APPS\MissionControl\src\` (Jira folders). Exhaustive endpoint/schema/feature inventories captured in the implementation plan.

## Error handling

- Server maps Jira HTTP errors to `{status, message}` JSON; client shows toast + inline state.
- 401 anywhere → client redirects to login page.
- Jira unreachable → cached data shown with "stale" banner (mirrors WPF cached services).

## Testing

- Server: vitest — unit tests for JQL builder/escaping, mappers, repositories (in-memory SQLite), route tests with mocked Jira client.
- Client: vitest + React Testing Library for view logic; heavy visual polish verified manually.

## Non-goals

- Multi-user/hosted deployment, HTTPS, OS credential vault.
- TestRail/Confluence — stay in Mission Control.
- Removing Jira from Mission Control (separate later step).
