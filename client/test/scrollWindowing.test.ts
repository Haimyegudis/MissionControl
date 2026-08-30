// The case library and run detail views window their rows and extend the cap
// when the user nears the bottom. The app shell scrolls inside <main
// class="mc-main"> (overflow:auto) — document-level scroll never happens — so
// the helpers must work from the scrolled element itself, whatever it is.

import { describe, expect, it } from 'vitest';
import { nearBottom, scrollMetrics } from '../src/lib/scrollWindowing';

describe('nearBottom', () => {
  it('true within the margin of the bottom', () => {
    expect(nearBottom({ scrollTop: 1500, clientHeight: 800, scrollHeight: 3000 }, 800)).toBe(true);
  });

  it('false when far from the bottom', () => {
    expect(nearBottom({ scrollTop: 0, clientHeight: 800, scrollHeight: 10000 }, 800)).toBe(false);
  });

  it('true for a container that does not scroll at all', () => {
    // scrollHeight == clientHeight (nothing to scroll) — extending is harmless
    // and keeps short pages fully painted.
    expect(nearBottom({ scrollTop: 0, clientHeight: 800, scrollHeight: 800 }, 800)).toBe(true);
  });
});

describe('scrollMetrics', () => {
  it('reads metrics off a scrolled element (the mc-main container case)', () => {
    const el = { scrollTop: 2200, clientHeight: 800, scrollHeight: 3000 };
    expect(scrollMetrics(el as unknown as EventTarget)).toEqual({
      scrollTop: 2200,
      clientHeight: 800,
      scrollHeight: 3000,
    });
  });

  it('returns null for targets without scroll metrics', () => {
    expect(scrollMetrics(null)).toBeNull();
    expect(scrollMetrics({} as EventTarget)).toBeNull();
  });
});
