// Shared page header — the TestRail pages' kicker + display-font title
// pattern, now available to every view so the three app areas read as one
// product (Jira pages used to have small plain-text titles or none).

import type { ReactNode } from 'react';
import { useIsNarrow } from '../lib/useViewport';

export function PageHeader({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker: string;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  // On a phone the title and its action cluster cannot share a line without one
  // of them being squeezed to nothing, so they stack and the actions become a
  // swipeable rail (.mc-chip-row is styled for that in the touch layer).
  const narrow = useIsNarrow();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: narrow ? 'stretch' : 'flex-end',
        flexDirection: narrow ? 'column' : 'row',
        justifyContent: 'space-between',
        gap: narrow ? 8 : 16,
        flexWrap: 'wrap',
        marginBottom: 4,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="tr-kicker">{kicker}</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: narrow ? 20 : 26, margin: '2px 0 2px' }}>
          {title}
        </h1>
        {subtitle ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {right ? (
        <div
          className={narrow ? 'mc-chip-row' : undefined}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: narrow ? 'nowrap' : 'wrap' }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}
