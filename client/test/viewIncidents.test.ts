// Incidents view pure logic (ui-parity-contract.md §3).

import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  mergeSavedIntoOptions,
  parseIncidentFilters,
  serializeIncidentFilters,
  sliceBySummary,
  summaryMatches,
  toSelectionList,
} from '../src/lib/viewIncidentFilters';
import type { JiraFilterDefinition } from '../src/types';

const def = (id: string, isQuickFilter: boolean): JiraFilterDefinition => ({
  id,
  displayName: id,
  controlType: isQuickFilter ? 'quickButton' : 'multiSelectDropdown',
  jiraFieldName: isQuickFilter ? null : id,
  jiraFieldId: null,
  jqlTemplate: isQuickFilter ? 'x = y' : null,
  isQuickFilter,
  supportsMultiSelect: !isQuickFilter,
  displayOrder: 0,
  groupName: null,
});

describe('incidentFiltersJson round trip', () => {
  it('parses the persisted {filterId: string[]} dict', () => {
    expect(parseIncidentFilters('{"program":["Indigo 12"],"my-issues":[]}')).toEqual({
      program: ['Indigo 12'],
      'my-issues': [],
    });
  });

  it('tolerates bad data', () => {
    expect(parseIncidentFilters(null)).toEqual({});
    expect(parseIncidentFilters('')).toEqual({});
    expect(parseIncidentFilters('not json')).toEqual({});
    expect(parseIncidentFilters('[1,2]')).toEqual({});
    expect(parseIncidentFilters('{"a": "x", "b": [1, "ok"]}')).toEqual({ a: [], b: ['ok'] });
  });

  it('serialize → parse round-trips', () => {
    const map = { program: ['A', 'B'], unassigned: [] };
    expect(parseIncidentFilters(serializeIncidentFilters(map))).toEqual(map);
  });

  it('toSelectionList produces the POST body shape', () => {
    expect(toSelectionList({ program: ['A'], 'my-issues': [] })).toEqual([
      { filterId: 'program', values: ['A'] },
      { filterId: 'my-issues', values: [] },
    ]);
  });
});

describe('activeFilterCount', () => {
  const defs = [def('my-issues', true), def('program', false), def('status', false)];

  it('quick pills count when present; dropdowns need values', () => {
    expect(activeFilterCount({}, defs)).toBe(0);
    expect(activeFilterCount({ 'my-issues': [] }, defs)).toBe(1);
    expect(activeFilterCount({ program: [] }, defs)).toBe(0);
    expect(activeFilterCount({ program: ['A'], 'my-issues': [], status: ['Open', 'Done'] }, defs)).toBe(3);
  });
});

describe('summary search (client-side re-slice)', () => {
  const issue = (key: string, summary: string) => ({ key, summary });

  it('matches Summary OR Key ci; empty query matches all', () => {
    expect(summaryMatches(issue('ISW-1', 'Printer jam'), 'jam')).toBe(true);
    expect(summaryMatches(issue('ISW-1', 'Printer jam'), 'isw-1')).toBe(true);
    expect(summaryMatches(issue('ISW-1', 'Printer jam'), 'nope')).toBe(false);
    expect(summaryMatches(issue('ISW-1', 'Printer jam'), '  ')).toBe(true);
  });

  it('sliceBySummary filters a list without mutating it', () => {
    const list = [issue('ISW-1', 'Printer jam'), issue('ISW-2', 'Ink low')];
    expect(sliceBySummary(list, 'ink').map((i) => i.key)).toEqual(['ISW-2']);
    expect(list).toHaveLength(2);
  });
});

describe('mergeSavedIntoOptions (§3 persistence restore)', () => {
  it('appends saved values missing from options, keeps fetched order', () => {
    expect(mergeSavedIntoOptions(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
    expect(mergeSavedIntoOptions([], ['X'])).toEqual(['X']);
    expect(mergeSavedIntoOptions(['A'], [])).toEqual(['A']);
  });

  it('dedupes case-insensitively and skips blanks', () => {
    expect(mergeSavedIntoOptions(['Alpha'], ['alpha', '', 'Beta'])).toEqual(['Alpha', 'Beta']);
  });
});
