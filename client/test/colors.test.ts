import { describe, expect, it } from 'vitest';
import {
  agingColor,
  agingDotVisible,
  daysSinceUpdate,
  epicLabelColor,
  priorityColor,
  starColor,
  statusColor,
} from '../src/lib/colors';

const NOW = new Date('2026-08-12T12:00:00');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('agingColor / agingDotVisible (ui-parity §12.8)', () => {
  it('red at >=7 days', () => {
    expect(agingColor(daysAgo(7), NOW)).toBe('#EF4444');
    expect(agingColor(daysAgo(30), NOW)).toBe('#EF4444');
  });

  it('amber at 3-6 days', () => {
    expect(agingColor(daysAgo(3), NOW)).toBe('#F59E0B');
    expect(agingColor(daysAgo(6.5), NOW)).toBe('#F59E0B');
  });

  it('green below 3 days', () => {
    expect(agingColor(daysAgo(0), NOW)).toBe('#10B981');
    expect(agingColor(daysAgo(2.9), NOW)).toBe('#10B981');
  });

  it('null for missing or epoch/min dates', () => {
    expect(agingColor(null, NOW)).toBeNull();
    expect(agingColor(undefined, NOW)).toBeNull();
    expect(agingColor('', NOW)).toBeNull();
    expect(agingColor('1970-01-01T00:00:00Z', NOW)).toBeNull();
    expect(agingColor('0001-01-01T00:00:00Z', NOW)).toBeNull();
    expect(agingColor('not a date', NOW)).toBeNull();
  });

  it('dot visible only when stalling (>=3 days)', () => {
    expect(agingDotVisible(daysAgo(3), NOW)).toBe(true);
    expect(agingDotVisible(daysAgo(10), NOW)).toBe(true);
    expect(agingDotVisible(daysAgo(2), NOW)).toBe(false);
    expect(agingDotVisible(null, NOW)).toBe(false);
    expect(agingDotVisible('1970-01-01T00:00:00Z', NOW)).toBe(false);
  });

  it('daysSinceUpdate floors whole days', () => {
    expect(daysSinceUpdate(daysAgo(4.9), NOW)).toBe(4);
  });
});

describe('priorityColor (ui-parity §12.8)', () => {
  it('highest/critical/blocker red', () => {
    expect(priorityColor('Highest')).toBe('var(--accent-red, #EF4444)');
    expect(priorityColor('Critical')).toBe('var(--accent-red, #EF4444)');
    expect(priorityColor('Blocker')).toBe('var(--accent-red, #EF4444)');
  });

  it('high/s3 orange', () => {
    expect(priorityColor('High')).toBe('var(--accent-orange, #FFA13A)');
    expect(priorityColor('S3 - Major')).toBe('var(--accent-orange, #FFA13A)');
  });

  it('medium/s4 yellow', () => {
    expect(priorityColor('Medium')).toBe('var(--accent-yellow, #FFD23A)');
    expect(priorityColor('S4 - Minor')).toBe('var(--accent-yellow, #FFD23A)');
  });

  it('low/s5/s6/default gray-blue', () => {
    expect(priorityColor('Low')).toBe('var(--muted, #8AA0BF)');
    expect(priorityColor('S5')).toBe('var(--muted, #8AA0BF)');
    expect(priorityColor('S6')).toBe('var(--muted, #8AA0BF)');
    expect(priorityColor(null)).toBe('var(--muted, #8AA0BF)');
    expect(priorityColor('Whatever')).toBe('var(--muted, #8AA0BF)');
  });
});

describe('statusColor (ui-parity §12.8)', () => {
  it('done|closed|delivered green', () => {
    expect(statusColor('Done')).toBe('var(--accent-green, #22D38F)');
    expect(statusColor('Closed')).toBe('var(--accent-green, #22D38F)');
    expect(statusColor('Delivered')).toBe('var(--accent-green, #22D38F)');
  });

  it('blocked|rejected red', () => {
    expect(statusColor('Blocked')).toBe('var(--accent-red, #EF4444)');
    expect(statusColor('Rejected')).toBe('var(--accent-red, #EF4444)');
  });

  it('progress|review cyan', () => {
    expect(statusColor('In Progress')).toBe('var(--accent-cyan, #1FE0E0)');
    expect(statusColor('In Review')).toBe('var(--accent-cyan, #1FE0E0)');
  });

  it('default gray-blue', () => {
    expect(statusColor('Open')).toBe('var(--accent-blue, #4F9CF9)');
    expect(statusColor(null)).toBe('var(--muted, #8AA0BF)');
  });
});

describe('epicLabelColor (ui-parity §12.8)', () => {
  it('is deterministic', () => {
    expect(epicLabelColor('ISW-100')).toEqual(epicLabelColor('ISW-100'));
  });

  it('hashes lowercased char codes (case-insensitive)', () => {
    expect(epicLabelColor('ISW-100')).toEqual(epicLabelColor('isw-100'));
  });

  it('produces distinct colors for different keys', () => {
    expect(epicLabelColor('ISW-100').bg).not.toBe(epicLabelColor('ISW-200').bg);
  });

  it('returns valid hex bg and black/white fg', () => {
    for (const key of ['ISW-1', 'ISW-42', 'ABC-999', 'ZZ-7']) {
      const { bg, fg } = epicLabelColor(key);
      expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['#000000', '#FFFFFF']).toContain(fg);
    }
  });
});

describe('starColor', () => {
  it('gold when starred, light gray otherwise', () => {
    expect(starColor(true)).toBe('#FFD700');
    expect(starColor(false)).toBe('#D3D3D3');
  });
});
