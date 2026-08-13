// App root — session gate (loading → LoginPage or Shell) + routed views.
// Real views land in Task B4; placeholders keep every route reachable.

import { useEffect } from 'react';
import { Shell } from './components/Shell';
import { ToastHost } from './components/Toast';
import { DialogHost, useDialogs } from './dialogs/DialogHost';
import { activePageName, routeStore } from './router';
import { initScheduler } from './stores/scheduler';
import { sessionStore } from './stores/session';
import { loadSettings, resolveTheme, settingsStore } from './stores/settings';
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

/** Keep <html data-theme> in sync with settings (theme applies live). */
function useThemeSync() {
  const settings = useStore(settingsStore);
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(settings.theme);
  }, [settings.theme]);
}

export default function App() {
  const session = useStore(sessionStore);
  useThemeSync();

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
