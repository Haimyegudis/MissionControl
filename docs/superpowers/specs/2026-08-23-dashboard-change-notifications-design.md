# Dashboard Change Notifications + Active Sprint Header

Date: 2026-08-23
Status: approved design

## Goal

Notify the user whenever anything changes in the work shown on the Mission
Control **Dashboard** tab: an issue is assigned to them, leaves them, moves
status, moves sprint, or has its priority / due date / comments edited.
Delivery on Windows (native toast) and Android (native notification, including
when the app is closed). Secondary: show the active sprint name in the
Dashboard's "My Current Sprint" card.

Out of scope: watching Jira's own dashboard pages (`#/dashboards`, gadgets) —
the REST API does not expose gadget contents. Watching other users' work.
Email digests.

## Event model

Seven event kinds, all enabled by default, each individually toggleable:

| kind | fires when |
|------|-----------|
| `assigned` | issue appears in the watched set and was not there before |
| `unassigned` | issue leaves the watched set (reassigned, closed, dropped from sprint) |
| `status` | `status` differs from the stored snapshot |
| `sprint` | `sprint` (active sprint name) differs |
| `priority` | `priority` differs |
| `dueDate` | `duedate` differs (set, cleared or moved) |
| `comment` | comment total increased |

An `unassigned` event carries the reason it left (`reassigned` / `done` /
`left-sprint`) derived from the delta query's copy of the issue, so the toast
can say why rather than just "gone". When the issue is absent from the delta
results — it changed longer ago than the delta window, after a long gap between
cycles — `reason` is omitted and the event reads "no longer on your dashboard".

`WatchConfig`:

```ts
interface WatchConfig {
  enabled: boolean;
  intervalMinutes: 5 | 10 | 15 | 30;   // default 5
  kinds: Record<WatchEventKind, boolean>;  // default: all true
}
```

## Architecture

### 1. `core/src/watch/` — shared, platform-free, unit tested

```
types.ts     IssueSnapshot, WatchEvent, WatchConfig, WatchState
snapshot.ts  mapSnapshot(rawJiraIssue) -> IssueSnapshot
differ.ts    diff(prev, next, config) -> WatchEvent[]
service.ts   WatchService.runCycle() -> { events, state }
```

`IssueSnapshot`:

```ts
interface IssueSnapshot {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  sprintName: string | null;
  priority: string;
  assignee: string | null;
  dueDate: string | null;   // "YYYY-MM-DD"
  commentCount: number;
  updated: string;          // ISO
}
```

`WatchEvent`:

```ts
interface WatchEvent {
  id: string;               // `${key}:${kind}:${at}` — stable, used for ack/dedupe
  kind: WatchEventKind;
  key: string;
  summary: string;
  from: string | null;
  to: string | null;
  at: string;               // ISO, cycle time
  reason?: 'reassigned' | 'done' | 'left-sprint';
}
```

`diff` is pure: two maps in, sorted event list out. One issue changing three
fields produces three events (they are toggled and rendered independently).

### 2. Queries — a dedicated field list

`BASE_FIELDS` in `core/src/jira/issueService.ts` carries neither `duedate` nor
`comment`, and no view in the app needs them today. Adding them there would
make every search in the product pay for comment bodies. `WatchService`
therefore issues its own `POST /search` with:

`summary, status, priority, assignee, updated, duedate, comment` + the resolved
sprint custom field id (already discovered and cached by
`IssueService.getSearchFields`, exposed via the existing `setSprintFieldId`
module state).

Two queries per cycle:

1. **Membership** — `project = <default> AND sprint in openSprints() AND assignee = currentUser()`
   Defines the watched set. Gives `assigned` / `unassigned` by set difference.
2. **Delta** — `project = <default> AND assignee = currentUser() AND updated >= -<interval*2>m`
   Catches field edits on issues that have just left the sprint or the
   assignee, so their `unassigned` event can state a reason. The window is twice
   the poll interval so a slow or skipped cycle does not create a blind spot.

