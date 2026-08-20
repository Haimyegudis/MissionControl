// Mobile application shell.
//
// A separate UI from the desktop one, not a responsive skin over it. Both
// consume the same stores, the same typed API and the same in-process
// dispatcher, so there is one data layer and two presentations.
//
// The three back ends are kept apart at the top level, because they are three
// different products and folding their screens into one flat tab bar made it
// unclear which system you were looking at:
//
//   Jira            TestRail        Wiki            More
//   ├ Dashboard     ├ Cases         └ Spaces        └ Settings
//   ├ Incidents     └ Runs
//   └ Time
//
// The area lives in the tab bar; the screen within it lives in a tab strip
// under it. Two levels, both reachable by thumb.

import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { DialogHost } from '../dialogs/DialogHost';
import { ToastHost } from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { sessionStore } from '../stores/session';
import { loadSettings } from '../stores/settings';
import { useSplashDismiss, useThemeSync } from '../lib/appChrome';
import { useStore } from '../stores/useStore';
import { LoginPage } from '../views/LoginPage';
import { Loading, tapReset } from './ui';

const MobileDashboard = lazy(() => import('./screens/MobileDashboard').then((m) => ({ default: m.MobileDashboard })));
const MobileTimeSpent = lazy(() => import('./screens/MobileTimeSpent').then((m) => ({ default: m.MobileTimeSpent })));
const MobileIncidents = lazy(() => import('./screens/MobileIncidents').then((m) => ({ default: m.MobileIncidents })));
const MobileCases = lazy(() => import('./screens/MobileCases').then((m) => ({ default: m.MobileCases })));
const MobileRuns = lazy(() => import('./screens/MobileRuns').then((m) => ({ default: m.MobileRuns })));
const MobileConfluence = lazy(() => import('./screens/MobileConfluence').then((m) => ({ default: m.MobileConfluence })));
const MobileSettings = lazy(() => import('./screens/MobileSettings').then((m) => ({ default: m.MobileSettings })));

export type Area = 'jira' | 'testrail' | 'confluence' | 'more';

const AREAS: ReadonlyArray<{ id: Area; label: string; icon: string }> = [
  { id: 'jira', label: 'Jira', icon: '◈' },
  { id: 'testrail', label: 'TestRail', icon: '✓' },
  { id: 'confluence', label: 'Wiki', icon: '▤' },
  { id: 'more', label: 'More', icon: '⋯' },
];

const SUB: Record<Area, ReadonlyArray<{ id: string; label: string }>> = {
  jira: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'incidents', label: 'Incidents' },
    { id: 'time', label: 'Time' },
  ],
  testrail: [
    { id: 'cases', label: 'Cases' },
    { id: 'runs', label: 'Runs' },
  ],
  confluence: [],
  more: [],
};

const barStyle: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  borderTop: '1px solid var(--border-soft)',
  background: 'var(--bg-panel-high)',
  paddingBottom: 'env(safe-area-inset-bottom)',
};

export function MobileApp() {
  const session = useStore(sessionStore);
  const [area, setArea] = useState<Area>('jira');
  const [sub, setSub] = useState<Record<Area, string>>({
    jira: 'dashboard',
    testrail: 'cases',
    confluence: '',
    more: '',
  });

  useThemeSync();
  // Without this the splash overlay never leaves and the app looks stuck on
  // the welcome screen with everything rendered underneath. 600ms rather than
  // the desktop's 2.8s radar: a phone is opened many times a day.
  useSplashDismiss(600);
  useEffect(() => {
    void loadSettings();
  }, []);

  if (session.phase !== 'connected') {
    return (
      <>
        <LoginPage />
        <ToastHost />
      </>
    );
  }

  const current = sub[area];
  const screen = (() => {
    if (area === 'confluence') return <MobileConfluence />;
    if (area === 'more') return <MobileSettings />;
    if (area === 'testrail') return current === 'runs' ? <MobileRuns /> : <MobileCases />;
    if (current === 'incidents') return <MobileIncidents />;
    if (current === 'time') return <MobileTimeSpent />;
    return <MobileDashboard />;
  })();

  const tabs = SUB[area];

  return (
    <DialogHost>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {tabs.length > 0 ? (
          <div
            role="tablist"
            style={{
              display: 'flex',
              flexShrink: 0,
              gap: 2,
              padding: '6px 10px 0',
              background: 'var(--bg-panel)',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            {tabs.map((t) => {
              const active = t.id === current;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSub((prev) => ({ ...prev, [area]: t.id }))}
                  style={{
                    ...tapReset,
                    flex: 1,
                    minHeight: 40,
                    border: 'none',
                    background: 'none',
                    borderBottom: `2px solid ${active ? 'var(--accent-cyan)' : 'transparent'}`,
                    color: active ? 'var(--accent-cyan)' : 'var(--muted)',
                    fontWeight: active ? 650 : 450,
                    fontSize: 13,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary>
            <Suspense fallback={<Loading />}>{screen}</Suspense>
          </ErrorBoundary>
        </div>

        <nav style={barStyle} aria-label="Primary">
          {AREAS.map((a) => {
            const active = area === a.id;
            return (
              <button
                key={a.id}
                aria-current={active ? 'page' : undefined}
                onClick={() => setArea(a.id)}
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
                  {a.icon}
                </span>
                <span style={{ fontSize: 10.5, letterSpacing: '0.03em', fontWeight: active ? 650 : 450 }}>
                  {a.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <ToastHost />
    </DialogHost>
  );
}
