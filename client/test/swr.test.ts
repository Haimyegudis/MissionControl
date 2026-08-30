// Stale-while-revalidate throttle for suite-keyed loaders (cases/sections).

import { describe, expect, it } from 'vitest';
import { SWR_REVALIDATE_MS, swrDue } from '../src/lib/testrail';

describe('swrDue', () => {
  it('is due when the key was never fetched', () => {
    expect(swrDue(undefined, 1_000_000)).toBe(true);
  });

  it('is not due inside the throttle window', () => {
    const now = 1_000_000;
    expect(swrDue(now - SWR_REVALIDATE_MS + 1, now)).toBe(false);
  });

  it('is due once the throttle window has passed', () => {
    const now = 1_000_000;
    expect(swrDue(now - SWR_REVALIDATE_MS, now)).toBe(true);
  });

  it('honours a custom interval', () => {
    expect(swrDue(90, 100, 10)).toBe(true);
    expect(swrDue(95, 100, 10)).toBe(false);
  });
});
