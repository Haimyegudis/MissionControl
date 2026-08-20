// Viewport-width hook. SSR-safe: react-dom/server has no window, and the
// component tests render through renderToString, where this reports "wide" so
// the desktop rendering stays the one under test.

import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 900;

export function useIsNarrow(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);

  return narrow;
}
