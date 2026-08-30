// Never-ran coverage: a case merely included in a run (Untested) has not run.

import { describe, expect, it } from 'vitest';
import { hasUnknownSection, ranCaseIds, UNTESTED_STATUS_ID } from '../src/lib/testrail';

describe('ranCaseIds', () => {
  it('keeps cases whose test has a real result', () => {
    expect(
      ranCaseIds([
        { caseId: 1, statusId: 1 }, // passed
        { caseId: 2, statusId: 5 }, // failed
      ]),
    ).toEqual([1, 2]);
  });

  it('drops untested tests — include_all runs auto-add new cases as Untested', () => {
    expect(
      ranCaseIds([
        { caseId: 1, statusId: UNTESTED_STATUS_ID },
        { caseId: 2, statusId: 4 }, // retest counts as ran
      ]),
    ).toEqual([2]);
  });

  it('returns empty for an all-untested run', () => {
    expect(ranCaseIds([{ caseId: 9, statusId: UNTESTED_STATUS_ID }])).toEqual([]);
  });
});

describe('hasUnknownSection', () => {
  const secs = [{ id: 10 }, { id: 20 }];
  it('false when every case section is known', () => {
    expect(hasUnknownSection([{ sectionId: 10 }, { sectionId: 20 }], secs)).toBe(false);
  });
  it('true when a case references a section the list lacks', () => {
    expect(hasUnknownSection([{ sectionId: 10 }, { sectionId: 99 }], secs)).toBe(true);
  });
  it('ignores cases without a section', () => {
    expect(hasUnknownSection([{ sectionId: null }], secs)).toBe(false);
  });
});
