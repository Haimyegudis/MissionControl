# Watch Feed Clear All + Visible Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Clear all" action that empties the change-feed, and make each feed row's "what changed" line the prominent one.

**Architecture:** New `clearFeed()` on core `WatchService`, exposed as `POST /api/watch/clear` in both the Express route and the native dispatch. Client gets `watch.clear()` + `clearWatchFeed()` store action and a restyled `WatchBell` dropdown with a Clear all button.

**Tech Stack:** TypeScript, React, Express, Vitest. Workspaces: core, server, client.

**Spec:** `docs/superpowers/specs/2026-08-26-watch-feed-clear-and-detail-design.md`

## Global Constraints

- Tests: `npm run test --workspace core`, `--workspace server`, `--workspace client` (Vitest).
- Client component tests render with `renderToString` from `react-dom/server` — markup assertions only.
- `clearFeed()` must preserve `snapshot` and `lastCycle` (only `feed` empties and `ackedAt` resets to now) — the watcher must not re-report old changes after a clear.
- Whenever a server-consumed service method is added, the matching interface in `server/src/routes/deps.ts` MUST be updated in the same task (vitest does not typecheck; `tsc` build does).
- `describeEvent` keeps its current return values (other code depends on the sentences).

---

### Task 1: Backend — `clearFeed` in core service, dispatch, server route

**Files:**
- Modify: `core/src/watch/service.ts` (after `ack()`, ~line 108)
- Modify: `core/src/dispatch.ts` (watchRoute, ~lines 1219-1226)
- Modify: `server/src/routes/watch.ts` (after `/ack`, ~line 18)
- Modify: `server/src/routes/deps.ts` (`WatchDep`, ~line 109)
- Test: `core/test/watchService.test.ts`, `core/test/dispatch.test.ts`, `server/test/watchRoutes.test.ts`

**Interfaces:**
- Consumes: existing `KvWatchRepo.getState/setState`, `WatchService.feed()`.
- Produces: `WatchService.clearFeed(): void`; HTTP/dispatch endpoint `POST /api/watch/clear` returning the fresh feed `{ events, unreadCount, lastCycle }`. `WatchDep` gains `clearFeed(): void`.

- [ ] **Step 1: Write failing tests**

`core/test/watchService.test.ts` — follow the file's existing harness for constructing the service/repo (read the top of the file for its helpers), add:

```ts
it('clearFeed empties the feed and resets unread, keeping snapshot and lastCycle', () => {
  // Arrange via the file's existing repo/service helpers: seed state with
  // a non-empty feed, a snapshot, and a lastCycle, ackedAt: null.
  service.clearFeed();
  const feed = service.feed();
  expect(feed.events).toEqual([]);
  expect(feed.unreadCount).toBe(0);
  const state = repo.getState();
  expect(state.lastCycle).not.toBeNull();
  expect(Object.keys(state.snapshot).length).toBeGreaterThan(0);
});
```

`core/test/dispatch.test.ts` — next to the existing watch/ack dispatch test (find it by grepping `watch`; mirror its harness):

```ts
it('POST /api/watch/clear empties the feed', async () => {
  const { core, dispatch } = harness();
  const clear = vi.spyOn(core.watch, 'clearFeed').mockImplementation(() => {});
  vi.spyOn(core.watch, 'feed').mockReturnValue({ events: [], unreadCount: 0, lastCycle: null });
  const res = await dispatch('POST', '/api/watch/clear', {});
  expect(clear).toHaveBeenCalled();
  expect(res).toEqual({ status: 200, body: { events: [], unreadCount: 0, lastCycle: null } });
});
```

