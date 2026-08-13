// Vitest for the pure TestRail view logic (Phase 3 — unified-deck plan T14).

import { describe, expect, it } from 'vitest';
import {
  aggregateCounts,
  csvForCases,
  filterCases,
  groupCasesBySection,
  passPct,
  richText,
  sectionDescendants,
  sectionPath,
  stepsToText,
} from '../src/lib/testrail';
import type { TrCase, TrSection, TrSuite } from '../src/testrailTypes';

function makeCase(partial: Partial<TrCase> & { id: number; title: string }): TrCase {
  return {
    sectionId: null,
    suiteId: null,
    priorityId: null,
    typeId: null,
    templateId: null,
    createdBy: null,
    updatedBy: null,
    createdOn: null,
    updatedOn: null,
    refs: null,
    estimate: null,
    preconds: null,
    steps: null,
    expected: null,
    ownerId: null,
    assignedToId: null,
    stepsSeparated: [],
    ...partial,
  };
}

function makeSection(partial: Partial<TrSection> & { id: number; name: string }): TrSection {
  return { suiteId: null, parentId: null, depth: 0, displayOrder: 0, ...partial };
}

const SUITES: TrSuite[] = [
  { id: 10, projectId: 1, name: 'Press', description: null, isCompleted: false },
  { id: 11, projectId: 1, name: 'DFE', description: null, isCompleted: false },
];

const SECTIONS: TrSection[] = [
  makeSection({ id: 1, name: 'Root', suiteId: 10, displayOrder: 1 }),
  makeSection({ id: 2, name: 'Child', suiteId: 10, parentId: 1, depth: 1, displayOrder: 2 }),
  makeSection({ id: 3, name: 'Grandchild', suiteId: 10, parentId: 2, depth: 2, displayOrder: 3 }),
  makeSection({ id: 4, name: 'Other', suiteId: 10, displayOrder: 4 }),
];

describe('richText', () => {
  it('converts br/p/li/td markup to plain text', () => {
    expect(richText('line1<br/>line2 <p>para</p><ul><li>a</li><li>b</li></ul>')).toBe(
      'line1\nline2 para\n\n• a\n• b',
    );
  });

  it('renders table cells with pipe separators', () => {
    expect(richText('<table><tr><td>a</td><td>b</td></tr></table>')).toBe('| a | b');
  });

  it('decodes the entity set without a DOM', () => {
    expect(richText('&amp; &lt;x&gt; &quot;q&quot; &#39;s&#39;&nbsp;end')).toBe('& <x> "q" \'s\' end');
  });

  it('collapses 3+ blank lines and trims; empty-ish input → empty string', () => {
    expect(richText('a<br/><br/><br/><br/>b')).toBe('a\n\nb');
    expect(richText('')).toBe('');
    expect(richText(null)).toBe('');
  });
});

describe('groupCasesBySection', () => {
  it('orders groups by section displayOrder, preserving case order inside', () => {
    const cases = [
      makeCase({ id: 101, title: 'x', sectionId: 4 }),
      makeCase({ id: 102, title: 'y', sectionId: 1 }),
      makeCase({ id: 103, title: 'z', sectionId: 1 }),
    ];
    const groups = groupCasesBySection(cases, SECTIONS);
    expect(groups.map((g) => g.sectionId)).toEqual([1, 4]);
    expect(groups[0].cases.map((c) => c.id)).toEqual([102, 103]);
  });

  it('appends cases of unknown/null sections after known sections', () => {
    const cases = [
      makeCase({ id: 1, title: 'orphan', sectionId: 999 }),
      makeCase({ id: 2, title: 'nosec', sectionId: null }),
      makeCase({ id: 3, title: 'known', sectionId: 2 }),
    ];
    const groups = groupCasesBySection(cases, SECTIONS);
    expect(groups.map((g) => g.sectionId)).toEqual([2, 999, 0]);
  });
});

describe('sectionPath', () => {
  it('builds the full parent chain', () => {
    expect(sectionPath(3, SECTIONS)).toBe('Root / Child / Grandchild');
  });

  it('prefixes the suite name in all-suites mode', () => {
    expect(sectionPath(2, SECTIONS, SUITES, true)).toBe('⟨Press⟩ / Root / Child');
  });

  it('falls back to "section N" for unknown ids', () => {
    expect(sectionPath(42, SECTIONS, SUITES, true)).toBe('section 42');
  });
});