Comment counts come from the `comment` field's `total` on these results only —
never a per-issue fetch.

### 3. State

`WatchState = { snapshot: Record<key, IssueSnapshot>; lastCycle: string; feed: WatchEvent[]; ackedAt: string | null }`.
`feed` is capped at the 200 most recent events.

- Desktop: `%APPDATA%\JiraWeb\watch-state.json` (path via `server/src/config/appPaths.ts`)
- Android: the same JSON through the existing `kvStore` / `secureStorage` path

**Baseline rule:** when no prior snapshot exists, the cycle stores the snapshot
and emits zero events. Installing the feature must not produce forty
notifications for work that was already there.

**Catch-up on start:** because the snapshot is persisted rather than held in
memory, the first cycle after launch diffs against whatever was stored when the
app last ran. Everything that changed while Mission Control was closed is
reported then, however long the gap. The desktop timer therefore fires one cycle
immediately on server start rather than waiting a full interval.

This is a state diff, not a changelog replay, and two consequences follow:

- Intermediate steps collapse. `To Do -> In Progress -> Done` during downtime
  produces a single `status` event reading `To Do -> Done`. The user sees where
  the issue landed, not the path it took.
- Several comments collapse into one `comment` event carrying the count
  ("3 new comments"), since only the total is compared.

Detection coverage itself does not degrade with downtime: the membership query
returns the current state of every sprint issue, so status / sprint / priority /
due-date / comment diffs are found regardless of the gap. Only the `unassigned`
reason depends on the delta window, and after long downtime it is simply
omitted.

### 4. Desktop delivery

`server/src/watch.ts` — a `setInterval` at the configured interval (default 5
minutes) while the server runs, calling `WatchService.runCycle`. Events are
batched into a single WinRT toast generated the same way
`server/src/reminders.ts` generates its toasts: a PowerShell script written to
the app data dir, executed with `-WindowStyle Hidden`, and
`launch="http://127.0.0.1:5643/#/dashboard"`.

Toast text: title `N changes on your dashboard`, body = the first three event
lines (`ISW-16183 → In Progress`), XML-escaped exactly as the existing scripts
do.

Unlike reminders, this is **not** a Windows Scheduled Task: the poll needs the
live Jira session held by the running server, so it only runs while Mission
Control is up. The Settings UI states this.

Routes (`server/src/routes/watch.ts`, mounted at `/api/watch` in `app.ts`):

- `GET /api/watch/feed` returns `{ events, unreadCount, lastCycle }`
- `POST /api/watch/ack` marks the feed read
- `GET|PUT /api/watch/config` reads and writes `WatchConfig`
- `POST /api/watch/run` forces a cycle now (the "Check now" button)

The same routes are added to `core/src/dispatch.ts` so the Android in-process
dispatcher answers them identically.

### 5. Android delivery

- `WatchWorker` — a `CoroutineWorker` scheduled as a `PeriodicWorkRequest`
  (15 min, `NetworkType.CONNECTED`, `ExistingPeriodicWorkPolicy.KEEP`).
  15 minutes is the WorkManager floor and Doze can stretch it further. This is
  accepted rather than worked around with a foreground service.
- The worker creates an offscreen `WebView` on the main looper loading
  `file:///android_asset/public/index.html#/__watch`. That hash boots a minimal
  watch entry point in `client/src/native/watchEntry.ts`: session bootstrap
  (the existing `CookieBridgePlugin` / `EncryptedStorePlugin` / `ssoSession`
  path) then `WatchService.runCycle`. No React, no UI.
- `WatchBridgePlugin` (new Capacitor plugin) carries the resulting events back
  to the worker, which raises one `NotificationCompat` notification per batch on
  a `mc_jira_changes` channel. Tapping it opens `MainActivity` deep-linked to
  `#/dashboard`.
