// Card presentation of a DataGrid column set: same columns, same cell
// resolution order (render, then format, then the raw property), phone-shaped
// layout. Keeping the resolution order identical is what stops the two
// presentations from ever disagreeing about a value.

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GridColumn } from './DataGrid';

export interface CardListProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onRowLongPress?: (row: T, at: { clientX: number; clientY: number }) => void;
  /** Columns beyond this many (title included) collapse behind "N more". */
  visibleFields?: number;
  emptyText?: string;
}

/** Long-press duration that reads as deliberate without feeling sluggish. */
const LONG_PRESS_MS = 500;

function cell<T>(col: GridColumn<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  if (col.format) return col.format(row);
  const raw = (row as Record<string, unknown>)[col.key];
  return raw === null || raw === undefined ? '' : String(raw);
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border-soft)',
  borderRadius: 10,
  background: 'var(--bg-panel)',
  padding: '12px 14px',
  marginBottom: 8,
};

const fieldStyle: CSSProperties = { display: 'flex', gap: 8, fontSize: 13, padding: '2px 0' };

export function CardList<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  onRowLongPress,
  visibleFields = 4,
  emptyText = 'No rows',
}: CardListProps<T>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (rows.length === 0) {
    return <div style={{ padding: 24, opacity: 0.7, textAlign: 'center' }}>{emptyText}</div>;
  }

  const [titleCol, ...fieldCols] = columns;
  const primary = fieldCols.slice(0, Math.max(0, visibleFields - 1));
  const overflow = fieldCols.slice(Math.max(0, visibleFields - 1));

  const cancelPress = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <div style={{ padding: 8 }}>
      {rows.map((row) => {
        const id = rowKey(row);
        const isOpen = expanded.has(id);
        const shown = isOpen ? [...primary, ...overflow] : primary;
        return (
          <div
            key={id}
            style={cardStyle}
            onClick={() => onRowClick?.(row)}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              const at = { clientX: touch.clientX, clientY: touch.clientY };
              timer.current = setTimeout(() => onRowLongPress?.(row, at), LONG_PRESS_MS);
            }}
            onTouchEnd={cancelPress}
            onTouchMove={cancelPress}
            onTouchCancel={cancelPress}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{cell(titleCol, row)}</div>
            {shown.map((col) => (
              <div key={col.key} style={fieldStyle}>
                <span style={{ opacity: 0.65, minWidth: 96 }}>{col.header}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{cell(col, row)}</span>
              </div>
            ))}
            {overflow.length > 0 && (
              <button
                type="button"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  padding: 0,
                }}
                onClick={(e) => {
                  e.stopPropagation(); // expanding is not opening the row
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
              >
                {isOpen ? 'Show less' : `${overflow.length} more`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
