// KanbanLayout (ui-parity-contract.md §12.1). Pure — unit tested.

import type { JiraIssue } from '../types';

export interface KanbanColumnDef {
  title: string;
  /** Lowercase substrings matched against the issue status. */
  matches: string[];
}

/** Fixed order — To Do, In Progress, On Hold, In Review, Done. */
export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { title: 'To Do', matches: ['to do', 'not started', 'open', 'backlog', 'new'] },
  { title: 'In Progress', matches: ['in progress'] },
  { title: 'On Hold', matches: ['hold', 'blocked', 'waiting'] },
  { title: 'In Review', matches: ['review', 'verification'] },
  { title: 'Done', matches: ['done', 'closed', 'delivered'] },
];

/** First matching column title (lowercase substring); unmatched fall into "To Do". */
export function columnForStatus(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase();
  for (const col of KANBAN_COLUMNS) {
    if (col.matches.some((m) => s.includes(m))) return col.title;
  }
  return KANBAN_COLUMNS[0].title;
}

export interface KanbanColumn {
  title: string;
  issues: JiraIssue[];
  count: number;
  wipLimit?: number;
  /** Count > cap. */
  isOverLimit: boolean;
  /** `"{n}"` or `"{n} / {cap}"` with a WIP limit. */
  countDisplay: string;
}

/** Bucket issues into the five fixed columns, applying WIP limits by title. */
export function buildColumns(
  issues: JiraIssue[],
  wipLimits: Record<string, number> = {},
): KanbanColumn[] {
  const buckets = new Map<string, JiraIssue[]>(KANBAN_COLUMNS.map((c) => [c.title, []]));
  for (const issue of issues) {
    buckets.get(columnForStatus(issue.status))!.push(issue);
  }
  return KANBAN_COLUMNS.map((def) => {
    const columnIssues = buckets.get(def.title)!;
    const count = columnIssues.length;
    const cap = wipLimits[def.title];
    const wipLimit = typeof cap === 'number' && cap > 0 ? cap : undefined;
    return {
      title: def.title,
      issues: columnIssues,
      count,
      wipLimit,
      isOverLimit: wipLimit !== undefined && count > wipLimit,
      countDisplay: wipLimit !== undefined ? `${count} / ${wipLimit}` : `${count}`,
    };
  });
}
