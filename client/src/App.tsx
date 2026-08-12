// App root — session gate (loading → LoginPage or Shell) + routed views.
// Real views land in Task B4; placeholders keep every route reachable.

import { useEffect } from 'react';
import { Shell } from './components/Shell';
import { ToastHost } from './components/Toast';
import { activePageName, routeStore } from './router';
import { initScheduler } from './stores/scheduler';
import { sessionStore } from './stores/session';
import { loadSettings, settingsStore } from './stores/settings';
import { pushToast } from './stores/toasts';
import { useStore } from './stores/useStore';
import { LoginPage } from './views/LoginPage';

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
  return <ComingSoon title={activePageName(route)} />;
}

/** Keep <html data-theme> in sync with settings (theme applies live). */
function useThemeSync() {
  const settings = useStore(settingsStore);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'Light' ? 'light' : 'dark';
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
      <Shell
        onCreateIncident={() => pushToast({ title: 'Create Incident', body: 'Create-issue dialog arrives in a later task.' })}
        onOpenPalette={(mode) =>
          pushToast({
            title: mode === 'pomodoro' ? 'Pick issue for Pomodoro' : 'Command palette',
            body: 'The command palette arrives in a later task.',
          })
        }
      >
        <ActiveView />
      </Shell>
      <ToastHost />
    </>
  );
}