describe('sectionDescendants', () => {
  it('returns the section plus transitive children', () => {
    expect([...sectionDescendants(1, SECTIONS)].sort()).toEqual([1, 2, 3]);
    expect([...sectionDescendants(4, SECTIONS)]).toEqual([4]);
  });
});

describe('filterCases', () => {
  const names = (id: number | null) => (id === 7 ? 'Dana Levi' : id === 8 ? 'David Cohen' : '—');
  const cases = [
    makeCase({ id: 100, title: 'Print quality check', sectionId: 2, ownerId: 7, refs: 'JIRA-1' }),
    makeCase({ id: 200, title: 'Calibration', sectionId: 4, assignedToId: 8, steps: 'open tray' }),
    makeCase({
      id: 300,
      title: 'Duplex',
      sectionId: 4,
      stepsSeparated: [{ index: 1, action: 'load paper', expected: 'no jam' }],
    }),
  ];

  it('matches title substring case-insensitively', () => {
    expect(filterCases(cases, { title: 'PRINT' }, names).map((c) => c.id)).toEqual([100]);
  });

  it('matches "C123" / "123" as exact id and refs substring', () => {
    expect(filterCases(cases, { title: 'c200' }, names).map((c) => c.id)).toEqual([200]);
    expect(filterCases(cases, { title: 'jira-1' }, names).map((c) => c.id)).toEqual([100]);
  });

  it('searches steps text and separated steps', () => {
    expect(filterCases(cases, { title: 'tray' }, names).map((c) => c.id)).toEqual([200]);
    expect(filterCases(cases, { title: 'no jam' }, names).map((c) => c.id)).toEqual([300]);
  });

  it('filters by owner and assignee display names', () => {
    expect(filterCases(cases, { ownerText: 'dana' }, names).map((c) => c.id)).toEqual([100]);
    expect(filterCases(cases, { assigneeText: 'cohen' }, names).map((c) => c.id)).toEqual([200]);
  });

  it('restricts to section ids and applies never-ran coverage', () => {
    expect(filterCases(cases, { sectionIds: new Set([4]) }, names).map((c) => c.id)).toEqual([200, 300]);
    expect(
      filterCases(cases, { neverRan: true, coverage: new Set([100, 300]) }, names).map((c) => c.id),
    ).toEqual([200]);
  });
});

describe('csvForCases', () => {
  it('emits header + quoted rows with section/priority/type resolved', () => {
    const cases = [
      makeCase({ id: 5, title: 'Has, comma "and quote"', sectionId: 2, refs: 'J-1', estimate: '30m' }),
    ];
    const csv = csvForCases(cases, SECTIONS, { priority: () => 'High', type: () => 'Regression' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('ID,Title,Section,Priority,Type,Refs,Estimate');
    expect(lines[1]).toBe('C5,"Has, comma ""and quote""","Child","High","Regression","J-1","30m"');
  });
});

describe('stepsToText', () => {
  it('serializes numbered steps with indented Expected lines, skipping empties', () => {
    const text = stepsToText([
      { action: 'open lid', expected: 'lid opens' },
      { action: '', expected: '' },
      { action: 'close lid', expected: '' },
    ]);
    expect(text).toBe('1. open lid\n   Expected: lid opens\n2. close lid');
  });
});

describe('run aggregates', () => {
  const runs = [
    { passedCount: 3, failedCount: 1, blockedCount: 0, retestCount: 0, untestedCount: 4 },
    { passedCount: 5, failedCount: 0, blockedCount: 2, retestCount: 1, untestedCount: 0 },
  ];

  it('aggregateCounts sums every bucket', () => {
    expect(aggregateCounts(runs)).toEqual({
      passedCount: 8,
      failedCount: 1,
      blockedCount: 2,
      retestCount: 1,
      untestedCount: 4,
    });
  });

  it('passPct rounds over all buckets and dashes the empty run', () => {
    expect(passPct(runs[0])).toBe('38%');
    expect(passPct({ passedCount: 0, failedCount: 0, blockedCount: 0, retestCount: 0, untestedCount: 0 })).toBe('—');
  });
});
