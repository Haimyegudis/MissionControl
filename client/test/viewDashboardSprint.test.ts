// Active-sprint resolution for the Dashboard card header: derived from the
// loaded issues, not a hardcoded board.

import { describe, expect, it } from 'vitest';
import { formatSprintHeader, resolveActiveSprint } from '../src/lib/viewDashboard';
import type { JiraIssue } from '../src/types';

const NOW = new Date('2026-08-23T09:00:00Z');

function issue(sprint: string | null, endDate: string | null = '2026-08-26T00:00:00Z'): JiraIssue {
  return {
    key: 'ISW-1',
    sprint,
    allSprints: sprint ? [{ name: sprint, state: 'ACTIVE', startDate: '2026-08-12T00:00:00Z', endDate }] : [],
  } as unknown as JiraIssue;
}

describe('resolveActiveSprint', () => {
  it('returns null when no issue carries a sprint', () => {
    expect(resolveActiveSprint([issue(null)], NOW)).toBeNull();
    expect(resolveActiveSprint([], NOW)).toBeNull();
  });

  it('picks the most common sprint name across the issues', () => {
    const issues = [issue('Sprint 128'), issue('Sprint 128'), issue('Sprint 129')];
    expect(resolveActiveSprint(issues, NOW)?.name).toBe('Sprint 128');
  });

  it('computes whole days left from the end date', () => {
    expect(resolveActiveSprint([issue('Sprint 128')], NOW)?.daysLeft).toBe(3);
  });

  it('never reports a negative day count', () => {
    expect(resolveActiveSprint([issue('Sprint 128', '2026-08-20T00:00:00Z')], NOW)?.daysLeft).toBe(0);
  });

  it('tolerates a sprint with no end date', () => {
    expect(resolveActiveSprint([issue('Sprint 128', null)], NOW)).toMatchObject({
      name: 'Sprint 128',
      daysLeft: null,
    });
  });

  it('ignores a closed sprint entry with the same name', () => {
    const stale = {
      key: 'ISW-2',
      sprint: 'Sprint 128',
      allSprints: [
        { name: 'Sprint 127', state: 'CLOSED', startDate: null, endDate: '2026-08-11T00:00:00Z' },
        { name: 'Sprint 128', state: 'ACTIVE', startDate: null, endDate: '2026-08-26T00:00:00Z' },
      ],
    } as unknown as JiraIssue;
    expect(resolveActiveSprint([stale], NOW)?.daysLeft).toBe(3);
  });
});

describe('formatSprintHeader', () => {
  it('reads as one line with the countdown', () => {
    expect(
      formatSprintHeader({ name: 'ISW Sprint 128', endDate: '2026-08-26T00:00:00Z', daysLeft: 3 }),
    ).toBe('My Current Sprint — ISW Sprint 128 · 3 days left (ends 26 Aug)');
  });

  it('says ends today rather than 0 days left', () => {
    expect(
      formatSprintHeader({ name: 'ISW Sprint 128', endDate: '2026-08-23T00:00:00Z', daysLeft: 0 }),
    ).toBe('My Current Sprint — ISW Sprint 128 · ends today');
  });

  it('uses the singular for one day', () => {
    expect(
      formatSprintHeader({ name: 'ISW Sprint 128', endDate: '2026-08-24T00:00:00Z', daysLeft: 1 }),
    ).toBe('My Current Sprint — ISW Sprint 128 · 1 day left (ends 24 Aug)');
  });

  it('drops the countdown when there is no end date', () => {
    expect(formatSprintHeader({ name: 'ISW Sprint 128', endDate: null, daysLeft: null })).toBe(
      'My Current Sprint — ISW Sprint 128',
    );
  });

  it('falls back to the plain title with no sprint', () => {
    expect(formatSprintHeader(null)).toBe('My Current Sprint');
  });
});
