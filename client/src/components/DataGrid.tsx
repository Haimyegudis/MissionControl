// Generic data grid (ui-parity §12.10): header sort, edge-drag column resize
// (7px grip, live drag, min 40px, double-click reset), right-click header menu
// (visibility + CSV export), per-column state persisted to localStorage
// `jiraweb.grid.{stateKey}` (pure logic in lib/gridState; widths flushed on
// mouseup, menu edits debounced 250ms), row dblclick / context-menu callbacks,
// optional ctrl/shift multi-select.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { buildCsv, csvFilename, downloadCsv } from '../lib/csv';
import {
  loadGridState,
  resetColWidth,
  resizeColWidth,
  saveGridState,
  type GridState,
} from '../lib/gridState';
import { ContextMenu } from './ContextMenu';
import type { MenuEntry } from './ContextMenu';

export interface GridColumn<T> {
  key: string;
  header: string;
  /** Default width in px. */
  width: number;
  /** Custom cell renderer; falls back to `format` then the raw property. */
  render?: (row: T) => ReactNode;
  /** Sort key; falls back to `format` then the raw property. */
  sortValue?: (row: T) => string | number | null;
  /** Display/CSV text; falls back to the raw property named by `key`. */
  format?: (row: T) => string;
}

export interface DataGridProps<T> {
  stateKey: string;
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowDoubleClick?: (row: T) => void;
  onRowContextMenu?: (row: T, e: { clientX: number; clientY: number }) => void;
  /** Enable ctrl/shift multi-select. */
  multiSelect?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  emptyText?: string;
  /** Max body height (px); container scrolls beyond it. */
  maxHeight?: number;
}

