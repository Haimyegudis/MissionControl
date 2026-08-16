// Time-in-Status raw field parsing (lib/timeInStatus).

import { describe, expect, it } from 'vitest';
import { fmtDuration, parseTimeInStatus } from '../src/lib/timeInStatus';

describe('parseTimeInStatus', () => {
  it('parses the plugin raw format and sorts by longest stay', () => {
    const raw = '11404_*:*_1_*:*_1812829013_*|*_3_*:*_2_*:*_2574790917_*|*_10003_*:*_1_*:*_0';
    const entries = parseTimeInStatus(raw)!;
    expect(entries.map((e) => e.statusId)).toEqual(['3', '11404', '10003']);
    expect(entries[0].count).toBe(2);
    expect(entries[0].millis).toBe(2574790917);
  });

  it('returns null for normal field values', () => {
    expect(parseTimeInStatus('Kedem')).toBeNull();
    expect(parseTimeInStatus('')).toBeNull();
    expect(parseTimeInStatus(null)).toBeNull();
    expect(parseTimeInStatus('a_*:*_b')).toBeNull(); // malformed
  });
});

describe('fmtDuration', () => {
  it('formats days/hours/minutes', () => {
    expect(fmtDuration(29 * 86400000 + 18 * 3600000)).toBe('29d 18h');
    expect(fmtDuration(3 * 3600000 + 12 * 60000)).toBe('3h 12m');
    expect(fmtDuration(12 * 60000)).toBe('12m');
    expect(fmtDuration(0)).toBe('<1m');
    expect(fmtDuration(2 * 86400000)).toBe('2d');
  });
});
