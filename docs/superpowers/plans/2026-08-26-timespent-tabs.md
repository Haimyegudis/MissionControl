# Time Spent Tabs (Calendar / Epics / Sprint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Calendar, Epics, and Sprint tabs to the Time Spent view — month calendar of logged work with current-sprint highlighting, epic-grouped logged work for the last X days, and a current-sprint board with Estimated/Logged/Remaining bars plus one-click Start (To Do → In Progress). All tabs follow the existing user picker (empty = me).

**Architecture:** Pure logic in a new `client/src/lib/viewTimeSpentTabs.ts` (unit-tested), three presentational tab components in `client/src/views/timespent/`, and a thin tab strip inside `TimeLoggedView` that keeps the existing Report content untouched. No new server/core endpoints — data comes from `timelogged.report('customRange', …)`, `issues.search`, `issues.transitions`, and `JiraIssue.allSprints`/`epicKey`/`epicName`.

**Tech Stack:** TypeScript, React, Vitest. Client workspace only.

**Spec:** `docs/superpowers/specs/2026-08-26-timespent-tabs-design.md`

## Global Constraints

- Tests: `npm run test --workspace client` (Vitest). Component tests use `renderToString` from `react-dom/server` — markup assertions only; interaction logic must live in the pure lib so it is unit-testable.
- Report tab content, period chips, CSV/PDF export, timesheet, and heatmap are untouched.
- User picker (`UserSearchPicker`, `userFilter` state, empty string = signed-in user) applies to all tabs.
- Reuse existing helpers: `statusColor`, `formatTimeSpan`, `hoursDisplay`, `ymd`/`addDays`/`parseYmd` from `lib/viewFormat`, `dialogs.openIssueDetails`/`openTransition`, `pushToast`.
- `JiraTransition` has `toStatus` only (no category) — Start picks by name per spec.
- Dates handled as local `Date` / `yyyy-MM-dd` strings, consistent with `viewFormat`.

---

### Task 1: Pure logic — `viewTimeSpentTabs.ts`

**Files:**
- Create: `client/src/lib/viewTimeSpentTabs.ts`
- Test: `client/test/viewTimeSpentTabs.test.ts`

**Interfaces:**
- Consumes: `DailyLogEntry`, `JiraIssue`, `JiraTransition`, `SprintInfo` from `client/src/types.ts`; `parseYmd`, `ymd` from `client/src/lib/viewFormat`.
- Produces (exact signatures later tasks import):

```ts
export interface CalendarDayCell {
  /** yyyy-MM-dd */
  day: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  inSprint: boolean;
  /** Sorted by hours desc. */
  entries: Array<{ issueKey: string; hours: number }>;
  totalHours: number;
}
export interface CalendarMonth {
  /** Full weeks, Sunday-first; 4-6 rows of 7 cells. */
  weeks: CalendarDayCell[][];
  monthLabel: string; // e.g. "August 2026"
}
export function buildCalendarMonth(
  year: number,
  monthIndex0: number,
  daily: readonly DailyLogEntry[],
  sprintRange: { start: string; end: string } | null,
  today: Date,
): CalendarMonth;

export function activeSprintRange(
  issues: readonly JiraIssue[],
): { name: string; start: string; end: string } | null;

export interface EpicGroup {
  epicKey: string | null;
  epicName: string;      // "No epic" when epicKey is null
  issues: Array<{ key: string; summary: string; seconds: number }>;
  totalSeconds: number;
}
export function groupByEpic(issues: readonly JiraIssue[]): EpicGroup[];

export function formatEpicTotal(seconds: number): string; // "52.00 hours (6.50 days @ 8h/day)"

export interface SprintBarRow {
  estimated: number; logged: number; remaining: number; // seconds
  /** Percent widths 0-100 scaled to the row max (0 when the value is 0). */
  estimatedPct: number; loggedPct: number; remainingPct: number;
}
export function sprintBars(issue: JiraIssue): SprintBarRow;

export function pickStartTransition(transitions: readonly JiraTransition[]): JiraTransition | null;
```

- [ ] **Step 1: Write the failing tests**

