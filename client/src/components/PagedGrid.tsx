// PagedGrid (ui-parity §12.2): DataGrid over a page slice, page size 10,
// header-right "{first}-{last} of {total}", pager `◀ 1 2 3 ▶`.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ResponsiveGrid } from './ResponsiveGrid';
import type { DataGridProps } from './DataGrid';

export interface PagedGridProps<T> extends Omit<DataGridProps<T>, 'rows'> {
  rows: T[];
  pageSize?: number;
  /** Extra content on the header row's left side (title etc.). */
  headerLeft?: ReactNode;
}

export function PagedGrid<T>({ rows, pageSize = 10, headerLeft, ...gridProps }: PagedGridProps<T>) {
  const [page, setPage] = useState(1);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);

  const pageRows = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  );

  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  const pageBtn = (label: string, target: number, disabled: boolean, active = false, key?: string) => (
    <button
      key={key ?? label}
      className="btn"
      disabled={disabled}
      onClick={() => setPage(target)}
      style={{
        padding: '3px 9px',
        fontSize: 11.5,
        borderColor: active ? 'var(--accent-cyan)' : undefined,
        color: active ? 'var(--accent-cyan)' : undefined,
        fontWeight: active ? 700 : undefined,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>{headerLeft}</div>
        <div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
          {`${first}-${last} of ${total}`}
        </div>
      </div>
      <ResponsiveGrid {...gridProps} rows={pageRows} />
      {totalPages > 1 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
          {pageBtn('◀', current - 1, current <= 1, false, 'prev')}
          {Array.from({ length: totalPages }, (_, i) =>
            pageBtn(String(i + 1), i + 1, false, i + 1 === current, `p${i + 1}`),
          )}
          {pageBtn('▶', current + 1, current >= totalPages, false, 'next')}
        </div>
      ) : null}
    </div>
  );
}
