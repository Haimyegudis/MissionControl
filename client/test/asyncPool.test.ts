import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/lib/asyncPool';

describe('mapWithConcurrency', () => {
  it('preserves order, limits parallel work, and reports individual failures', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (value === 4) throw new Error('expected');
      return value * 10;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled',
    ]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 10 });
  });
});

