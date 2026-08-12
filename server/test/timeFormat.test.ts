import { describe, it, expect } from 'vitest';
import { parseJiraTime, formatTimeSpan } from '../src/jira/timeFormat.js';

describe('parseJiraTime', () => {
  it('parses "1h 30m" to 5400 seconds', () => {
    expect(parseJiraTime('1h 30m')).toBe(5400);
  });

  it('parses decimal hours "1.5h" to 5400', () => {
    expect(parseJiraTime('1.5h')).toBe(5400);
  });

  it('parses comma-decimal "1,5h" to 5400', () => {
    expect(parseJiraTime('1,5h')).toBe(5400);
  });

  it('parses "3w 4d 12h" with w=5x8h, d=8h', () => {
    expect(parseJiraTime('3w 4d 12h')).toBe((3 * 40 + 4 * 8 + 12) * 3600);
  });

  it('treats trailing bare number as hours: "2" = 7200', () => {
    expect(parseJiraTime('2')).toBe(7200);
  });

  it('parses simple unit forms', () => {
    expect(parseJiraTime('2h')).toBe(7200);
    expect(parseJiraTime('45m')).toBe(2700);
    expect(parseJiraTime('30s')).toBe(30);
  });

  it('parses without spaces between segments: "1h30m"', () => {
    expect(parseJiraTime('1h30m')).toBe(5400);
  });

  it('allows whitespace between number and unit: "2 h"', () => {
    expect(parseJiraTime('2 h')).toBe(7200);
  });

  it('returns null on total <= 0: "0m"', () => {
    expect(parseJiraTime('0m')).toBeNull();
  });

  it('returns null on unparseable token: "abc"', () => {
    expect(parseJiraTime('abc')).toBeNull();
  });

  it('returns null on null/empty/whitespace input', () => {
    expect(parseJiraTime(null)).toBeNull();
    expect(parseJiraTime('')).toBeNull();
    expect(parseJiraTime('   ')).toBeNull();
  });

  it('unknown unit contributes 0', () => {
    expect(parseJiraTime('5x')).toBeNull(); // total 0 -> null
    expect(parseJiraTime('1h 5x')).toBe(3600);
  });

  it('returns null on malformed numeric token like "1.2.3h"', () => {
    expect(parseJiraTime('1.2.3h')).toBeNull();
  });
});

describe('formatTimeSpan', () => {
  it('renders null and zero as "0m"', () => {
    expect(formatTimeSpan(null)).toBe('0m');
    expect(formatTimeSpan(0)).toBe('0m');
  });

  it('renders hours and minutes: 5400 -> "1h 30m"', () => {
    expect(formatTimeSpan(5400)).toBe('1h 30m');
  });

  it('renders whole hours: 7200 -> "2h"', () => {
    expect(formatTimeSpan(7200)).toBe('2h');
  });

  it('renders minutes only: 1800 -> "30m"', () => {
    expect(formatTimeSpan(1800)).toBe('30m');
  });

  it('accumulates beyond 24h: 90000 -> "25h"', () => {
    expect(formatTimeSpan(90000)).toBe('25h');
  });

  it('sub-minute renders "0m"', () => {
    expect(formatTimeSpan(59)).toBe('0m');
  });
});
