import { describe, expect, it } from 'vitest';
import { parseJiraTime } from '../src/lib/timeFormat';

describe('parseJiraTime (client port, ui-parity §12.5)', () => {
  it('parses hour/minute combos', () => {
    expect(parseJiraTime('1h 30m')).toBe(5400);
    expect(parseJiraTime('2h')).toBe(7200);
    expect(parseJiraTime('45m')).toBe(2700);
    expect(parseJiraTime('30s')).toBe(30);
  });

  it('accepts decimal separators . and ,', () => {
    expect(parseJiraTime('1.5h')).toBe(5400);
    expect(parseJiraTime('1,5h')).toBe(5400);
  });

  it('applies w=5×8h and d=8h', () => {
    expect(parseJiraTime('3w 4d 12h')).toBe((3 * 5 * 8 + 4 * 8 + 12) * 3600);
  });

  it('treats a trailing bare number as hours', () => {
    expect(parseJiraTime('2')).toBe(7200);
  });

  it('returns null for zero/unparseable', () => {
    expect(parseJiraTime('0m')).toBeNull();
    expect(parseJiraTime('')).toBeNull();
    expect(parseJiraTime(null)).toBeNull();
    expect(parseJiraTime('abc')).toBeNull();
  });

  it('unknown units contribute 0', () => {
    expect(parseJiraTime('1x 1h')).toBe(3600);
  });
});