(Adapt the response-shape assertion to how the file's other watch tests assert `ok(...)` responses.)

`server/test/watchRoutes.test.ts` — mirror the existing `/ack` route test; the mock deps object gains `clearFeed: vi.fn()`:

```ts
it('POST /clear clears the feed and returns it', async () => {
  const res = await request(app).post('/api/watch/clear');
  expect(res.status).toBe(200);
  expect(deps.watch.clearFeed).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test --workspace core -- watchService` (and `dispatch`), `npm run test --workspace server -- watchRoutes`
Expected: FAIL — `clearFeed` not a function / 404.

- [ ] **Step 3: Implement**

`core/src/watch/service.ts`, after `ack()`:

```ts
/** Empty the feed and mark it read; the snapshot stays so nothing re-reports. */
clearFeed(): void {
  this.repo.setState({
    ...this.repo.getState(),
    feed: [],
    ackedAt: this.now().toISOString(),
  });
}
```

`core/src/dispatch.ts`, inside `watchRoute` next to the ack branch:

```ts
if (method === 'POST' && sub === 'clear') {
  core.watch.clearFeed();
  return ok(core.watch.feed());
}
```

`server/src/routes/watch.ts`, after the `/ack` route:

```ts
router.post('/clear', (_req, res) => {
  deps.watch.clearFeed();
  res.json(deps.watch.feed());
});
```

`server/src/routes/deps.ts`, in `WatchDep` after `ack(): void;`:

```ts
clearFeed(): void;
```

- [ ] **Step 4: Run core + server suites**

Run: `npm run test --workspace core && npm run test --workspace server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/watch/service.ts core/src/dispatch.ts server/src/routes/watch.ts server/src/routes/deps.ts core/test/watchService.test.ts core/test/dispatch.test.ts server/test/watchRoutes.test.ts
git commit -m "feat(watch): clearFeed service + POST /api/watch/clear"
```

---

### Task 2: Client — Clear all button + prominent change line

**Files:**
- Modify: `client/src/api/client.ts` (`watch` object, ~line 256)
- Modify: `client/src/stores/watch.ts`
- Modify: `client/src/components/WatchBell.tsx`
- Test: `client/test/watchStore.test.ts`, Create: `client/test/watchBell.test.tsx`

**Interfaces:**
- Consumes: `POST /api/watch/clear` from Task 1 (returns `WatchFeed`).
- Produces: `watch.clear(): Promise<WatchFeed>`; `clearWatchFeed(): Promise<void>` store action; exported `describeEventTitle(event: WatchEvent): string`.

- [ ] **Step 1: Write failing tests**

`client/test/watchStore.test.ts` — the file mocks `../src/api/client`; add `clear: vi.fn(async () => ({ events: [], unreadCount: 0, lastCycle: feedResponse.lastCycle }))` to the mock's `watch` object, and:

```ts
it('empties the feed on clear all', async () => {
  await refreshWatchFeed();
  await clearWatchFeed();
  expect(watchStore.get().events).toEqual([]);
  expect(watchStore.get().unreadCount).toBe(0);
});

it('still empties the feed locally when the clear request fails', async () => {
  await refreshWatchFeed();
  (watch.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
  await clearWatchFeed();
  expect(watchStore.get().events).toEqual([]);
  expect(watchStore.get().unreadCount).toBe(0);
});
```

`client/test/watchBell.test.tsx` — new file, `renderToString` style. WatchBell reads the module-level `watchStore`; seed it directly. The dropdown only renders when open, and `useState(false)` starts closed — so test the exported helpers plus the closed-state markup, and the row/button markup via the exported pieces:

```tsx
// WatchBell markup: clear-all visibility and the prominent change line.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { describeEventTitle } from '../src/components/WatchBell';
import type { WatchEvent } from '../src/types';

function ev(partial: Partial<WatchEvent>): WatchEvent {
  return {
    id: 'A-1:status:t',
    kind: 'status',
    key: 'A-1',
    summary: 'Some issue',
    from: 'In Progress',
    to: 'Done',
    at: new Date().toISOString(),
    ...partial,
  };
}

describe('describeEventTitle', () => {
  it('prefixes field changes with the kind label', () => {
    expect(describeEventTitle(ev({}))).toBe('Status: In Progress → Done');
    expect(describeEventTitle(ev({ kind: 'priority', from: 'P3', to: 'P1' }))).toBe('Priority: P3 → P1');
    expect(describeEventTitle(ev({ kind: 'sprint', from: 'S1', to: 'S2' }))).toBe('Sprint: S1 → S2');
    expect(describeEventTitle(ev({ kind: 'dueDate', from: null, to: '2026-09-01' }))).toBe('Due date: due 2026-09-01');
  });
  it('keeps sentence forms for assignment and comments', () => {
    expect(describeEventTitle(ev({ kind: 'assigned' }))).toBe('now assigned to you');
    expect(describeEventTitle(ev({ kind: 'comment', from: '2', to: '4' }))).toBe('2 new comment(s)');
  });
});
```

Plus a dropdown markup test: import `WatchBell`, seed `watchStore.set({ events: [ev({})], unreadCount: 0, lastCycle: new Date().toISOString() })`, `renderToString(<WatchBell />)` renders the closed bell (no dropdown) — assert `html` contains the bell button but NOT `Clear all`; this pins "button only lives in the dropdown". (Full open-state interaction is not testable with renderToString; the helper tests carry the row content.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test --workspace client -- watch`
Expected: FAIL — `clear`/`clearWatchFeed`/`describeEventTitle` missing.

- [ ] **Step 3: Implement**

`client/src/api/client.ts` — in the `watch` export next to `ack`:

```ts
clear: () => api.post<WatchFeed>('/api/watch/clear', {}),
```

`client/src/stores/watch.ts` — after `ackWatchFeed`:

```ts
/** "Clear all" in the bell: empty the feed server-side and locally. */
export async function clearWatchFeed(): Promise<void> {
  try {
    watchStore.set(await watch.clear());
  } catch {
    // The feed is the user's own view — honor the clear locally regardless.
    watchStore.set({ ...watchStore.get(), events: [], unreadCount: 0 });
  }
}
```

`client/src/components/WatchBell.tsx`:

Add export (uses existing `KIND_LABEL` + `describeEvent`):

```ts
/** Row headline: "Status: In Progress → Done" for field changes, sentences otherwise. */
export function describeEventTitle(event: WatchEvent): string {
  const detail = describeEvent(event);
  switch (event.kind) {
    case 'status':
    case 'sprint':
    case 'priority':
    case 'dueDate':
      return `${KIND_LABEL[event.kind]}: ${detail}`;
    default:
      return detail;
  }
}
```

Note: `KIND_LABEL.dueDate` is `'Due date'`, so titles read `Due date: due 2026-09-01`.

In the dropdown header, replace the lone "Last checked" div with a flex row (import `clearWatchFeed` from the store):

```tsx
<div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 8px' }}>
  <span className="muted" style={{ fontSize: 11 }}>
    {feed.lastCycle ? `Last checked ${relative(feed.lastCycle, now)}` : 'Not checked yet'}
  </span>
  {feed.events.length > 0 ? (
    <button
      type="button"
      className="btn"
      onClick={() => void clearWatchFeed()}
      style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
    >
      Clear all
    </button>
  ) : null}
</div>
```

In each event row, swap the two content lines — change line first and primary, summary second and muted:

```tsx
<div style={{ fontSize: 12.5, marginTop: 1 }}>{describeEventTitle(event)}</div>
<div className="muted" style={{ fontSize: 11.5 }}>{event.summary}</div>
```

(The kind chip / key / time header row stays untouched. `describeEvent` itself is unchanged.)

- [ ] **Step 4: Run client suite**

Run: `npm run test --workspace client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/client.ts client/src/stores/watch.ts client/src/components/WatchBell.tsx client/test/watchStore.test.ts client/test/watchBell.test.tsx
git commit -m "feat(client): clear-all button + prominent change line in watch bell"
```

---

## Final verification

- [ ] `npm test` (root) — all three workspaces green.
- [ ] `npm run build` — tsc across workspaces (guards the deps.ts interface).
- [ ] Manual smoke: bell dropdown shows "Status: X → Y" style lines; Clear all empties list and badge; next watch cycle does not resurrect cleared events.
