// Vitest for the pure DataGrid column-state logic (lib/gridState).

import { describe, expect, it } from 'vitest';
import {
  MIN_COL_WIDTH,
  gridStorageKey,
  loadGridState,
  resetColWidth,
  resizeColWidth,
  resizedWidth,
  saveGridState,
  type GridState,
  type KVStorage,
} from '../src/lib/gridState';

function memoryStorage(): KVStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('gridState', () => {
  it('keys storage by grid id', () => {
    expect(gridStorageKey('MyWork.Issues')).toBe('jiraweb.grid.MyWork.Issues');
  });

  it('resizedWidth applies the drag delta and clamps to the 40px minimum', () => {
    expect(resizedWidth(100, 50)).toBe(150);
    expect(resizedWidth(100, -70)).toBe(MIN_COL_WIDTH);
    expect(resizedWidth(100, -1000)).toBe(40);
    expect(resizedWidth(100, 0.4)).toBe(100); // rounded
  });

  it('resizeColWidth updates only the dragged column and keeps other col state', () => {
    const state: GridState = { key: { hidden: true }, summary: { width: 300 } };
    const next = resizeColWidth(state, 'key', 100, 25);
    expect(next.key).toEqual({ hidden: true, width: 125 });
    expect(next.summary).toEqual({ width: 300 });
    expect(state.key).toEqual({ hidden: true }); // input untouched
  });

  it('resetColWidth drops the stored width but keeps order/hidden', () => {
    const state: GridState = { key: { width: 220, order: 2, hidden: false } };
    expect(resetColWidth(state, 'key').key).toEqual({ order: 2, hidden: false });
    // No stored width → same state object back (no pointless re-render).
    expect(resetColWidth(state, 'summary')).toBe(state);
    const bare: GridState = { key: { order: 1 } };
    expect(resetColWidth(bare, 'key')).toBe(bare);
  });

  it('save/load round-trips through the storage, keyed by grid id', () => {
    const storage = memoryStorage();
    const state: GridState = { key: { width: 120 }, summary: { hidden: true } };
    saveGridState('Test.Grid', state, storage);
    expect(storage.map.has('jiraweb.grid.Test.Grid')).toBe(true);
    expect(loadGridState('Test.Grid', storage)).toEqual(state);
    expect(loadGridState('Other.Grid', storage)).toEqual({});
  });

  it('load tolerates corrupt JSON and a missing storage', () => {
    const storage = memoryStorage();
    storage.map.set('jiraweb.grid.Bad', '{not json');
    expect(loadGridState('Bad', storage)).toEqual({});
    expect(loadGridState('Anything', null)).toEqual({});
    saveGridState('Anything', {}, null); // must not throw
  });
});
