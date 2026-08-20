// Full-screen navigation sheet for phones. The desktop sidebar is hidden below
// the breakpoint, so the top bar's menu button opens this instead — otherwise
// the button does nothing and the bottom tabs are the only way to move around.
//
// It also hosts the top-bar actions that do not fit a phone-width header, so
// nothing is lost by trimming the header.

import type { CSSProperties, ReactNode } from 'react';
import { MOBILE_ROUTE_IDS, navigate, ROUTES, TESTRAIL_ROUTES, type RouteId } from '../router';

export interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  active: RouteId;
  userName: string;
  themeLabel: string;
  themeIcon: string;
  onCreateIncident: () => void;
  onOpenPalette: () => void;
  onOpenJql: () => void;
  onOpenHelp: () => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
  refreshRunning: boolean;
}

const sheetStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2500,
  background: 'var(--bg-panel)',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  paddingBottom: 'env(safe-area-inset-bottom)',
};

const groupLabelStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  opacity: 0.55,
  padding: '16px 16px 6px',
};

function Row({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '14px 16px',
        background: active ? 'var(--bg-hover, rgba(255,255,255,0.06))' : 'none',
        border: 'none',
        borderBottom: '1px solid var(--border-soft)',
        color: active ? 'var(--accent)' : 'var(--text-primary)',
        fontWeight: active ? 600 : 400,
        fontSize: 15,
      }}
    >
      {label}
    </button>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div style={groupLabelStyle}>{label}</div>
      {children}
    </>
  );
}

export function MobileNav(props: MobileNavProps) {
  if (!props.open) return null;

  const go = (id: RouteId) => {
    navigate(id);
    props.onClose();
  };
  const act = (fn: () => void) => {
    props.onClose();
    fn();
  };

  // Only routes this build can actually serve; the rest would render against a
  // dispatcher that has no handler for them.
  const jira = ROUTES.filter((r) => r.id !== 'settings' && MOBILE_ROUTE_IDS.has(r.id));
  const testrail = TESTRAIL_ROUTES.filter((r) => MOBILE_ROUTE_IDS.has(r.id));

  return (
    <div style={sheetStyle} role="dialog" aria-modal="true" aria-label="Navigation">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-soft)',
        }}
      >
        <div style={{ fontWeight: 700, letterSpacing: '0.06em', fontFamily: 'var(--font-display)' }}>
          <span style={{ color: 'var(--accent-cyan)' }}>MISSION</span>
          <span> CONTROL</span>
        </div>
        <button type="button" className="btn btn-icon" aria-label="Close menu" onClick={props.onClose}>
          ✕
        </button>
      </div>

      {jira.length > 0 && (
        <Section label="Jira">
          {jira.map((r) => (
            <Row key={r.id} label={r.label} active={props.active === r.id} onClick={() => go(r.id)} />
          ))}
        </Section>
      )}

      {testrail.length > 0 && (
        <Section label="TestRail">
          {testrail.map((r) => (
            <Row key={r.id} label={r.label} active={props.active === r.id} onClick={() => go(r.id)} />
          ))}
        </Section>
      )}

      <Section label="Actions">
        <Row label="+ Create Incident" onClick={() => act(props.onCreateIncident)} />
        <Row label="🔍 Search issues" onClick={() => act(props.onOpenPalette)} />
        <Row label="⚡ JQL search" onClick={() => act(props.onOpenJql)} />
        <Row
          label={props.refreshRunning ? 'Refreshing…' : '↻ Hard refresh'}
          onClick={() => act(props.onRefresh)}
        />
        <Row label={`${props.themeIcon} ${props.themeLabel}`} onClick={() => act(props.onToggleTheme)} />
        <Row label="? Help" onClick={() => act(props.onOpenHelp)} />
      </Section>

      <Section label="Account">
        <Row label="Settings" active={props.active === 'settings'} onClick={() => go('settings')} />
        <div style={{ padding: '14px 16px', fontSize: 13, opacity: 0.7 }}>
          {props.userName || 'Not signed in'}
        </div>
      </Section>
    </div>
  );
}
