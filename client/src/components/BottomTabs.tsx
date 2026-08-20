// Phone navigation: replaces the 220px sidebar below the breakpoint. Only the
// Phase 1 routes appear, because nothing else is ported yet.

import type { CSSProperties } from 'react';
import { navigate, type RouteId } from '../router';

export const MOBILE_TABS: ReadonlyArray<{ id: RouteId; label: string; icon: string }> = [
  { id: 'mywork', label: 'Backlog', icon: '☰' },
  { id: 'testrail-runs', label: 'Runs', icon: '▶' },
  { id: 'testrail-cases', label: 'Cases', icon: '✓' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

const barStyle: CSSProperties = {
  display: 'flex',
  borderTop: '1px solid var(--border-soft)',
  // Sits above the content it scrolls over, so it needs to be opaque enough to
  // read against a dense card list.
  background: 'var(--bg-panel-high)',
  backdropFilter: 'blur(14px)',
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
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              minHeight: 56,
              padding: '8px 2px',
              background: 'none',
              border: 'none',
              // A 2px cyan cap reads as "you are here" faster than colour alone.
              boxShadow: current ? 'inset 0 2px 0 0 var(--accent-cyan)' : 'none',
              color: current ? 'var(--accent-cyan)' : 'var(--muted)',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
              {tab.icon}
            </span>
            <span style={{ fontSize: 11, letterSpacing: '0.04em', fontWeight: current ? 650 : 450 }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
