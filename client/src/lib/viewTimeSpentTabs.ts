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