`client/test/viewTimeSpentTabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  activeSprintRange,
  buildCalendarMonth,
  formatEpicTotal,
  groupByEpic,
  pickStartTransition,
  sprintBars,
} from '../src/lib/viewTimeSpentTabs';
import type { DailyLogEntry, JiraIssue, JiraTransition } from '../src/types';

const issue = (p: Partial<JiraIssue>): JiraIssue => ({ ...(p as JiraIssue) });

describe('buildCalendarMonth', () => {
  const daily: DailyLogEntry[] = [
    { issueKey: 'A-1', day: '2026-08-03', timeSpent: 7200 } as DailyLogEntry,
    { issueKey: 'A-2', day: '2026-08-03', timeSpent: 3600 } as DailyLogEntry,
    { issueKey: 'A-1', day: '2026-08-26', timeSpent: 28800 } as DailyLogEntry,
  ];
  const month = buildCalendarMonth(2026, 7, daily, { start: '2026-08-23', end: '2026-09-10' }, new Date(2026, 7, 26));

  it('lays out full Sunday-first weeks covering the month', () => {
    expect(month.monthLabel).toBe('August 2026');
    expect(month.weeks.length).toBeGreaterThanOrEqual(5);
    for (const w of month.weeks) expect(w).toHaveLength(7);
    // Aug 1 2026 is a Saturday — first row starts Sun Jul 26.
    expect(month.weeks[0][0].day).toBe('2026-07-26');
    expect(month.weeks[0][6].day).toBe('2026-08-01');
    expect(month.weeks[0][6].inMonth).toBe(true);
    expect(month.weeks[0][0].inMonth).toBe(false);
  });

  it('aggregates entries per day sorted by hours desc, with totals', () => {
    const aug3 = month.weeks.flat().find((c) => c.day === '2026-08-03')!;
    expect(aug3.entries).toEqual([
      { issueKey: 'A-1', hours: 2 },
      { issueKey: 'A-2', hours: 1 },
    ]);
    expect(aug3.totalHours).toBe(3);
  });

  it('marks today and sprint-range cells', () => {
    const aug26 = month.weeks.flat().find((c) => c.day === '2026-08-26')!;
    expect(aug26.isToday).toBe(true);
    expect(aug26.inSprint).toBe(true);
    const aug22 = month.weeks.flat().find((c) => c.day === '2026-08-22')!;
    expect(aug22.inSprint).toBe(false);
  });
});

describe('activeSprintRange', () => {
  it('returns the first active sprint with dates', () => {
    const issues = [
      issue({ allSprints: [{ name: 'S1', state: 'closed', startDate: '2026-08-01', endDate: '2026-08-14' }] }),
      issue({
        allSprints: [{ name: 'S2', state: 'active', startDate: '2026-08-23T00:00:00.000Z', endDate: '2026-09-10T00:00:00.000Z' }],
      }),
    ];
    expect(activeSprintRange(issues)).toEqual({ name: 'S2', start: '2026-08-23', end: '2026-09-10' });
  });
  it('returns null when no active sprint has dates', () => {
    expect(activeSprintRange([issue({ allSprints: [{ name: 'S', state: 'active', startDate: null, endDate: null }] })])).toBeNull();
    expect(activeSprintRange([])).toBeNull();
  });
});

describe('groupByEpic', () => {
  it('groups logged issues by epic, sorted by total desc, no-epic last', () => {
    const groups = groupByEpic([
      issue({ key: 'A-1', summary: 's1', epicKey: 'E-1', epicName: 'Epic One', workLoggedForPeriod: 3600 }),
      issue({ key: 'A-2', summary: 's2', epicKey: 'E-2', epicName: 'Epic Two', workLoggedForPeriod: 7200 }),
      issue({ key: 'A-3', summary: 's3', epicKey: 'E-1', epicName: 'Epic One', workLoggedForPeriod: 1800 }),
      issue({ key: 'A-4', summary: 's4', epicKey: null, epicName: null, workLoggedForPeriod: 60 }),
      issue({ key: 'A-5', summary: 's5', epicKey: 'E-3', epicName: 'Empty', workLoggedForPeriod: 0 }),
    ]);
    expect(groups.map((g) => g.epicKey)).toEqual(['E-2', 'E-1', null]);
    expect(groups[1].totalSeconds).toBe(5400);
    expect(groups[1].issues.map((i) => i.key)).toEqual(['A-1', 'A-3']);
    expect(groups[2].epicName).toBe('No epic');
  });
});

describe('formatEpicTotal', () => {
  it('formats hours and 8h-days', () => {
    expect(formatEpicTotal(52 * 3600)).toBe('52.00 hours (6.50 days @ 8h/day)');
    expect(formatEpicTotal(0)).toBe('0.00 hours (0.00 days @ 8h/day)');
  });
});

describe('sprintBars', () => {
  it('scales bars to the row max', () => {
    const bars = sprintBars(issue({ originalEstimate: 28800, timeSpent: 14400, remainingEstimate: 14400 }));
    expect(bars.estimatedPct).toBe(100);
    expect(bars.loggedPct).toBe(50);
    expect(bars.remainingPct).toBe(50);
  });
  it('all zero → zero widths', () => {
    const bars = sprintBars(issue({ originalEstimate: null, timeSpent: null, remainingEstimate: null }));
    expect(bars).toMatchObject({ estimatedPct: 0, loggedPct: 0, remainingPct: 0 });
  });
});

describe('pickStartTransition', () => {
  const t = (id: string, name: string, toStatus: string | null): JiraTransition => ({ id, name, toStatus });
  it('prefers exact toStatus "In Progress" (case-insensitive)', () => {
    expect(pickStartTransition([t('1', 'Reject', 'Rejected'), t('2', 'Start', 'in progress')])?.id).toBe('2');
  });
  it('falls back to toStatus or name containing "progress"', () => {
    expect(pickStartTransition([t('1', 'Go', 'Dev In Progress')])?.id).toBe('1');
    expect(pickStartTransition([t('1', 'Move to progress', null)])?.id).toBe('1');
  });
  it('null when nothing matches', () => {
    expect(pickStartTransition([t('1', 'Close', 'Done')])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace client -- viewTimeSpentTabs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `client/src/lib/viewTimeSpentTabs.ts`**

```ts
// Time Spent tabs pure logic: month calendar assembly, active-sprint range,
// epic grouping, sprint bars, and the To Do → In Progress transition pick.

