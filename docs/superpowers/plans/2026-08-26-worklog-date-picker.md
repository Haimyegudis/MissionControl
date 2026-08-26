# Worklog Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the worklog start date when logging work through the Transition dialog, and make the existing date field in the Log Work dialog discoverable.

**Architecture:** Thread an optional `worklogStarted` ISO string from the Transition dialog through the API client → server route / native dispatch → `performTransitionWithData`, which adds `started` to the worklog `add` payload using the existing `formatWorklogStarted` formatter. A small shared `DateTimeField` component (datetime-local input + calendar button calling `showPicker()`) is used by both dialogs.

**Tech Stack:** TypeScript, React, Express, Vitest. Monorepo workspaces: `core`, `server`, `client`.

**Spec:** `docs/superpowers/specs/2026-08-26-worklog-date-picker-design.md`

## Global Constraints

- Tests: `npm run test --workspace core`, `--workspace server`, `--workspace client` (Vitest).
- Client dialog tests render with `renderToString` from `react-dom/server` — assert on markup, not interaction.
- Jira worklog `started` format comes from `formatWorklogStarted` in `core/src/jira/worklogService.ts` (`yyyy-MM-dd'T'HH:mm:ss.SSS±HHmm`). Do not hand-roll a second formatter.
- `worklogStarted` travels as ISO 8601 UTC string (`new Date(local).toISOString()`), converted to Jira format only in core.
- Behavior when `worklogStarted` absent must be byte-identical to today (no `started` key in payload).

---

### Task 1: Core — `performTransitionWithData` accepts `worklogStarted`

**Files:**
- Modify: `core/src/jira/issueService.ts` (method at ~line 584, worklog shaping at ~line 602)
- Test: `core/test/services.test.ts` (describe `JiraIssueService transitions`, ~line 156)

**Interfaces:**
- Consumes: `formatWorklogStarted(started: Date): string` from `core/src/jira/worklogService.ts` (already exported).
- Produces: `performTransitionWithData(issueKey, transitionId, fields, comment?, assignee?, timeSpent?, worklogStarted?: string | null): Promise<void>`. Later tasks pass `worklogStarted` as the 7th argument.

- [ ] **Step 1: Write the failing test**

Add to `core/test/services.test.ts` inside `describe('JiraIssueService transitions', ...)`:

```ts
it('adds started to the transition worklog when worklogStarted is given', async () => {
  const session = makeSession('datacenter');
  const { fn, calls } = mockFetch(() => null);
  const svc = new JiraIssueService(session, fn);

  await svc.performTransitionWithData('ISW-1', '5', {}, null, null, '3h', '2026-08-20T10:30:00.000Z');

  const body = calls[0].opts.body as any;
  const add = body.update.worklog[0].add;
  expect(add.timeSpent).toBe('3h');
  // Local-time render of the UTC instant; check shape + preserved minutes.
  expect(add.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
  expect(new Date('2026-08-20T10:30:00.000Z').getMinutes()).toBe(new Date(add.started).getMinutes());
});

it('omits started when worklogStarted is absent', async () => {
  const session = makeSession('datacenter');
  const { fn, calls } = mockFetch(() => null);
  const svc = new JiraIssueService(session, fn);

  await svc.performTransitionWithData('ISW-1', '5', {}, null, null, '3h');

  const add = (calls[0].opts.body as any).update.worklog[0].add;
  expect(add).toEqual({ timeSpent: '3h' });
});
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npm run test --workspace core -- services`
Expected: first new test FAILS (`add.started` undefined); second passes already.

- [ ] **Step 3: Implement**

In `core/src/jira/issueService.ts`:

Add import at top (near other jira imports):

```ts
import { formatWorklogStarted } from './worklogService.js';
```

(If `worklogService.ts` imports from `issueService.ts` and this creates a cycle, instead move `formatWorklogStarted` usage via a direct re-implementation is NOT allowed — check first with grep; as of writing `worklogService.ts` does not import `issueService.ts`, so the plain import is fine.)

Extend the signature (keep doc comment in sync — add a line `- worklogStarted → started on the worklog add;`):

```ts
async performTransitionWithData(
  issueKey: string,
  transitionId: string,
  fields: Record<string, unknown>,
  comment?: string | null,
  assignee?: string | null,
  timeSpent?: string | null,
  worklogStarted?: string | null,
): Promise<void> {
```

Replace the worklog shaping block:

```ts
if (timeSpent && timeSpent.trim().length > 0) {
  const add: Record<string, unknown> = { timeSpent };
  if (worklogStarted && worklogStarted.trim().length > 0) {
    add.started = formatWorklogStarted(new Date(worklogStarted));
  }
  update.worklog = [{ add }];
}
```

- [ ] **Step 4: Run core tests**

