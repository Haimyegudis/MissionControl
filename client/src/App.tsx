// App root — session gate (loading → LoginPage or Shell) + routed views.
// Real views land in Task B4; placeholders keep every route reachable.

import { lazy, Suspense, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Shell } from './components/Shell';
import { pruneDrafts } from './lib/drafts';
import { ToastHost } from './components/Toast';
import { DialogHost, useDialogs } from './dialogs/DialogHost';
import { isRouteAvailable, navigate, routeStore } from './router';
import { useSplashDismiss, useThemeSync } from './lib/appChrome';
import { isNativeApp } from './native/platform';
import { initScheduler } from './stores/scheduler';
import { initWatchFeed } from './stores/watch';
import { sessionStore } from './stores/session';
import { loadSettings } from './stores/settings';
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
const ConfluenceView = __MC_TARGET__ === 'android' ? Unavailable : lazy(() => import('./views/confluence/ConfluenceView').then((m) => ({ default: m.ConfluenceView })));
const TraceabilityView = lazy(() => import('./views/TraceabilityView').then((m) => ({ default: m.TraceabilityView })));
/**
 * Stand-in for a view that is not part of the Android build. Reaching it means
 * a route slipped past the gate below, so say so rather than rendering blank.
 */
function Unavailable() {
  return (
    <div className="muted" style={{ padding: 48, textAlign: 'center', fontSize: 13 }}>
      This screen is not available in the mobile app.
    </div>
  );
}

const viewFallback = (
  <div className="muted" style={{ padding: 48, textAlign: 'center', fontSize: 13 }}>
    Loading…
  </div>
);

function ActiveView() {
  const route = useStore(routeStore);

  // A deep link or stale hash can name a route this build does not carry;
  // send it to the Backlog rather than rendering against a 404ing dispatcher.
  useEffect(() => {
    if (!isRouteAvailable(route, isNativeApp())) navigate('mywork');
  }, [route]);

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
      case 'traceability':
        return <TraceabilityView />;
      case 'dashboard':
      default:
        // The Android build has no Dashboard; the Backlog is its home screen.
        return __MC_TARGET__ === 'android' ? <MyWorkView /> : <DashboardView />;
    }
  })();
  return (
    <ErrorBoundary>
      <Suspense fallback={viewFallback}>{view}</Suspense>
    </ErrorBoundary>
  );
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
      .then(() => {
        initScheduler();
        initWatchFeed();
      })
      .catch((err) => {
        initScheduler();
        initWatchFeed();
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
