// Grouping issues by status, shared by Dashboard and Incidents.
//
// Reuses columnForStatus so the phone buckets issues exactly the way the
// desktop Kanban does — two different answers to "what does In Review mean"
// would be worse than none. Cancelled is added on top: the Kanban folds
// rejected work into To Do, which is wrong in a list you are reading to decide
// what to do next.

import { useState, type ReactNode } from 'react';
import { columnForStatus } from '../lib/kanban';
import type { JiraIssue } from '../types';
import { tapReset } from './ui';

export const STATUS_ORDER = ['To Do', 'In Progress', 'In Review', 'On Hold', 'Done', 'Cancelled'] as const;
export type StatusGroup = (typeof STATUS_ORDER)[number];

const CANCELLED = ['cancel', 'reject', 'abandon', 'duplicate', "won't do", 'wont do'];

export function groupForIssue(issue: JiraIssue): StatusGroup {
  const s = (issue.status ?? '').toLowerCase();
  if (CANCELLED.some((m) => s.includes(m))) return 'Cancelled';
  return columnForStatus(issue.status) as StatusGroup;
}

export function groupByStatus(issues: JiraIssue[]): Array<{ group: StatusGroup; issues: JiraIssue[] }> {
  const buckets = new Map<StatusGroup, JiraIssue[]>();
  for (const g of STATUS_ORDER) buckets.set(g, []);
  for (const issue of issues) buckets.get(groupForIssue(issue))?.push(issue);
  return STATUS_ORDER.map((group) => ({ group, issues: buckets.get(group) ?? [] })).filter(
    (b) => b.issues.length > 0,
  );
}

export const GROUP_TONE: Record<StatusGroup, string> = {
  'To Do': 'var(--muted)',
  'In Progress': 'var(--accent-blue)',
  'In Review': 'var(--accent-yellow)',
  'On Hold': 'var(--accent-orange)',
  Done: 'var(--accent-green)',
  Cancelled: 'var(--accent-red)',
};

/** Collapsible status section. Open by default; the count stays visible. */
export function StatusSection({
  group,
  count,
  children,
  defaultOpen = true,
}: {
  group: StatusGroup;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = GROUP_TONE[group];
  return (
    <section style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          ...tapReset,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          width: '100%',
          minHeight: 44,
          padding: '8px 10px',
          background: 'var(--bg-panel-high)',
          border: '1px solid var(--border-soft)',
          borderLeft: `3px solid ${tone}`,
          borderRadius: 10,
          color: 'var(--text-primary)',
          marginBottom: open ? 8 : 0,
        }}
      >
        <span aria-hidden style={{ fontSize: 11, opacity: 0.7 }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 650, fontSize: 13.5, letterSpacing: '0.02em' }}>
          {group}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: tone,
            minWidth: 24,
            textAlign: 'right',
          }}
        >
          {count}
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}