- A 60-second watchdog destroys the WebView and returns `Result.retry()` if the
  cycle has not reported back.
- `POST_NOTIFICATIONS` runtime permission is requested on first launch (API 33+).
- While the app is in the foreground, `client/src/stores/scheduler.ts` drives a
  5-minute cycle, so active use gets the requested cadence.

### 6. In-app feed

- Bell button in `client/src/components/PageHeader.tsx` with an unread badge.
- The dropdown lists the feed newest first, grouped by issue key, each row
  `KIND · KEY — summary · from → to · relative time`. Clicking a row opens the
  existing issue dialog. "Mark all read" calls `/api/watch/ack`.
- Mobile: the same feed as a screen reachable from `MobileDashboard`.

### 7. Settings

A new section in `client/src/views/settings/` (sibling of `DashboardSection.tsx`):
master enable, seven per-kind checkboxes, interval select (5 / 10 / 15 / 30
min), "Check now" button, last-cycle timestamp, and a line stating that the
desktop poll only runs while Mission Control is open. Mirrored in
`MobileSettings.tsx`.

`WatchConfig` is sanitized server-side in the style of `reminders.ts`
`sanitize()` — unknown kinds dropped, interval clamped to the allowed set.

## Active sprint in the Dashboard header

The "My Current Sprint" card header becomes:

`My Current Sprint — ISW Sprint 128 · 3 days left (ends 26 Aug)`

Resolution order, in a new pure helper `resolveActiveSprint` in
`client/src/lib/viewDashboard.ts`:

1. The most common non-null `sprint` name across the loaded sprint issues, with
   its dates taken from that issue's `allSprints` entry whose `state` is
   `active`.
2. If no loaded issue carries a sprint (empty sprint, or all issues sprintless),
   fall back to `boardService`'s `/board/{id}/sprint?state=active` for the
   user's pinned board.
3. If both fail, the header stays exactly as it is today — no error, no empty
   dash.

Deriving the sprint from the issues rather than hardcoding board `41212` keeps
this correct for any board the user works on. Days-left is computed from the
sprint's `endDate`; a sprint past its end date shows `ends today` rather than a
negative count.

## Error handling

- A failed Jira query aborts the cycle without touching the stored snapshot, so
  the next successful cycle still reports everything that changed meanwhile.
- A 401 mid-cycle is silent: the app already surfaces session loss through
  `SESSION_LOST_EVENT`, and the watcher must not stack a toast on top of it.
- A corrupt `watch-state.json` is treated as no state, so the baseline rule
  applies and the user gets silence rather than a flood.
- Notification failures (toast script non-zero exit, Android permission denied)
  are logged and the events still land in the in-app feed.

## Testing

- `core/test/watchDiffer.test.ts` — one case per event kind; baseline
  suppression; a multi-field change on one issue produces one event per field;
  per-kind config filtering; `unassigned` reason derivation.
- `core/test/watchService.test.ts` — cycle orchestration against a stubbed
  fetch: both queries issued, comment totals read, state written, and a failed
  query leaving state untouched.
- Catch-up: a stored snapshot days old still yields events on the first cycle;
  a status that moved twice yields one event naming the final status; several
  new comments yield one event carrying the count.
- `server/test/watchRoutes.test.ts` — feed/ack/config/run routes, config
  sanitization, 503 when not connected.
- `core/test/dispatch.test.ts` — the four `/api/watch/*` paths answered natively.
- `client/test/viewDashboardSprint.test.ts` — `resolveActiveSprint` resolution
  order, days-left arithmetic, past-end-date wording, all-sprintless fallback.

## Build order

1. `core/src/watch/` plus differ and service tests
2. Server timer, routes, toast script and tests
3. In-app feed, bell, settings and tests
4. Active sprint header and tests
5. Android: `WatchBridgePlugin`, `watchEntry.ts`, `WatchWorker`, permission,
   notification channel

Steps 1–4 ship independently of step 5.
