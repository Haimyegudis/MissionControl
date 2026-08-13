// Pure column-state logic for DataGrid (ui-parity §12.10): width drag-resize
// clamping, double-click width reset, and localStorage persistence keyed by
// grid id (`jiraweb.grid.{gridId}`). Kept DOM-free so it runs under vitest;
// DataGrid wires it to the header mouse events.

export interface ColState {
  order?: number;
  width?: number;
  hidden?: boolean;
}

export type GridState = Record<string, ColState>;

export const MIN_COL_WIDTH = 40;

/** Minimal storage surface so tests can inject a fake localStorage. */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): KVStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** localStorage key holding a grid's per-column state (order/width/hidden). */
export function gridStorageKey(gridId: string): string {
  return `jiraweb.grid.${gridId}`;
}

export function loadGridState(gridId: string, storage: KVStorage | null = defaultStorage()): GridState {
  try {
    const raw = storage?.getItem(gridStorageKey(gridId));
    return raw ? (JSON.parse(raw) as GridState) : {};
  } catch {
    return {};
  }
}

export function saveGridState(gridId: string, state: GridState, storage: KVStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(gridStorageKey(gridId), JSON.stringify(state));
  } catch {
    /* quota / unavailable */
  }
}

/** Width after dragging from `startWidth` by `deltaX` px, clamped to the minimum. */
export function resizedWidth(startWidth: number, deltaX: number, min = MIN_COL_WIDTH): number {
  return Math.max(min, Math.round(startWidth + deltaX));
}

/** Next grid state while dragging a column's grip (live width update). */
export function resizeColWidth(state: GridState, key: string, startWidth: number, deltaX: number): GridState {
  return { ...state, [key]: { ...state[key], width: resizedWidth(startWidth, deltaX) } };
}

/** Double-click reset: drop the stored width so the column default applies. */
export function resetColWidth(state: GridState, key: string): GridState {
  const cur = state[key];
  if (!cur || cur.width === undefined) return state;
  const { width: _width, ...rest } = cur;
  return { ...state, [key]: rest };
}
