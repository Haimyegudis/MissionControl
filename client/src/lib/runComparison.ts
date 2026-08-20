import type { TrTest } from '../testrailTypes';

export interface TestDelta {
  caseId: number;
  title: string;
  beforeStatus: number | null;
  afterStatus: number | null;
}

export interface RunComparison {
  newFailures: TestDelta[];
  fixed: TestDelta[];
  newlyBlocked: TestDelta[];
  newlyUntested: TestDelta[];
  persistentFailures: TestDelta[];
}

/** Compare the same TestRail cases across two runs; the second run is the newer side. */
export function compareRunTests(before: TrTest[], after: TrTest[]): RunComparison {
  const previous = new Map(before.map((test) => [test.caseId, test]));
  const deltas: TestDelta[] = after.map((test) => ({
    caseId: test.caseId,
    title: test.title,
    beforeStatus: previous.get(test.caseId)?.statusId ?? null,
    afterStatus: test.statusId,
  }));
  return {
    newFailures: deltas.filter((item) => item.afterStatus === 5 && item.beforeStatus !== 5),
    fixed: deltas.filter((item) => item.beforeStatus === 5 && item.afterStatus === 1),
    newlyBlocked: deltas.filter((item) => item.afterStatus === 2 && item.beforeStatus !== 2),
    newlyUntested: deltas.filter((item) => item.afterStatus === 3 && item.beforeStatus !== 3),
    persistentFailures: deltas.filter((item) => item.afterStatus === 5 && item.beforeStatus === 5),
  };
}