import type { DailyLogEntry, JiraIssue, JiraTransition } from '../types';
import { parseYmd, ymd } from './viewFormat';

export interface CalendarDayCell {
  day: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  inSprint: boolean;
  entries: Array<{ issueKey: string; hours: number }>;
  totalHours: number;
}

export interface CalendarMonth {
  weeks: CalendarDayCell[][];
  monthLabel: string;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function buildCalendarMonth(
  year: number,
  monthIndex0: number,
  daily: readonly DailyLogEntry[],
  sprintRange: { start: string; end: string } | null,
  today: Date,
): CalendarMonth {
  const byDay = new Map<string, Map<string, number>>();
  for (const e of daily) {
    const perIssue = byDay.get(e.day) ?? new Map<string, number>();
    perIssue.set(e.issueKey, (perIssue.get(e.issueKey) ?? 0) + e.timeSpent);
    byDay.set(e.day, perIssue);
  }

  const first = new Date(year, monthIndex0, 1);
  const start = new Date(year, monthIndex0, 1 - first.getDay()); // back to Sunday
  const todayKey = ymd(today);
  const weeks: CalendarDayCell[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarDayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const key = ymd(cursor);
      const perIssue = byDay.get(key);
      const entries = perIssue
        ? [...perIssue.entries()]
            .map(([issueKey, seconds]) => ({ issueKey, hours: seconds / 3600 }))
            .sort((a, b) => b.hours - a.hours)
        : [];
      week.push({
        day: key,
        dayNumber: cursor.getDate(),
        inMonth: cursor.getMonth() === monthIndex0,
        isToday: key === todayKey,
        inSprint: sprintRange !== null && key >= sprintRange.start && key <= sprintRange.end,
        entries,
        totalHours: entries.reduce((s, e) => s + e.hours, 0),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === monthIndex0);
  return { weeks, monthLabel: `${MONTHS[monthIndex0]} ${year}` };
}

/** First active sprint (with both dates) across the issues' sprint lists. */
export function activeSprintRange(issues: readonly JiraIssue[]): { name: string; start: string; end: string } | null {
  for (const issue of issues) {
    for (const s of issue.allSprints ?? []) {
      if (s.state?.toLowerCase() !== 'active' || !s.startDate || !s.endDate) continue;
      return { name: s.name, start: s.startDate.slice(0, 10), end: s.endDate.slice(0, 10) };
    }
  }
  return null;
}

export interface EpicGroup {
  epicKey: string | null;
  epicName: string;
  issues: Array<{ key: string; summary: string; seconds: number }>;
  totalSeconds: number;
}

/** Group period-logged issues by epic; zero-logged issues are dropped; "No epic" last. */
export function groupByEpic(issues: readonly JiraIssue[]): EpicGroup[] {
  const map = new Map<string | null, EpicGroup>();
  for (const i of issues) {
    const seconds = i.workLoggedForPeriod ?? 0;
    if (seconds <= 0) continue;
    const key = i.epicKey ?? null;
    const group = map.get(key) ?? {
      epicKey: key,
      epicName: key === null ? 'No epic' : i.epicName || key,
      issues: [],
      totalSeconds: 0,
    };
    group.issues.push({ key: i.key, summary: i.summary, seconds });
    group.totalSeconds += seconds;
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => {
    if ((a.epicKey === null) !== (b.epicKey === null)) return a.epicKey === null ? 1 : -1;
    return b.totalSeconds - a.totalSeconds;
  });
}

export function formatEpicTotal(seconds: number): string {
  const hours = seconds / 3600;
  return `${hours.toFixed(2)} hours (${(hours / 8).toFixed(2)} days @ 8h/day)`;
}

export interface SprintBarRow {
  estimated: number; logged: number; remaining: number;
  estimatedPct: number; loggedPct: number; remainingPct: number;
}

export function sprintBars(issue: JiraIssue): SprintBarRow {
  const estimated = issue.originalEstimate ?? 0;
  const logged = issue.timeSpent ?? 0;
  const remaining = issue.remainingEstimate ?? 0;
  const max = Math.max(estimated, logged, remaining);
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return { estimated, logged, remaining, estimatedPct: pct(estimated), loggedPct: pct(logged), remainingPct: pct(remaining) };
}

/** Transition that lands the issue in progress: exact toStatus match, then fuzzy. */
export function pickStartTransition(transitions: readonly JiraTransition[]): JiraTransition | null {
  const exact = transitions.find((t) => (t.toStatus ?? '').toLowerCase() === 'in progress');
  if (exact) return exact;
  return (
    transitions.find(
      (t) => (t.toStatus ?? '').toLowerCase().includes('progress') || t.name.toLowerCase().includes('progress'),
    ) ?? null
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace client -- viewTimeSpentTabs`
Expected: PASS. Then the full suite: `npm run test --workspace client`.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/viewTimeSpentTabs.ts client/test/viewTimeSpentTabs.test.ts
git commit -m "feat(client): pure logic for Time Spent calendar/epics/sprint tabs"
```

---

### Task 2: Calendar tab component + tab strip in TimeLoggedView

**Files:**
- Create: `client/src/views/timespent/CalendarTab.tsx`
- Modify: `client/src/views/TimeLoggedView.tsx`
- Test: `client/test/timeSpentTabs.test.tsx` (create)

**Interfaces:**
- Consumes: `buildCalendarMonth`, `activeSprintRange` (Task 1); `timelogged.report('customRange', { from, to, user })`; `dialogs.openIssueDetails`.
- Produces: `CalendarTab({ user }: { user: string })` — `user` is the raw `userFilter` string ('' = me). Tab strip state `tab: 'report' | 'calendar' | 'epics' | 'sprint'` in `TimeLoggedView`; Report renders existing JSX unchanged.

- [ ] **Step 1: Write failing render tests**

`client/test/timeSpentTabs.test.tsx`:

```tsx
// Time Spent tab strip + tab components render (renderToString smoke).
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('../src/api/client', () => ({
  timelogged: { report: vi.fn(async () => ({ issues: [], total: 0, fromUtc: '', toUtc: '', dailyByIssue: [], availableSprints: [] })) },
  issues: { search: vi.fn(async () => ({ items: [], total: 0 })), transitions: vi.fn(async () => []), transitionScreen: vi.fn(async () => []), performTransition: vi.fn(async () => undefined) },
  metadata: { searchableUsers: vi.fn(async () => []) },
}));

import { CalendarTab } from '../src/views/timespent/CalendarTab';

describe('CalendarTab', () => {
  it('renders month title, weekday headers and nav buttons', () => {
    const html = renderToString(<CalendarTab user="" />);
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toContain('Today');
    expect(html).toContain('Sun');
    expect(html).toContain('Sat');
  });
});
```

(Adapt the `../src/api/client` mock shape to the module's real exports — check how existing view tests mock it, e.g. `client/test/views.test.tsx`, and mirror that. The initial fetch fires in `useEffect`, which `renderToString` never runs — no async handling needed.)

- [ ] **Step 2: Run to verify failure** — `npm run test --workspace client -- timeSpentTabs` → FAIL (module missing).

- [ ] **Step 3: Implement `CalendarTab.tsx`**

```tsx
// Month calendar of logged work. Sprint-range days tinted, today highlighted.

import { useEffect, useMemo, useState } from 'react';
import { timelogged } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { errText } from '../../lib/errors';
import { ymd } from '../../lib/viewFormat';
import { activeSprintRange, buildCalendarMonth } from '../../lib/viewTimeSpentTabs';
import type { TimeLoggedReport } from '../../types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LINES = 3;

export function CalendarTab({ user }: { user: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const from = ymd(new Date(year, month, 1));
    const to = ymd(new Date(year, month + 1, 0));
    setBusy(true);
    setError(null);
    timelogged
      .report('customRange', { from, to, ...(user.trim() ? { user } : {}) })
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(errText(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [year, month, user]);

  const sprint = useMemo(() => activeSprintRange(report?.issues ?? []), [report]);
  const cal = useMemo(
    () => buildCalendarMonth(year, month, report?.dailyByIssue ?? [], sprint, new Date()),
    [year, month, report, sprint],
  );

  const nav = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn" onClick={() => nav(-1)}>◀ Previous</button>
        <div style={{ fontWeight: 700, fontSize: 15, minWidth: 140, textAlign: 'center' }}>{cal.monthLabel}</div>
        <button className="btn" onClick={() => nav(1)}>Next ▶</button>
        <button className="btn" onClick={() => { const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth()); }}>
          Today
        </button>
        {busy ? <span className="accent-cyan">…</span> : null}
        {sprint ? (
          <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
            Sprint {sprint.name}: {sprint.start} → {sprint.end}
          </span>
        ) : null}
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      <div className="card" style={{ padding: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="muted" style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px' }}>{d}</div>
          ))}
          {cal.weeks.flat().map((cell) => (
            <div
              key={cell.day}
              style={{
                minHeight: 86,
                borderRadius: 6,
                padding: '4px 6px',
                border: cell.isToday ? '2px solid var(--accent-green)' : '1px solid var(--border-soft)',
                background: cell.inSprint ? 'color-mix(in srgb, var(--accent-cyan) 9%, transparent)' : undefined,
                opacity: cell.inMonth ? 1 : 0.4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700 }}>{cell.dayNumber}</div>
              {cell.entries.slice(0, MAX_LINES).map((e) => (
                <button
                  key={e.issueKey}
                  type="button"
                  onClick={() => dialogs.openIssueDetails(e.issueKey)}
                  style={{ display: 'block', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}
                >
                  {e.issueKey}: {e.hours.toFixed(1)}h
                </button>
              ))}
              {cell.entries.length > MAX_LINES ? (
                <div className="muted" style={{ fontSize: 10.5 }}>+{cell.entries.length - MAX_LINES} more</div>
              ) : null}
              {cell.totalHours > 0 ? (
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent-green)' }}>Total: {cell.totalHours.toFixed(1)}h</div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 10.5, padding: '6px 4px 0' }}>
          ▦ tinted = current sprint · outlined = today
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Tab strip in `TimeLoggedView.tsx`**

Add state + import (top of component):

```ts
const [tab, setTab] = useState<'report' | 'calendar' | 'epics' | 'sprint'>('report');
```

In the toolbar JSX, insert a tab row ABOVE the existing toolbar (period chips etc. render only when `tab === 'report'`; the `UserSearchPicker` moves up into the tab row so it applies everywhere):

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
  <h2 style={{ fontSize: 18, fontFamily: 'var(--font-display)' }}>Time Spent</h2>
  <div style={{ display: 'flex', gap: 4 }}>
    {(['report', 'calendar', 'epics', 'sprint'] as const).map((t) => (
      <button
        key={t}
        className="btn"
        onClick={() => setTab(t)}
        style={tab === t ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', fontWeight: 700 } : undefined}
      >
        {t === 'report' ? 'Report' : t === 'calendar' ? 'Calendar' : t === 'epics' ? 'Epics' : 'Sprint'}
      </button>
    ))}
  </div>
  <UserSearchPicker users={users} value={userFilter} onCommit={setUserFilter} />
</div>
```

Wrap the ENTIRE existing content (old toolbar minus the picker, hero, issues panel, timesheet, heatmap, print block) in `{tab === 'report' ? (<>…</>) : null}` and add:

```tsx
{tab === 'calendar' ? <CalendarTab user={userFilter} /> : null}
{tab === 'epics' ? <EpicsTab user={userFilter} /> : null}
{tab === 'sprint' ? <SprintTab user={userFilter} /> : null}
```

For THIS task, create placeholder `EpicsTab`/`SprintTab` imports only if you also stub them — DO NOT. Instead reference only `CalendarTab` and render `null` for the other two tabs with a `muted` "coming in next task" placeholder REMOVED — simply omit the epics/sprint branches until Tasks 3-4 add them (keep the tab buttons limited to `['report', 'calendar']` in this task; Tasks 3/4 each extend the array).

- [ ] **Step 5: Run tests** — `npm run test --workspace client` → PASS (existing TimeLoggedView tests must stay green; if `client/test/viewsSmoke.test.tsx` or `views.test.tsx` snapshot the view, update mocks accordingly).

- [ ] **Step 6: Commit**

```bash
git add client/src/views/timespent/CalendarTab.tsx client/src/views/TimeLoggedView.tsx client/test/timeSpentTabs.test.tsx
git commit -m "feat(client): Time Spent tab strip + month calendar tab"
```

---

### Task 3: Epics tab

**Files:**
- Create: `client/src/views/timespent/EpicsTab.tsx`
- Modify: `client/src/views/TimeLoggedView.tsx` (extend tab array with 'epics', render branch)
- Test: `client/test/timeSpentTabs.test.tsx` (extend)

**Interfaces:**
- Consumes: `groupByEpic`, `formatEpicTotal` (Task 1); `timelogged.report`; `formatTimeSpan`; `dialogs.openIssueDetails`.
- Produces: `EpicsTab({ user }: { user: string })`.

- [ ] **Step 1: Failing test** (extend `timeSpentTabs.test.tsx`):

```tsx
import { EpicsTab } from '../src/views/timespent/EpicsTab';

describe('EpicsTab', () => {
  it('renders the days-back control and empty state', () => {
    const html = renderToString(<EpicsTab user="" />);
    expect(html).toContain('Days to look back');
    expect(html).toContain('value="30"');
  });
});
```

- [ ] **Step 2: Verify failure** — module missing.

- [ ] **Step 3: Implement `EpicsTab.tsx`**

```tsx
// Work logged in the last X days, grouped by epic (reference: "Features Log").

import { useEffect, useMemo, useState } from 'react';
import { timelogged } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { errText } from '../../lib/errors';
import { formatTimeSpan } from '../../lib/format';
import { addDays, ymd } from '../../lib/viewFormat';
import { formatEpicTotal, groupByEpic } from '../../lib/viewTimeSpentTabs';
import type { TimeLoggedReport } from '../../types';

export function EpicsTab({ user }: { user: string }) {
  const [daysBack, setDaysBack] = useState(30);
  const [report, setReport] = useState<TimeLoggedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const clamped = Math.min(365, Math.max(1, daysBack));
    const to = new Date();
    const from = addDays(to, -clamped);
    setBusy(true);
    setError(null);
    timelogged
      .report('customRange', { from: ymd(from), to: ymd(to), ...(user.trim() ? { user } : {}) })
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(errText(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [daysBack, user]);

  const groups = useMemo(() => groupByEpic(report?.issues ?? []), [report]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12.5 }}>Days to look back:</label>
        <input
          type="number"
          min={1}
          max={365}
          value={daysBack}
          onChange={(e) => setDaysBack(Number(e.target.value) || 30)}
          style={{ width: 70 }}
        />
        {busy ? <span className="accent-cyan">…</span> : null}
        <span className="muted" style={{ fontSize: 11.5 }}>
          {groups.length} epic group(s) with logged time
        </span>
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      {groups.length === 0 && !busy ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No work logged in this window.</div>
      ) : (
        groups.map((g) => (
          <div key={g.epicKey ?? 'none'} className="card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{g.epicName}</span>
              {g.epicKey ? (
                <button
                  type="button"
                  onClick={() => dialogs.openIssueDetails(g.epicKey!)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                >
                  {g.epicKey}
                </button>
              ) : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {g.issues.map((i) => (
                <div key={i.key} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
                  <button
                    type="button"
                    onClick={() => dialogs.openIssueDetails(i.key)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  >
                    {i.key}
                  </button>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent-green)', whiteSpace: 'nowrap' }}>{formatTimeSpan(i.seconds)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--accent-green)' }}>
              Total Logged Time: {formatEpicTotal(g.totalSeconds)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Extend TimeLoggedView** tab array with `'epics'` + `{tab === 'epics' ? <EpicsTab user={userFilter} /> : null}`.

- [ ] **Step 5: Run** `npm run test --workspace client` → PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/views/timespent/EpicsTab.tsx client/src/views/TimeLoggedView.tsx client/test/timeSpentTabs.test.tsx
git commit -m "feat(client): epic-grouped logged work tab"
```

---

### Task 4: Sprint tab with Start action

**Files:**
- Create: `client/src/views/timespent/SprintTab.tsx`
- Modify: `client/src/views/TimeLoggedView.tsx` (extend tab array with 'sprint', render branch)
- Test: `client/test/timeSpentTabs.test.tsx` (extend)

**Interfaces:**
- Consumes: `sprintBars`, `activeSprintRange`, `pickStartTransition` (Task 1); `issues.search`, `issues.transitions`, `issues.transitionScreen`, `issues.performTransition`; `metadataExtra.resolveUser`; `statusColor`; `dialogs.openTransition`; `pushToast`; `getSettings().defaultProjectKey`.
- Produces: `SprintTab({ user }: { user: string })`.

- [ ] **Step 1: Failing test** (extend `timeSpentTabs.test.tsx`; add `metadataExtra: { resolveUser: vi.fn(async () => ({ username: null })) }` and `settings` store mock if the component imports `getSettings` — check how other tests mock `../src/stores/settings` and mirror):

```tsx
import { SprintTab } from '../src/views/timespent/SprintTab';

describe('SprintTab', () => {
  it('renders the empty state scaffold', () => {
    const html = renderToString(<SprintTab user="" />);
    expect(html).toContain('Current sprint');
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement `SprintTab.tsx`**

```tsx
// Current-sprint issues with Estimated/Logged/Remaining bars and a one-click
// Start (To Do → In Progress). Follows the user picker ('' = me).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { issues as issuesApi, metadataExtra } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { statusColor } from '../../lib/colors';
import { errText } from '../../lib/errors';
import { formatTimeSpan } from '../../lib/format';
import { activeSprintRange, pickStartTransition, sprintBars } from '../../lib/viewTimeSpentTabs';
import { getSettings } from '../../stores/settings';
import { pushToast } from '../../stores/toasts';
import type { JiraIssue } from '../../types';

const BARS: Array<{ key: 'estimated' | 'logged' | 'remaining'; label: string; color: string }> = [
  { key: 'estimated', label: 'Estimated', color: 'var(--accent-cyan)' },
  { key: 'logged', label: 'Logged', color: 'var(--accent-green)' },
  { key: 'remaining', label: 'Remaining', color: 'var(--accent-red)' },
];

export function SprintTab({ user }: { user: string }) {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let assignee = 'currentUser()';
      if (user.trim()) {
        const resolved = await metadataExtra.resolveUser(user).catch(() => ({ username: null }));
        assignee = `"${resolved.username ?? user}"`;
      }
      const project = getSettings().defaultProjectKey || 'ISW';
      const jql = `project = ${project} AND sprint in openSprints() AND assignee = ${assignee} ORDER BY status`;
      const page = await issuesApi.search(jql, 0, 100);
      setIssues(page.items ?? []);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const sprint = useMemo(() => activeSprintRange(issues), [issues]);

  const start = async (issue: JiraIssue) => {
    setStartingKey(issue.key);
    try {
      const transitions = await issuesApi.transitions(issue.key);
      const t = pickStartTransition(transitions);
      if (!t) {
        pushToast({ title: 'No transition', body: `No transition to In Progress available for ${issue.key}.` });
        return;
      }
      const screen = await issuesApi.transitionScreen(issue.key, t.id);
      const hasRequired = screen.some((f) => f.required && f.id !== 'comment');
      if (hasRequired) {
        dialogs.openTransition(issue.key, t, screen, () => void load());
      } else {
        await issuesApi.performTransition(issue.key, { id: t.id });
        pushToast({ title: issue.key, body: `Moved to ${t.toStatus ?? 'In Progress'}.` });
        await load();
      }
    } catch (e) {
      pushToast({ title: 'Transition failed', body: errText(e) });
    } finally {
      setStartingKey(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          Current sprint{sprint ? ` — ${sprint.name} (${sprint.start} → ${sprint.end})` : ''}
        </span>
        {busy ? <span className="accent-cyan">…</span> : null}
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{issues.length} issue(s)</span>
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
      {issues.length === 0 && !busy ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No issues in the current sprint.</div>
      ) : (
        issues.map((issue) => {
          const bars = sprintBars(issue);
          const isTodo = issue.statusCategory === 'new';
          return (
            <div key={issue.key} className="card" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => dialogs.openIssueDetails(issue.key)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12.5 }}
                >
                  {issue.key}
                </button>
                <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.summary}</span>
                <span
                  style={{
                    padding: '1px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
                    color: statusColor(issue.status), border: `1px solid ${statusColor(issue.status)}`,
                  }}
                >
                  {issue.status}
                </span>
                {isTodo ? (
                  <button className="btn" disabled={startingKey === issue.key} onClick={() => void start(issue)} style={{ fontSize: 11.5 }}>
                    ▶ Start
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
                {BARS.map((b) => (
                  <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 10.5, width: 62 }}>{b.label}:</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border-soft)', overflow: 'hidden' }}>
                      <div style={{ width: `${bars[`${b.key}Pct` as const]}%`, height: '100%', background: b.color }} />
                    </div>
                    <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', width: 52, textAlign: 'right' }}>
                      {formatTimeSpan(bars[b.key])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
```

(Verified: `PagedResult` uses `items`; `pushToast` takes `{ title, body, duration? }` — the code above already matches. Confirm `errText` import path matches other views.)

- [ ] **Step 4: Extend TimeLoggedView** tab array with `'sprint'` + render branch.

- [ ] **Step 5: Run** `npm run test --workspace client` → PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/views/timespent/SprintTab.tsx client/src/views/TimeLoggedView.tsx client/test/timeSpentTabs.test.tsx
git commit -m "feat(client): sprint board tab with start action"
```

---

## Final verification

- [ ] `npm test` (root) — all workspaces green.
- [ ] `npm run build` — tsc + vite across workspaces.
- [ ] Manual smoke: Time Spent shows 4 tabs; Calendar shows the month with sprint tint + today outline; Epics groups by epic with totals; Sprint rows show 3 bars, Start moves a To Do issue to In Progress; user picker switches all tabs to another user's data.
