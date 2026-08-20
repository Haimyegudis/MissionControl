// Phone navigation: replaces the 220px sidebar below the breakpoint. Only the
// Phase 1 routes appear, because nothing else is ported yet.

import type { CSSProperties } from 'react';
import { navigate, type RouteId } from '../router';

export const MOBILE_TABS: ReadonlyArray<{ id: RouteId; label: string }> = [
  { id: 'mywork', label: 'Backlog' },
  { id: 'testrail-runs', label: 'Runs' },
  { id: 'settings', label: 'Settings' },
];

const barStyle: CSSProperties = {
  display: 'flex',
  borderTop: '1px solid var(--border-soft)',
  background: 'var(--bg-panel)',
  paddingBottom: 'env(safe-area-inset-bottom)',
  flexShrink: 0,
};

export function BottomTabs({ active }: { active: RouteId }) {
  return (
    <nav style={barStyle}>
      {MOBILE_TABS.map((tab) => {
        const current = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => navigate(tab.id)}
            style={{
              flex: 1,
              padding: '12px 4px',
              background: 'none',
              border: 'none',
              fontSize: 13,
              fontWeight: current ? 600 : 400,
              color: current ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
