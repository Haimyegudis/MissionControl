// App root — session gate (loading → LoginPage or Shell) + routed views.
// Real views land in Task B4; placeholders keep every route reachable.

import { useEffect } from 'react';
import { Shell } from './components/Shell';
import { ToastHost } from './components/Toast';
import { DialogHost, useDialogs } from './dialogs/DialogHost';
import { activePageName, routeStore } from './router';
import { initScheduler } from './stores/scheduler';
import { sessionStore } from './stores/session';
import { isSettingsLoaded, loadSettings, resolveTheme, settingsStore } from './stores/settings';
import { pushToast } from './stores/toasts';
import { useStore } from './stores/useStore';
import { LoginPage } from './views/LoginPage';
import { DashboardView } from './views/DashboardView';
import { MyWorkView } from './views/MyWorkView';
import { IncidentsView } from './views/IncidentsView';
import { BoardsView } from './views/BoardsView';
import { FiltersView } from './views/FiltersView';
import { RecentUpdatesView } from './views/RecentUpdatesView';
import { TimeLoggedView } from './views/TimeLoggedView';
import { DashboardsView } from './views/DashboardsView';
import { TeamView } from './views/TeamView';
import { SettingsView } from './views/SettingsView';
import { CaseLibraryView } from './views/testrail/CaseLibraryView';
import { RunsView } from './views/testrail/RunsView';
import { RunDetailView } from './views/testrail/RunDetailView';
import { TestRailReportsView } from './views/testrail/TestRailReportsView';
import { ConfluenceView } from './views/confluence/ConfluenceView';

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '48px auto', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
      <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
        This view is coming soon — the {title} page is built in a later task.
      </div>
    </div>
  );
}

function ActiveView() {
  const route = useStore(routeStore);
  switch (route) {
    case 'dashboard':
      return <DashboardView />;
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
    default:
      return <ComingSoon title={activePageName(route)} />;
  }
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

/** Dismiss the boot splash (client/index.html) once React has painted. Fast
 *  loads (<150ms — the splash's appear delay) remove it before it ever shows;
 *  otherwise the ~1.8s radar animation completes, then fades out (.4s). */
function useSplashDismiss() {
  useEffect(() => {
    const el = document.getElementById('splash');
    if (!el || el.dataset.closing) return;
    el.dataset.closing = '1';
    const started = Number(el.dataset.start ?? '0');
    const elapsed = started > 0 ? Date.now() - started : Number.POSITIVE_INFINITY;
    if (elapsed < 150) {
      el.remove();
      return;
    }
    window.setTimeout(() => {
      el.classList.add('done');
      window.setTimeout(() => el.remove(), 450);
    }, Math.max(0, 1800 - elapsed));
    // No cleanup: the splash must be dismissed exactly once, even under
    // StrictMode's mount → unmount → remount cycle.
  }, []);
}

export default function App() {
  const session = useStore(sessionStore);
  useThemeSync();
  useSplashDismiss();

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
