// App root — session gate (loading → LoginPage or Shell) + routed views.
// Real views land in Task B4; placeholders keep every route reachable.

import { lazy, Suspense, useEffect } from 'react';
import { Shell } from './components/Shell';
import { pruneDrafts } from './lib/drafts';
import { ToastHost } from './components/Toast';
import { DialogHost, useDialogs } from './dialogs/DialogHost';
import { routeStore } from './router';
import { initScheduler } from './stores/scheduler';
import { sessionStore } from './stores/session';
import { isSettingsLoaded, loadSettings, resolveTheme, settingsStore } from './stores/settings';
import { pushToast } from './stores/toasts';
import { useStore } from './stores/useStore';
import { LoginPage } from './views/LoginPage';
import { DashboardView } from './views/DashboardView';

// Route-level code splitting: only the dashboard ships in the entry chunk;
// every other view loads on first visit.
const MyWorkView = lazy(() => import('./views/MyWorkView').then((m) => ({ default: m.MyWorkView })));
const IncidentsView = lazy(() => import('./views/IncidentsView').then((m) => ({ default: m.IncidentsView })));
const BoardsView = lazy(() => import('./views/BoardsView').then((m) => ({ default: m.BoardsView })));
const FiltersView = lazy(() => import('./views/FiltersView').then((m) => ({ default: m.FiltersView })));
const RecentUpdatesView = lazy(() => import('./views/RecentUpdatesView').then((m) => ({ default: m.RecentUpdatesView })));
const TimeLoggedView = lazy(() => import('./views/TimeLoggedView').then((m) => ({ default: m.TimeLoggedView })));
const DashboardsView = lazy(() => import('./views/DashboardsView').then((m) => ({ default: m.DashboardsView })));
const TeamView = lazy(() => import('./views/TeamView').then((m) => ({ default: m.TeamView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));
const CaseLibraryView = lazy(() => import('./views/testrail/CaseLibraryView').then((m) => ({ default: m.CaseLibraryView })));
const RunsView = lazy(() => import('./views/testrail/RunsView').then((m) => ({ default: m.RunsView })));
const RunDetailView = lazy(() => import('./views/testrail/RunDetailView').then((m) => ({ default: m.RunDetailView })));
const TestRailReportsView = lazy(() => import('./views/testrail/TestRailReportsView').then((m) => ({ default: m.TestRailReportsView })));
const ConfluenceView = lazy(() => import('./views/confluence/ConfluenceView').then((m) => ({ default: m.ConfluenceView })));

const viewFallback = (
  <div className="muted" style={{ padding: 48, textAlign: 'center', fontSize: 13 }}>
    Loading…
  </div>
);

function ActiveView() {
  const route = useStore(routeStore);
  const view = (() => {
    switch (route) {
      case 'mywork':
        return <MyWorkView />;
      case 'incidents':
        return <IncidentsView />;
      case 'boards':
        return <BoardsView />;
      case 'filters':
        return <FiltersView />;
      case 'recent':
        return <RecentUpdatesView />;
      case 'timelogged':
        return <TimeLoggedView />;
      case 'dashboards':
        return <DashboardsView />;
      case 'team':
        return <TeamView />;
      case 'settings':
        return <SettingsView />;
      case 'testrail-cases':
        return <CaseLibraryView />;
      case 'testrail-runs':
        return <RunsView />;
      case 'testrail-run':
        return <RunDetailView />;
      case 'testrail-reports':
        return <TestRailReportsView />;
      case 'confluence':
        return <ConfluenceView />;
      case 'dashboard':
      default:
        return <DashboardView />;
    }
  })();
  return <Suspense fallback={viewFallback}>{view}</Suspense>;
}

/** Shell + views, wired to the dialog openers (must render under DialogHost). */
function ConnectedShell() {
  const dialogs = useDialogs();
  return (
    <Shell
      onCreateIncident={() => dialogs.openCreateIssue()}
      onOpenPalette={(mode) => dialogs.openPalette(mode)}
    >
      <ActiveView />
    </Shell>
  );
}

/** Keep <html data-theme> in sync with settings (theme applies live). Waits
 *  for the first real load so the boot splash's persisted theme survives,
 *  then mirrors the resolved value to localStorage for the splash script. */
function useThemeSync() {
  const settings = useStore(settingsStore);
  useEffect(() => {
    if (!isSettingsLoaded()) return;
    const resolved = resolveTheme(settings.theme);
    document.documentElement.dataset.theme = resolved;
    try {
      localStorage.setItem('jiraweb.theme', resolved);
    } catch {
      /* mirror is best-effort */
    }
  }, [settings]);
}

/** Dismiss the boot splash (client/index.html) after the full radar animation.
 *  The user wants the animation on EVERY load/refresh — no fast-load skip:
 *  the ~2.8s sequence always completes, then fades out (.4s). */
function useSplashDismiss() {
  useEffect(() => {
    const el = document.getElementById('splash');
    if (!el || el.dataset.closing) return;
    el.dataset.closing = '1';
    const started = Number(el.dataset.start ?? '0');
    const elapsed = started > 0 ? Date.now() - started : 0;
    window.setTimeout(() => {
      el.classList.add('done');
      window.setTimeout(() => el.remove(), 450);
    }, Math.max(0, 2800 - elapsed));
    // No cleanup: the splash must be dismissed exactly once, even under
    // StrictMode's mount → unmount → remount cycle.
  }, []);
}

export default function App() {
  const session = useStore(sessionStore);
  useThemeSync();
  useSplashDismiss();

  // Expired editor drafts (unsaved case/page work) are swept once per load.
  useEffect(() => pruneDrafts(), []);

  // Once connected: load settings, then start the refresh scheduler.
  useEffect(() => {
    if (session.phase !== 'connected') return;
    loadSettings()
      .then(() => initScheduler())
      .catch((err) => {
        initScheduler();
        pushToast({ title: 'Settings failed to load', body: err instanceof Error ? err.message : String(err) });
      });
  }, [session.phase]);

  if (session.phase === 'loading') {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <div className="muted" style={{ fontSize: 13 }}>
          Connecting…
        </div>
      </div>
    );
  }

  if (session.phase === 'disconnected') {
    return (
      <>
        <LoginPage />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <DialogHost>
        <ConnectedShell />
      </DialogHost>
      <ToastHost />
    </>
  );
}
