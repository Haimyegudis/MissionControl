// Shared page header — the TestRail pages' kicker + display-font title
// pattern, now available to every view so the three app areas read as one
// product (Jira pages used to have small plain-text titles or none).

import type { ReactNode } from 'react';

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
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 4,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="tr-kicker">{kicker}</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, margin: '2px 0 2px' }}>{title}</h1>
        {subtitle ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {right ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div> : null}
    </div>
  );
}
