// Editable weekly timesheet — pure row-merging and cell-input parsing.
// No React, no fetches. Ported from the reverted scope-first redesign's
// viewTimeSpentScope.ts (buildEditableRows / parseCellInput only).

import type { DailyLogEntry, JiraIssue } from '../types';
import { parseJiraTime } from './timeFormat';

export interface EditableRow {
  key: string;
  summary: string;
  /** hours per day, aligned with the `days` array passed to buildEditableRows */ hours: number[];
  totalHours: number;
  /** true when the row came from the sprint fallback or manual add (no logs yet) */ empty: boolean;
}

function emptyRow(days: readonly string[], key: string, summary: string): EditableRow {
  return { key, summary, hours: days.map(() => 0), totalHours: 0, empty: true };
}

/** Merge logged issues (report) + sprint issues + manual keys into ordered rows. */
export function buildEditableRows(
  days: string[],
  report: { issues: JiraIssue[]; dailyByIssue: DailyLogEntry[] } | null,
  sprintIssues: readonly JiraIssue[],
  manual: readonly { key: string; summary: string }[],
): EditableRow[] {
  const rows: EditableRow[] = [];
  const seen = new Set<string>();

  if (report) {
    const loggedIssues = [...report.issues].sort((a, b) => a.key.localeCompare(b.key));
    for (const issue of loggedIssues) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      const hours = days.map((day) => {
        const seconds = report.dailyByIssue
          .filter((e) => e.day === day && e.issueKey === issue.key)
          .reduce((sum, e) => sum + e.timeSpent, 0);
        return seconds / 3600;
      });
      rows.push({
        key: issue.key,
        summary: issue.summary,
        hours,
        totalHours: hours.reduce((sum, h) => sum + h, 0),
        empty: false,
      });
    }
  }

  const sprintSorted = [...sprintIssues]
    .filter((i) => !seen.has(i.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  for (const issue of sprintSorted) {
    if (seen.has(issue.key)) continue;
    seen.add(issue.key);
    rows.push(emptyRow(days, issue.key, issue.summary));
  }

  for (const m of manual) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    rows.push(emptyRow(days, m.key, m.summary));
  }

  return rows;
}

const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** '2' | '1.5' → hours; '2h 30m' → parseJiraTime. Returns seconds or null. */
export function parseCellInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (PLAIN_NUMBER.test(trimmed)) {
    const n = Number(trimmed);
    if (n > 0 && n <= 24) return Math.round(n * 3600);
  }

  const parsed = parseJiraTime(trimmed);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Decides whether a cell's onBlur should commit its draft, given whether the
 * cell was just cancelled via Escape. Escape must mark the cell cancelled
 * BEFORE the synchronous `.blur()` call fires — otherwise onBlur reads a
 * stale draft from the render closure and posts a worklog the user aborted
 * (worklogs can't be deleted in-app, so that bug is irreversible). Extracted
 * so the cancel/commit decision is unit-testable without mounting React.
 */
export function shouldBlurCommit(cancelled: boolean): boolean {
  return !cancelled;
}

/**
 * Footer status dot for a day-total cell. Green filled dot at/over the 8h
 * goal, amber filled dot when partially logged, hollow muted dot for an
 * empty workday. Weekend days show no dot at all when empty.
 */
export function dayDot(hours: number, isWeekend: boolean): { symbol: '●' | '○'; color: string } | null {
  if (hours >= 8) return { symbol: '●', color: 'var(--accent-green)' };
  if (hours > 0) return { symbol: '●', color: 'var(--accent-orange, #FFA13A)' };
  return isWeekend ? null : { symbol: '○', color: 'var(--muted)' };
}

/** Clamp a new cell's seconds so the day's total (existing + new) never exceeds 24h. */
export function clampToDayCap(existingDaySeconds: number, requestedSeconds: number, capSeconds = 24 * 3600): number {
  return Math.min(requestedSeconds, Math.max(0, capSeconds - existingDaySeconds));
}
