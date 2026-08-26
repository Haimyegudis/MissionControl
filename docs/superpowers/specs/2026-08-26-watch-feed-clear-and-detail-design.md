# Watch Feed: Clear All + Visible Change Detail — Design

**Date:** 2026-08-26
**Status:** Approved

## Problem

The Dashboard bell (change feed) has no way to empty the list — `ack` only clears the
unread badge; events persist until the 200-event cap pushes them out. And the "what
changed" line (`describeEvent`) renders as small muted text under the summary, so users
read it as absent.

## Design

### Clear all

- Core `WatchService.clearFeed(): void` — `setState({ ...state, feed: [], ackedAt: now })`
  (empty feed and reset read marker so `unreadCount` is 0).
- Server route `POST /api/watch/clear` → `deps.watch.clearFeed()`, responds with the fresh
  (empty) feed, mirroring `/api/watch/ack`.
- Core `dispatch.ts` gets the same `POST /api/watch/clear` branch (Android parity).
- Client: `watch.clear()` in `api/client.ts`; `clearWatchFeed()` store action in
  `stores/watch.ts` (optimistic: on API failure still empty the local store — same
  philosophy as `ackWatchFeed`); "Clear all" button in the dropdown header row of
  `WatchBell.tsx`, rendered only when `feed.events.length > 0`.

### Visible change detail

In `WatchBell.tsx` rows, swap the prominence of the two text lines:

- Change line becomes primary: normal text color, 12.5px, prefixed with the kind label
  for field changes — `Status: In Progress → Done`, `Priority: P3 → P1`,
  `Sprint: 128 → 129`, `Due date: due 2026-09-01`. Assignment/comment kinds keep their
  sentence forms (`now assigned to you`, `2 new comment(s)`).
- Issue summary demotes to the muted 11.5px line below it.
- Kind chip, issue key, and relative time row unchanged.

`describeEvent` keeps its current return values; a new `describeEventTitle(event)` (or
inline logic) adds the `Label:` prefix only for from→to kinds.

### Out of scope

- Who made the change (needs Jira changelog fetches per cycle) — explicitly skipped.
- Mobile screens (no feed UI there today).

## Testing

- core: `clearFeed` empties `feed`, `unreadCount` becomes 0, `lastCycle`/`snapshot`
  preserved; dispatch routes `POST /api/watch/clear`.
- server: route test — clear returns empty feed.
- client (renderToString): dropdown shows "Clear all" when events exist, hides when
  empty; row markup contains prefixed change line.