function cellText<T>(col: GridColumn<T>, row: T): string {
  if (col.format) return col.format(row);
  const raw = (row as Record<string, unknown>)[col.key];
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

function sortKey<T>(col: GridColumn<T>, row: T): string | number | null {
  if (col.sortValue) return col.sortValue(row);
  const raw = (row as Record<string, unknown>)[col.key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' || typeof raw === 'boolean') return Number(raw);
  return String(raw);
}

export function DataGrid<T>({
  stateKey,
  columns,
  rows,
  rowKey,
  onRowDoubleClick,
  onRowContextMenu,
  multiSelect = false,
  onSelectionChange,
  emptyText = 'No rows.',
  maxHeight,
}: DataGridProps<T>) {
  const [state, setState] = useState<GridState>(() => loadGridState(stateKey));
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizingRef = useRef(false);

  // Debounced 250ms persistence (header-menu edits).
  const persist = (next: GridState) => {
    stateRef.current = next;
    setState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveGridState(stateKey, next), 250);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // Display columns: hidden filtered out, persisted order applied.
  const visibleColumns = useMemo(() => {
    const indexed = columns.map((c, i) => ({ c, order: state[c.key]?.order ?? i }));
    indexed.sort((a, b) => a.order - b.order);
    return indexed.map((x) => x.c).filter((c) => !state[c.key]?.hidden);
  }, [columns, state]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortKey(col, a);
      const vb = sortKey(col, b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * dir;
    });
  }, [rows, sort, columns]);

  const cycleSort = (key: string) => {
    if (resizingRef.current) return;
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: 'asc' };
      if (cur.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  const beginResize = (key: string, startWidth: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    resizingRef.current = false;
    const onMove = (me: MouseEvent) => {
      resizingRef.current = true;
      // Live width update while dragging (clamped to MIN_COL_WIDTH).
      const next = resizeColWidth(stateRef.current, key, startWidth, me.clientX - startX);
      stateRef.current = next;
      setState(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Persist the final width immediately on mouseup.
      saveGridState(stateKey, stateRef.current);
      // Let the click that follows mouseup see the flag, then clear it.
      setTimeout(() => {
        resizingRef.current = false;
      }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Double-click on the grip resets that column to its default width.
  const resetColumn = (key: string) => {
    const next = resetColWidth(stateRef.current, key);
    stateRef.current = next;
    setState(next);
    saveGridState(stateKey, next);
  };

  // Keep a ref of latest state for the resize closures.
  const stateRef = useRef(state);
  stateRef.current = state;

  const exportCsv = () => {
    const csv = buildCsv(
      visibleColumns.map((c) => ({ header: c.header, value: (row: T) => cellText(c, row) })),
      sortedRows,
    );
    downloadCsv(csvFilename(stateKey), csv);
  };

  const headerMenuEntries: MenuEntry[] = [
    ...columns.map((c) => ({
      label: `${state[c.key]?.hidden ? '☐' : '☑'}  ${c.header}`,
      keepOpen: false,
      onClick: () => persist({ ...state, [c.key]: { ...state[c.key], hidden: !state[c.key]?.hidden } }),
    })),
    'separator' as const,
    { label: 'Export to CSV...', onClick: exportCsv },
  ];

  const applySelection = (next: Set<string>) => {
    setSelected(next);
    if (onSelectionChange) {
      onSelectionChange(sortedRows.filter((r) => next.has(rowKey(r))));
    }
  };

  const onRowClick = (row: T, e: React.MouseEvent) => {
    if (!multiSelect) return;
    const key = rowKey(row);
    if (e.shiftKey && anchorRef.current) {
      const keys = sortedRows.map(rowKey);
      const a = keys.indexOf(anchorRef.current);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        applySelection(new Set(keys.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      anchorRef.current = key;
      applySelection(next);
      return;
    }
    anchorRef.current = key;
    applySelection(new Set([key]));
  };

  const totalWidth = visibleColumns.reduce((sum, c) => sum + (state[c.key]?.width ?? c.width), 0);

  return (
    <div style={{ overflow: 'auto', maxHeight, border: '1px solid var(--border-soft)', borderRadius: 8 }}>
      <table
        style={{
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          width: '100%',
          minWidth: totalWidth,
          fontSize: 12.5,
        }}
      >
        <colgroup>
          {visibleColumns.map((c) => (
            <col key={c.key} style={{ width: state[c.key]?.width ?? c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((c) => (
              <th
                key={c.key}
                onClick={() => cycleSort(c.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setHeaderMenu({ x: e.clientX, y: e.clientY });
                }}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  background: 'var(--bg-panel-high)',
                  color: 'var(--muted)',
                  textAlign: 'left',
                  fontWeight: 600,
                  fontSize: 11.5,
                  letterSpacing: '0.04em',
                  padding: '7px 10px',
                  borderBottom: '1px solid var(--border-strong)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={c.header}
              >
                {c.header}
                {sort?.key === c.key ? (
                  <span style={{ color: 'var(--accent-cyan)', marginLeft: 4 }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
                ) : null}
                <span
                  className="dg-grip"
                  title="Drag to resize · double-click to reset"
                  onMouseDown={(e) => beginResize(c.key, state[c.key]?.width ?? c.width, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    resetColumn(c.key);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, visibleColumns.length)} className="muted" style={{ padding: 14, textAlign: 'center' }}>
                {emptyText}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => {
              const key = rowKey(row);
              const isSelected = multiSelect && selected.has(key);
              return (
                <tr
                  key={key}
                  onClick={(e) => onRowClick(row, e)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  onContextMenu={(e) => {
                    if (!onRowContextMenu) return;
                    e.preventDefault();
                    if (multiSelect && !selected.has(key)) {
                      anchorRef.current = key;
                      applySelection(new Set([key]));
                    }
                    onRowContextMenu(row, { clientX: e.clientX, clientY: e.clientY });
                  }}
                  style={{
                    background: isSelected ? 'color-mix(in srgb, var(--accent-cyan) 12%, transparent)' : 'transparent',
                    cursor: onRowDoubleClick || multiSelect ? 'pointer' : 'default',
                  }}
                >
                  {visibleColumns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--border-soft)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c.render ? c.render(row) : cellText(c, row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {headerMenu ? (
        <ContextMenu x={headerMenu.x} y={headerMenu.y} entries={headerMenuEntries} onClose={() => setHeaderMenu(null)} />
      ) : null}
    </div>
  );
}
