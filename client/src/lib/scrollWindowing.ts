// Row-cap windowing for long tables. The app shell scrolls inside <main
// class="mc-main"> (overflow:auto), not at document level, so views cannot
// watch document.documentElement — they listen for scroll in the capture
// phase (scroll does not bubble) and measure whichever element scrolled.

import { useEffect, useState } from 'react';

export interface ScrollBox {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** True when the scroll position is within `margin` px of the bottom. */
export function nearBottom(box: ScrollBox, margin: number): boolean {
  return box.scrollTop + box.clientHeight > box.scrollHeight - margin;
}

/** Scroll metrics of an event target: the element itself, or the root element
 *  for document-level scrolls. Null when the target has none. */
export function scrollMetrics(target: EventTarget | null): ScrollBox | null {
  if (!target) return null;
  const el =
    typeof Document !== 'undefined' && target instanceof Document
      ? target.documentElement
      : (target as Partial<HTMLElement>);
  const { scrollTop, clientHeight, scrollHeight } = el as ScrollBox;
  if (
    typeof scrollTop !== 'number' ||
    typeof clientHeight !== 'number' ||
    typeof scrollHeight !== 'number'
  ) {
    return null;
  }
  return { scrollTop, clientHeight, scrollHeight };
}

/** Row cap that starts at `step` and grows by `step` whenever any scroll
 *  container on the page nears its bottom. */
export function useWindowedRowCap(step: number, margin = 800): number {
  const [cap, setCap] = useState(step);
  useEffect(() => {
    const onScroll = (e: Event) => {
      const box = scrollMetrics(e.target);
      if (box && nearBottom(box, margin)) setCap((c) => c + step);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [step, margin]);
  return cap;
}
