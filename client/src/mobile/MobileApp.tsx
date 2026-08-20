// Mobile application shell.
//
// This is a separate UI from the desktop one, not a responsive skin over it.
// The desktop app is a dense multi-pane workspace; a phone gets one thing at a
// time, chosen from five thumb-reachable tabs. Both consume the same stores,
// the same typed API and the same in-process dispatcher, so there is one data
// layer and two presentations.
//
// Six destinations on five tabs, because six tabs is one too many to hit
// reliably at this width:
//
//   Dashboard │ Time │ Incidents │ Tests │ More
//                                 ├ Cases    ├ Confluence
//                                 └ Runs     └ Settings

import { lazy, Suspense, useState, type CSSProperties } from 'react';
import { DialogHost } from '../dialogs/DialogHost';
import { ToastHost } from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { sessionStore } from '../stores/session';
import { useStore } from '../stores/useStore';
import { LoginPage } from '../views/LoginPage';
import { Loading, Sheet, tapReset } from './ui';

const MobileDashboard = lazy(() => import('./screens/MobileDashboard').then((m) => ({ default: m.MobileDashboard })));
const MobileTimeSpent = lazy(() => import('./screens/MobileTimeSpent').then((m) => ({ default: m.MobileTimeSpent })));
const MobileIncidents = lazy(() => import('./screens/MobileIncidents').then((m) => ({ default: m.MobileIncidents })));
const MobileTests = lazy(() => import('./screens/MobileTests').then((m) => ({ default: m.MobileTests })));
const MobileConfluence = lazy(() => import('./screens/MobileConfluence').then((m) => ({ default: m.MobileConfluence })));
const MobileSettings = lazy(() => import('./screens/MobileSettings').then((m) => ({ default: m.MobileSettings })));

export type MobileTab = 'dashboard' | 'time' | 'incidents' | 'tests' | 'more';
type MoreScreen = 'confluence' | 'settings' | null;

const TABS: ReadonlyArray<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Home', icon: '◈' },
  { id: 'time', label: 'Time', icon: '◷' },
  { id: 'incidents', label: 'Incidents', icon: '⚠' },
  { id: 'tests', label: 'Tests', icon: '✓' },
  { id: 'more', label: 'More', icon: '⋯' },
];

const barStyle: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  borderTop: '1px solid var(--border-soft)',
  background: 'var(--bg-panel-high)',
  paddingBottom: 'env(safe-area-inset-bottom)',
};

export function MobileApp() {
  const session = useStore(sessionStore);
  const [tab, setTab] = useState<MobileTab>('dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreScreen, setMoreScreen] = useState<MoreScreen>(null);

  if (session.phase !== 'connected') {
    return (
      <>
        <LoginPage />
        <ToastHost />
      </>
    );
  }

  const openMore = (screen: Exclude<MoreScreen, null>) => {
    setMoreScreen(screen);
    setMoreOpen(false);
    setTab('more');
  };

  const screen = (() => {
    switch (tab) {
      case 'time':
        return <MobileTimeSpent />;
      case 'incidents':
        return <MobileIncidents />;
      case 'tests':
        return <MobileTests />;
      case 'more':
        return moreScreen === 'confluence' ? <MobileConfluence /> : <MobileSettings />;
      case 'dashboard':
      default:
        return <MobileDashboard />;
    }
  })();

  return (
    <DialogHost>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary>
            <Suspense fallback={<Loading />}>{screen}</Suspense>
          </ErrorBoundary>
        </div>

        <nav style={barStyle} aria-label="Primary">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (t.id === 'more') {
                    setMoreOpen(true);
                    return;
                  }
                  setTab(t.id);
                }}
                style={{
                  ...tapReset,
                  flex: 1,
                  minHeight: 56,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  border: 'none',
                  background: 'none',
                  boxShadow: active ? 'inset 0 2px 0 0 var(--accent-cyan)' : 'none',
                  color: active ? 'var(--accent-cyan)' : 'var(--muted)',
                }}
              >
                <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
                  {t.icon}
                </span>
                <span style={{ fontSize: 10.5, letterSpacing: '0.03em', fontWeight: active ? 650 : 450 }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <Sheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <MoreRow label="Confluence" hint="Requires corporate VPN" onClick={() => openMore('confluence')} />
        <MoreRow label="Settings" hint="Connections and preferences" onClick={() => openMore('settings')} />
      </Sheet>

      <ToastHost />
    </DialogHost>
  );
}

function MoreRow({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...tapReset,
        display: 'block',
        width: '100%',
        textAlign: 'left',
        minHeight: 60,
        padding: '12px 4px',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--border-soft)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>
    </button>
  );
}
