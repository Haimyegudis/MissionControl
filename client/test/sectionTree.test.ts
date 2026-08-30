// Collapsible section tree for the case library panel: which rows are visible
// given the expanded set, which sections have children, and subtree case
// counts shown on collapsed parents.

import { describe, expect, it } from 'vitest';
import type { TrSection } from '../src/testrailTypes';
import { casesTableRows, sectionHasChildren, subtreeCaseCounts, visibleSections } from '../src/lib/testrail';

const sec = (id: number, parentId: number | null, depth: number, displayOrder: number): TrSection => ({
  id,
  suiteId: 10,
  parentId,
  name: `S${id}`,
  depth,
  displayOrder,
});

// root(1) > mid(2) > leaf(3); root2(4) is a childless top-level section.
const sections = [sec(1, null, 0, 1), sec(2, 1, 1, 2), sec(3, 2, 2, 3), sec(4, null, 0, 4)];

describe('visibleSections', () => {
  it('collapsed-all shows only top-level sections, in display order', () => {
    expect(visibleSections(sections, new Set()).map((s) => s.id)).toEqual([1, 4]);
  });

  it('expanding a parent reveals only its direct children', () => {
    expect(visibleSections(sections, new Set([1])).map((s) => s.id)).toEqual([1, 2, 4]);
  });

  it('expanding the whole chain reveals the deep subsection', () => {
    expect(visibleSections(sections, new Set([1, 2])).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('an expanded child stays hidden while its parent is collapsed', () => {
    expect(visibleSections(sections, new Set([2])).map((s) => s.id)).toEqual([1, 4]);
  });
});

describe('sectionHasChildren', () => {
  it('marks only sections that are some parentId', () => {
    expect([...sectionHasChildren(sections)].sort()).toEqual([1, 2]);
  });
});

describe('subtreeCaseCounts', () => {
  it('adds descendant counts into every ancestor', () => {
    const direct = new Map([
      [1, 2],
      [2, 5],
      [3, 7],
    ]);
    const totals = subtreeCaseCounts(sections, direct);
    expect(totals.get(3)).toBe(7);
    expect(totals.get(2)).toBe(12);
    expect(totals.get(1)).toBe(14);
    expect(totals.get(4) ?? 0).toBe(0);
  });
});

describe('casesTableRows', () => {
  // Same fixture: root(1) > mid(2) > leaf(3); root2(4) top-level.
  // groups arrive in displayOrder (leaf sections that have cases).
  const g = (sectionId: number, n: number) => ({
    sectionId,
    cases: Array.from({ length: n }, (_, i) => ({ id: sectionId * 100 + i })),
  });

  it('emits ancestor header rows above nested groups, once per branch', () => {
    const rows = casesTableRows([g(2, 2), g(3, 1), g(4, 5)], sections, new Set());
    expect(rows.map((r) => r.section.id)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.cases.length)).toEqual([0, 2, 1, 5]);
    expect(rows.map((r) => r.subtreeCount)).toEqual([3, 3, 1, 5]);
    expect(rows.map((r) => r.directCount)).toEqual([0, 2, 1, 5]);
  });

  it('keeps a parent with direct cases as a single row above its child group', () => {
    const rows = casesTableRows([g(1, 4), g(2, 2)], sections, new Set());
    expect(rows.map((r) => r.section.id)).toEqual([1, 2]);
    expect(rows[0].cases.length).toBe(4);
    expect(rows[0].subtreeCount).toBe(6);
  });

  it('collapsing a parent hides the whole subtree but keeps its own row', () => {
    const rows = casesTableRows([g(2, 2), g(3, 1), g(4, 5)], sections, new Set([1]));
    expect(rows.map((r) => r.section.id)).toEqual([1, 4]);
    expect(rows[0].collapsed).toBe(true);
  });

  it('collapsing a leaf keeps its header row with no case rows', () => {
    const rows = casesTableRows([g(4, 5)], sections, new Set([4]));
    expect(rows.map((r) => r.section.id)).toEqual([4]);
    expect(rows[0].cases.length).toBe(0);
    expect(rows[0].collapsed).toBe(true);
    expect(rows[0].directCount).toBe(5);
  });

  it('synthesizes a row for cases whose section is unknown', () => {
    const rows = casesTableRows([g(999, 2)], sections, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].section.id).toBe(999);
    expect(rows[0].cases.length).toBe(2);
  });
});
