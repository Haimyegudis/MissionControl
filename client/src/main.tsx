import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { MobileApp } from './mobile/MobileApp';
import { initRouter } from './router';
import { initSession } from './stores/session';
import { isNativeApp } from './native/platform';
import './theme.css';

/**
 * The launcher puts the owner-only API token in the URL fragment. Fragments
 * never reach HTTP servers or logs. Exchange it once for an HttpOnly cookie,
 * then scrub it from browser history before mounting the application.
 */
function takeBootstrapToken(): string | null {
  const hash = window.location.hash;
  const question = hash.indexOf('?');
  if (question < 0) return null;
  const route = hash.slice(0, question);
  const params = new URLSearchParams(hash.slice(question + 1));
  const token = params.get('mc_token');
  if (!token) return null;
  params.delete('mc_token');
  const cleanHash = route + (params.size > 0 ? `?${params}` : '');
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${cleanHash}`);
  return token;
}

async function bootstrap(): Promise<void> {
  const token = takeBootstrapToken();
  // In Vite development the proxy injects the token for this endpoint.
  const headers = token ? { 'x-mc-token': token } : undefined;
  await fetch('/api/bootstrap', { method: 'POST', headers }).catch(() => undefined);
}

/**
 * Android has no server to bootstrap against: build the core in-process behind
 * the biometric gate instead. Imported lazily so the desktop bundle never
 * pulls the native modules in.
 */
/**
 * Locked screen with a retry. The prompt can be cancelled by something outside
 * the user's control — another app stealing focus is enough — so dead-ending
 * here would force a force-stop to get back in.
 */
function showLocked(): void {
  document.body.innerHTML =
    '<div id="mc-locked" style="height:100%;display:grid;place-items:center;padding:24px;text-align:center;gap:16px">' +
    '<div><div style="font-size:15px;font-weight:600;margin-bottom:6px">MissionControl is locked</div>' +
    '<div style="opacity:.7;font-size:13px">Unlock to reach your Jira and TestRail credentials.</div></div>' +
    '<button id="mc-unlock" class="btn btn-primary" style="padding:10px 20px">Unlock</button></div>';
  document.getElementById('mc-unlock')?.addEventListener('click', () => window.location.reload());
}

async function startNative(): Promise<boolean> {
  // Touch styling and the flight-deck theme live here, loaded only in the
  // native shell so the desktop bundle never sees them.
  // Stamped before the first paint, because useIsNarrow reads it during
  // render — setting it in an effect would render one desktop frame first.
  document.documentElement.dataset.mobile = '1';
  await import('./mobile/mobile.css');
  const { bootstrapNative, installAppListeners } = await import('./native/bootstrap');
  const { unlocked } = await bootstrapNative();
  if (!unlocked) {
    showLocked();
    return false;
  }
  installAppListeners();
  return true;
}

async function start(): Promise<void> {
  if (isNativeApp()) {
    if (!(await startNative())) return;
  } else {
    await bootstrap();
  }
  initRouter();
  void initSession();
  // The phone gets a purpose-built shell, not the desktop workspace in a
  // narrow window. Both share the stores, the typed API and the dispatcher.
  const Root = isNativeApp() ? MobileApp : App;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

void start();
