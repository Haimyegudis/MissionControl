import { describe, expect, it } from 'vitest';
import { formatElapsed, formatTimeSpan, trimRecentSummary } from '../src/lib/format';

describe('formatTimeSpan', () => {
  it('returns 0m for null/zero', () => {
    expect(formatTimeSpan(null)).toBe('0m');
    expect(formatTimeSpan(0)).toBe('0m');
  });

  it('formats hours and minutes', () => {
    expect(formatTimeSpan(5400)).toBe('1h 30m');
    expect(formatTimeSpan(3600)).toBe('1h');
    expect(formatTimeSpan(1800)).toBe('30m');
  });
});

describe('formatElapsed', () => {
  it('formats hh:mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(3671)).toBe('01:01:11');
  });
});

describe('trimRecentSummary', () => {
  it('strips a leading issue-key prefix', () => {
    expect(trimRecentSummary('ISW-1', 'ISW-1: - Fix the widget')).toBe('Fix the widget');
    expect(trimRecentSummary('ISW-1', 'Fix the widget')).toBe('Fix the widget');
  });
});
