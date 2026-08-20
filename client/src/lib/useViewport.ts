// Viewport-width hook.
//
// Narrow means "the Android shell", not merely "a small window". The mobile
// shell stamps data-mobile on the root; without it this always reports wide,
// so a desktop window dragged narrow keeps the desktop layout. SSR-safe:
// react-dom/server has no window, and the component tests render through
// renderToString, where this reports wide.

import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 900;

function inMobileShell(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.mobile === '1';
}

export function useIsNarrow(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [narrow, setNarrow] = useState(
    () => inMobileShell() && typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );

  useEffect(() => {
    if (!inMobileShell()) return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);

  return narrow;
}
