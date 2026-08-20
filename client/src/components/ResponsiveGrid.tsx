// Breakpoint switch over one column definition. Above the breakpoint the
// desktop DataGrid renders exactly as before; below it the same columns render
// as cards, with touch equivalents for the mouse-only interactions (tap for
// double-click, long-press for the context menu).

import { CardList } from './CardList';
import { DataGrid, type DataGridProps } from './DataGrid';
import { useIsNarrow } from '../lib/useViewport';

export type ResponsiveGridProps<T> = DataGridProps<T> & {
  /** Columns beyond this many collapse behind "N more" on a phone. */
  visibleFields?: number;
};

export function ResponsiveGrid<T>({ visibleFields, ...props }: ResponsiveGridProps<T>) {
  const narrow = useIsNarrow();
  if (!narrow) return <DataGrid {...props} />;
  return (
    <CardList
      columns={props.columns}
      rows={props.rows}
      rowKey={props.rowKey}
      visibleFields={visibleFields}
      emptyText={props.emptyText}
      // A tap is the phone's double-click; fall back to the plain activate
      // handler for grids that only define that one.
      onRowClick={props.onRowDoubleClick ?? props.onRowActivate}
      onRowLongPress={props.onRowContextMenu}
    />
  );
}
