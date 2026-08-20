// Card presentation of a DataGrid column set: same columns, same cell
// resolution order (render, then format, then the raw property), phone-shaped
// layout. Keeping the resolution order identical is what stops the two
// presentations from ever disagreeing about a value.
//
// Hierarchy, rather than a flat label/value dump: the first column is the
// headline (an issue key, a run name), the second carries the descriptive text
// with no label because it never needs one, and the rest are compact pairs.
// Anything past `visibleFields` collapses, so a twelve-column desktop grid
// becomes a card you can read at a glance and expand when you care.

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GridColumn } from './DataGrid';

export interface CardListProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onRowLongPress?: (row: T, at: { clientX: number; clientY: number }) => void;
  /** Columns beyond this many (headline included) collapse behind "N more". */
  visibleFields?: number;
  emptyText?: string;
}

/** Long enough to read as deliberate, short enough not to feel stuck. */
const LONG_PRESS_MS = 500;
/** A drag past this many pixels is a scroll, not a press. */
const PRESS_SLOP_PX = 10;

function cell<T>(col: GridColumn<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  if (col.format) return col.format(row);
  const raw = (row as Record<string, unknown>)[col.key];
  return raw === null || raw === undefined ? '' : String(raw);
}

/**
 * A column whose header is a glyph or two — MyWork's '★' favourite toggle, an
 * aging dot — is an adornment, not data. It rides on the headline row instead
 * of becoming the card's title, which is what happened when the star column
 * simply sorted first.
 */
function isAdornment<T>(col: GridColumn<T>): boolean {
  return typeof col.header === 'string' && col.header.trim().length <= 2;
}

/** Empty cells are noise on a small screen — drop the row entirely. */
function isBlank(value: ReactNode): boolean {
  return value === '' || value === null || value === undefined;
}

const cardStyle: CSSProperties = {
  position: 'relative',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  background: 'var(--bg-panel)',
  padding: '12px 14px',
  marginBottom: 10,
  // Kills the 300ms tap delay and the grey tap flash.
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
};

const headlineStyle: CSSProperties = {
  fontWeight: 650,
  fontSize: 15,
  fontFamily: 'var(--font-display)',
  letterSpacing: '0.01em',
  minWidth: 0,
};

const subtitleStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.35,
  marginTop: 3,
  color: 'var(--text-primary)',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  fontSize: 12.5,
  padding: '3px 0',
  minWidth: 0,
};

const fieldLabelStyle: CSSProperties = {
  color: 'var(--muted)',
  flex: '0 0 34%',
  maxWidth: 128,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 10.5,
  paddingTop: 2,
};

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
  const origin = useRef<{ x: number; y: number } | null>(null);

  if (rows.length === 0) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        {emptyText}
      </div>
    );
  }

  // Leading adornment columns are pulled out before the headline is chosen.
  let lead = 0;
  while (lead < columns.length && isAdornment(columns[lead])) lead += 1;
  const adornments = columns.slice(0, lead);
  const [headCol, subCol, ...restCols] = columns.slice(lead);
  const inline = restCols.slice(0, Math.max(0, visibleFields - 2));
  const overflow = restCols.slice(Math.max(0, visibleFields - 2));

  const cancelPress = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  };

  return (
    <div style={{ padding: '4px 0 12px' }}>
      {rows.map((row) => {
        const id = rowKey(row);
        const isOpen = expanded.has(id);
        const shown = (isOpen ? [...inline, ...overflow] : inline).filter((c) => !isBlank(cell(c, row)));
        const subtitle = subCol ? cell(subCol, row) : null;

        return (
          <div
            key={id}
            style={cardStyle}
            onClick={() => onRowClick?.(row)}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              origin.current = { x: touch.clientX, y: touch.clientY };
              const at = { clientX: touch.clientX, clientY: touch.clientY };
              timer.current = setTimeout(() => onRowLongPress?.(row, at), LONG_PRESS_MS);
            }}
            onTouchMove={(e) => {
              const start = origin.current;
              if (!start) return;
              const touch = e.touches[0];
              if (
                Math.abs(touch.clientX - start.x) > PRESS_SLOP_PX ||
                Math.abs(touch.clientY - start.y) > PRESS_SLOP_PX
              ) {
                cancelPress();
              }
            }}
            onTouchEnd={cancelPress}
            onTouchCancel={cancelPress}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {adornments.map((col) => (
                <span key={col.key} style={{ flex: '0 0 auto', fontSize: 16, lineHeight: 1 }}>
                  {cell(col, row)}
                </span>
              ))}
              <span style={headlineStyle}>{headCol ? cell(headCol, row) : null}</span>
            </div>
            {subCol && !isBlank(subtitle) ? <div style={subtitleStyle}>{subtitle}</div> : null}

            {shown.length > 0 ? (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 6 }}>
                {shown.map((col) => (
                  <div key={col.key} style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>{col.header}</span>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{cell(col, row)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {overflow.length > 0 ? (
              <button
                type="button"
                style={{
                  marginTop: 6,
                  minHeight: 32,
                  fontSize: 11.5,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-cyan)',
                  padding: '4px 0',
                }}
                onClick={(e) => {
                  e.stopPropagation(); // expanding a card is not opening the row
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
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
