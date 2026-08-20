import { describe, expect, it } from 'vitest';
import type { TrTest } from '../testrailTypes';
import { compareRunTests } from './runComparison';

const test = (caseId: number, statusId: number): TrTest => ({
  id: caseId,
  runId: 1,
  caseId,
  title: `Case ${caseId}`,
  statusId,
  assignedToId: null,
  priorityId: null,
  typeId: null,
});

describe('compareRunTests', () => {
  it('separates regressions, fixes, and persistent failures', () => {
    const result = compareRunTests([test(1, 1), test(2, 5), test(3, 5)], [test(1, 5), test(2, 1), test(3, 5)]);
    expect(result.newFailures.map((item) => item.caseId)).toEqual([1]);
    expect(result.fixed.map((item) => item.caseId)).toEqual([2]);
    expect(result.persistentFailures.map((item) => item.caseId)).toEqual([3]);
  });
});