Run: `npm run test --workspace core`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add core/src/jira/issueService.ts core/test/services.test.ts
git commit -m "feat(core): accept worklogStarted on transition worklogs"
```

---

### Task 2: Plumbing — server route, native dispatch, client API type

**Files:**
- Modify: `server/src/routes/issues.ts` (POST `/:key/transitions`, ~lines 110-139)
- Modify: `core/src/dispatch.ts` (transitions branch, ~lines 476-493)
- Modify: `client/src/api/client.ts` (`performTransition`, ~line 208)
- Test: `core/test/dispatch.test.ts` (~lines 171-176)

**Interfaces:**
- Consumes: `performTransitionWithData(..., timeSpent, worklogStarted)` from Task 1.
- Produces: HTTP/dispatch body field `worklogStarted?: string` (ISO 8601). Client type: `performTransition(key, { id, fields?, comment?, assignee?, timeSpent?, worklogStarted? })`.

- [ ] **Step 1: Update the existing dispatch test and add a forwarding test**

In `core/test/dispatch.test.ts`, the existing expectation (~line 175) gains a trailing `null`:

```ts
expect(withData).toHaveBeenCalledWith('ABC-1', '5', {}, 'note', null, null, null);
```

Add below it:

```ts
it('forwards worklogStarted to the extended call', async () => {
  const { core, dispatch } = harness();
  const withData = vi.spyOn(core.issues, 'performTransitionWithData').mockResolvedValue(undefined as never);
  await dispatch('POST', '/api/issues/ABC-1/transitions', {
    id: '5',
    timeSpent: '1h',
    worklogStarted: '2026-08-20T10:30:00.000Z',
  });
  expect(withData).toHaveBeenCalledWith('ABC-1', '5', {}, null, null, '1h', '2026-08-20T10:30:00.000Z');
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npm run test --workspace core -- dispatch`
Expected: FAIL — existing test (6 args vs 7) and new test.

- [ ] **Step 3: Implement dispatch + server route + client type**

`core/src/dispatch.ts` transitions branch:

```ts
const timeSpent = optStr(b.timeSpent);
const worklogStarted = optStr(b.worklogStarted);
if (fields || comment || assignee || timeSpent) {
  await core.issues.performTransitionWithData(key, id, fields ?? {}, comment, assignee, timeSpent, worklogStarted);
}
```

`server/src/routes/issues.ts` POST `/:key/transitions`:

```ts
const timeSpent = typeof body.timeSpent === 'string' ? body.timeSpent : null;
const worklogStarted = typeof body.worklogStarted === 'string' ? body.worklogStarted : null;

if (fields || comment || assignee || timeSpent) {
  await deps.issues.performTransitionWithData(
    req.params.key,
    id,
    fields ?? {},
    comment,
    assignee,
    timeSpent,
    worklogStarted,
  );
}
```

`client/src/api/client.ts` `performTransition` body type gains:

```ts
worklogStarted?: string;
```

- [ ] **Step 4: Run core + server tests**

Run: `npm run test --workspace core && npm run test --workspace server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/dispatch.ts core/test/dispatch.test.ts server/src/routes/issues.ts client/src/api/client.ts
git commit -m "feat: plumb worklogStarted through transition routes"
```

---

### Task 3: Shared `DateTimeField` component + Transition dialog "Date Started"

**Files:**
- Create: `client/src/components/DateTimeField.tsx`
- Modify: `client/src/lib/timeFormat.ts` (add `nowLocalInput`)
- Modify: `client/src/dialogs/TransitionDialog.tsx`
- Modify: `client/src/dialogs/LogWork.tsx` (delete its private `nowLocalInput`, import shared one — full swap to DateTimeField happens in Task 4)
- Test: `client/test/dialogs.test.tsx`

**Interfaces:**
- Consumes: `performTransition` body with `worklogStarted?: string` from Task 2.
- Produces:
  - `nowLocalInput(): string` in `client/src/lib/timeFormat.ts` — `yyyy-MM-ddTHH:mm` local, for datetime-local inputs.
  - `DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element` in `client/src/components/DateTimeField.tsx` — datetime-local input + calendar button (`aria-label="Pick date"`) that calls `showPicker()` with `focus()` fallback.

- [ ] **Step 1: Write failing dialog tests**

Add to `client/test/dialogs.test.tsx` (uses existing `tf` helper and `renderToString`):

```tsx
it('shows Date Started when the screen has a worklog field', () => {
  const html = renderToString(
    <TransitionDialog
      issueKey="ISW-7"
      transition={{ id: '31', name: 'Close Issue', toStatus: 'Closed' }}
      fields={[tf({ id: 'worklog', name: 'Worklog' })]}
      onClose={noop}
    />,
  );
  expect(html).toContain('Date Started');
  expect(html).toContain('datetime-local');
  expect(html).toContain('Pick date');
});

it('hides Date Started when the screen has no worklog field', () => {
  const html = renderToString(
    <TransitionDialog
      issueKey="ISW-7"
      transition={{ id: '31', name: 'Close Issue', toStatus: 'Closed' }}
      fields={[tf({ id: 'resolution', name: 'Resolution', schemaType: 'resolution', allowedValues: ['Fixed'] })]}
      onClose={noop}
    />,
  );
  expect(html).not.toContain('Date Started');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test --workspace client -- dialogs`
Expected: first new test FAILS.

- [ ] **Step 3: Implement**

`client/src/lib/timeFormat.ts` — append (moved verbatim from `LogWork.tsx`):

```ts
/** Current local time as a datetime-local input value: yyyy-MM-ddTHH:mm. */
export function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

`client/src/components/DateTimeField.tsx` — new file:

```tsx
// datetime-local input + explicit calendar button. The native picker
// indicator is easy to miss in the dark theme; the button opens the same
// native picker via showPicker().

import { useRef } from 'react';

export function DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        ref={ref}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1 }}
      />
      <button type="button" className="btn" onClick={openPicker} title="Pick date" aria-label="Pick date">
        📅
      </button>
    </div>
  );
}
```

`client/src/dialogs/LogWork.tsx` — delete its private `nowLocalInput` (lines 28-32) and import instead:

```ts
import { nowLocalInput, parseJiraTime } from '../lib/timeFormat';
```

`client/src/dialogs/TransitionDialog.tsx`:

Imports:

```ts
import { DateTimeField } from '../components/DateTimeField';
import { nowLocalInput } from '../lib/timeFormat';
```

State (next to `comment`):

```ts
const hasWorklog = useMemo(() => formFields.some((f) => f.id === 'worklog'), [formFields]);
const [worklogStarted, setWorklogStarted] = useState(nowLocalInput());
```

In `submit()`, extend the `performTransition` call:

```ts
await issuesApi.performTransition(issueKey, {
  id: transition.id,
  fields: Object.keys(shaped).length > 0 ? shaped : undefined,
  comment: comment.trim() ? comment : undefined,
  assignee,
  timeSpent,
  worklogStarted: timeSpent ? new Date(worklogStarted).toISOString() : undefined,
});
```

In the JSX, render the row directly after each field row — insert inside the `formFields.map`, right after `{renderControl(f)}`, conditional on the worklog field so the date row sits under "Time Spent":

```tsx
{f.id === 'worklog' && hasWorklog && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
    <label>Date Started</label>
    <DateTimeField value={worklogStarted} onChange={setWorklogStarted} />
  </div>
)}
```

- [ ] **Step 4: Run client tests**

Run: `npm run test --workspace client`
Expected: PASS (all — including untouched LogWork tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/DateTimeField.tsx client/src/lib/timeFormat.ts client/src/dialogs/TransitionDialog.tsx client/src/dialogs/LogWork.tsx client/test/dialogs.test.tsx
git commit -m "feat(client): Date Started picker on transition worklog"
```

---

### Task 4: Log Work dialog uses DateTimeField + theme CSS for picker indicator

**Files:**
- Modify: `client/src/dialogs/LogWork.tsx` (Date Started row, ~lines 136-146)
- Modify: `client/src/theme.css` (near the input rules, ~line 230)
- Test: `client/test/dialogs.test.tsx`

**Interfaces:**
- Consumes: `DateTimeField` from Task 3.
- Produces: nothing new — UI/CSS polish.

- [ ] **Step 1: Write the failing test**

Add to `client/test/dialogs.test.tsx`:

```tsx
it('LogWork renders the Date Started picker button', () => {
  const html = renderToString(<LogWork issueKey="ISW-7" onClose={noop} />);
  expect(html).toContain('Date Started');
  expect(html).toContain('Pick date');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace client -- dialogs`
Expected: FAIL (`Pick date` missing).

- [ ] **Step 3: Implement**

`client/src/dialogs/LogWork.tsx` — replace the bare input in the "Date Started" block:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
  <label>
    Date Started<span style={{ color: 'var(--accent-red)' }}> *</span>
  </label>
  <DateTimeField value={started} onChange={setStarted} />
</div>
```

with import:

```ts
import { DateTimeField } from '../components/DateTimeField';
```

`client/src/theme.css` — add after the `input:focus` block (~line 254):

```css
/* Native date/datetime picker indicator: visible in the dark theme and
   clearly clickable. color-scheme handles the popup itself. */
input[type='date']::-webkit-calendar-picker-indicator,
input[type='datetime-local']::-webkit-calendar-picker-indicator {
  opacity: 1;
  cursor: pointer;
}
```

(No `filter: invert()` needed: the app sets `color-scheme: dark`/`light` on the themes — `client/src/theme.css:38,72` — which already renders the indicator for the active scheme; the fix is opacity + cursor.)

- [ ] **Step 4: Run client tests**

Run: `npm run test --workspace client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/dialogs/LogWork.tsx client/src/theme.css client/test/dialogs.test.tsx
git commit -m "feat(client): calendar button + visible picker indicator in Log Work"
```

---

## Final verification

- [ ] Run full suite: `npm test` (root — core, server, client). Expected: PASS.
- [ ] Manual smoke: open app, transition an issue whose screen has a worklog field → "Date Started" under "Time Spent", calendar button opens picker, worklog lands on the chosen date in Jira.
