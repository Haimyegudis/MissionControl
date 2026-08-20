import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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
async function startNative(): Promise<boolean> {
  const { bootstrapNative, installAppListeners } = await import('./native/bootstrap');
  const { unlocked } = await bootstrapNative();
  if (!unlocked) {
    document.body.textContent = 'Locked. Reopen MissionControl to unlock.';
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
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
