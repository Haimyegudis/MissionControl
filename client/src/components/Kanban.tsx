// Kanban board (ui-parity §1 Dashboard rich cards, §2 MyWork minimal cards,
// §12.1 KanbanLayout). Five fixed columns; WIP badge red when over the cap;
// HTML5 drag (dragged card opacity .35, column border DodgerBlue on dragover);
// J/K/↓/↑ flat keyboard navigation + Enter open (skipped while an input is
// focused); star click flips via callback.

import { useEffect, useMemo, useRef, useState } from 'react';
import { priorityColor, starColor } from '../lib/colors';
import { buildColumns, columnForStatus } from '../lib/kanban';
import type { KanbanColumn } from '../lib/kanban';
import type { JiraIssue } from '../types';
import { AgingDot } from './AgingDot';
import { EpicChip } from './EpicChip';

export type KanbanVariant = 'rich' | 'minimal';

export interface KanbanProps {
  issues: JiraIssue[];
  wipLimits?: Record<string, number>;
  /** 'rich' = star + aging dot + epic chip (Dashboard); 'minimal' = key + summary + priority (MyWork). */
  variant?: KanbanVariant;
  onOpen?: (issue: JiraIssue) => void;
  /** Card dropped on a column it is not already in. */
  onDrop?: (issue: JiraIssue, columnTitle: string) => void;
  onToggleStar?: (issue: JiraIssue) => void;
  /** Right-click on a column header (WIP-limit prompt lives in the view). */
  onColumnContextMenu?: (columnTitle: string, e: { clientX: number; clientY: number }) => void;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function Kanban({
  issues,
  wipLimits = {},
  variant = 'rich',
  onOpen,
  onDrop,
  onToggleStar,
  onColumnContextMenu,
}: KanbanProps) {
  const columns: KanbanColumn[] = useMemo(() => buildColumns(issues, wipLimits), [issues, wipLimits]);
  const flat = useMemo(() => columns.flatMap((c) => c.issues), [columns]);

  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Flat keyboard navigation across all columns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextInputFocused()) return;
      if (flat.length === 0) return;
      const k = e.key;
      const isNext = k === 'j' || k === 'J' || k === 'ArrowDown';
      const isPrev = k === 'k' || k === 'K' || k === 'ArrowUp';
      if (!isNext && !isPrev && k !== 'Enter') return;

      const idx = focusedKey ? flat.findIndex((i) => i.key === focusedKey) : -1;
      if (k === 'Enter') {
        if (idx >= 0) {
          e.preventDefault();
          onOpen?.(flat[idx]);
        }
        return;
      }
      e.preventDefault();
      const next = isNext ? Math.min(flat.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      const nextKey = flat[next].key;
      setFocusedKey(nextKey);
      rootRef.current
        ?.querySelector(`[data-kanban-card="${CSS.escape(nextKey)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, focusedKey, onOpen]);

  const handleDrop = (columnTitle: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverColumn(null);
    const key = e.dataTransfer.getData('text/plain') || draggingKey;
    setDraggingKey(null);
    if (!key) return;
    const issue = issues.find((i) => i.key.toLowerCase() === key.toLowerCase());
    if (!issue) return;
    // No-op if the card is already in the target column.
    if (columnForStatus(issue.status) === columnTitle) return;
    onDrop?.(issue, columnTitle);
  };

  return (
    <div
      ref={rootRef}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
        gap: 10,
        alignItems: 'start',
      }}
    >
      {columns.map((col) => (
        <div
          key={col.title}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverColumn(col.title);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setDragOverColumn((cur) => (cur === col.title ? null : cur));
            }
          }}
          onDrop={(e) => handleDrop(col.title, e)}
          style={{
            background: 'var(--bg-panel)',
            border: dragOverColumn === col.title ? '1px solid DodgerBlue' : '1px solid var(--border-soft)',
            borderRadius: 10,
            padding: 8,
            minHeight: 120,
            transition: 'border-color 120ms ease',
          }}
        >
          <div
            onContextMenu={(e) => {
              if (!onColumnContextMenu) return;
              e.preventDefault();
              onColumnContextMenu(col.title, { clientX: e.clientX, clientY: e.clientY });
            }}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              padding: '2px 4px 8px',
              userSelect: 'none',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 12, letterSpacing: '0.03em' }}>{col.title}</span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: col.isOverLimit ? 'var(--accent-red)' : 'var(--muted)',
              }}
              title={col.wipLimit !== undefined ? `WIP limit ${col.wipLimit}` : undefined}
            >
              {col.countDisplay}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {col.issues.map((issue) => {
              const isDragging = draggingKey === issue.key;
              const isFocused = focusedKey === issue.key;
              return (
                <div
                  key={issue.key}
                  data-kanban-card={issue.key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', issue.key);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingKey(issue.key);
                  }}
                  onDragEnd={() => {
                    setDraggingKey(null);
                    setDragOverColumn(null);
                  }}
                  onClick={() => setFocusedKey(issue.key)}
                  onDoubleClick={() => onOpen?.(issue)}
                  style={{
                    background: 'var(--bg-panel-high)',
                    border: isFocused ? '1px solid var(--accent-cyan)' : '1px solid var(--border-soft)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    cursor: 'grab',
                    opacity: isDragging ? 0.35 : 1,
                    transition: 'opacity 120ms ease',
                  }}
                >
                  {variant === 'rich' ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span
                          title="Star this issue (cross-tab)"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar?.(issue);
                          }}
                          style={{
                            color: starColor(issue.isStarred),
                            cursor: 'pointer',
                            fontSize: 13,
                            lineHeight: 1,
                            flex: '0 0 auto',
                          }}
                        >
                          ★
                        </span>
                        <AgingDot updated={issue.updated} />
                        <span
                          style={{
                            fontWeight: 700,
                            color: 'var(--accent-cyan)',
                            fontSize: 12,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {issue.key}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4, overflowWrap: 'anywhere' }}>{issue.summary}</div>
                      {issue.epicKey ? (
                        <div style={{ marginTop: 6 }}>
                          <EpicChip epicKey={issue.epicKey} epicName={issue.epicName} />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: 700, color: 'var(--accent-cyan)', fontSize: 12 }}>{issue.key}</span>
                      <div style={{ fontSize: 12, marginTop: 4, overflowWrap: 'anywhere' }}>{issue.summary}</div>
                      <div style={{ fontSize: 11.5, marginTop: 4, color: priorityColor(issue.priority) }}>
                        {issue.priority}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
