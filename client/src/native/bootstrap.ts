// Android bootstrap. Order matters: storage must be hydrated before the core
// reads settings, and the dispatcher must be installed before React mounts, or
// the first view's API call goes to fetch and fails.

import {
  createCore,
  createDispatcher,
  setCookieProvider,
  type Core,
  type CredentialsPort,
  type Dispatch,
  type KvStore,
  type PeopleStore,
} from '@mc/core';
import { setNativeDispatch } from '../api/client';
import { cookiesFor } from './ssoSession';
import { LOCK_TIMEOUT_MS, requireUnlock } from './biometric';
import { handleBack } from '../mobile/backHandler';
import { KeystoreCredentials } from './credentials';
import { HydratedKvStore, PreferencesPeopleStore } from './kvStore';
import { persistenceFor } from './persistence';

type Hydratable<T> = T & { hydrate(): Promise<void> };

export interface RuntimeDeps {
  kv: Hydratable<KvStore> & { flush?(): Promise<void> };
  people: Hydratable<PeopleStore> & { flush?(): Promise<void> };
  credentials: Hydratable<CredentialsPort> & { flush?(): Promise<void> };
  installDispatch: (dispatch: Dispatch) => void;
}

export interface NativeRuntime {
  core: Core;
  /** Re-establish the TestRail session from stored credentials. */
  reconnectTestRail(): Promise<void>;
  /** Wait until destructive storage changes have reached disk/Keystore. */
  flushStorage(): Promise<void>;
}

/** Testable seam: no plugin imports, no globals, no side effects on module load. */
export async function buildNativeRuntime(deps: RuntimeDeps): Promise<NativeRuntime> {
  await deps.kv.hydrate();
  await deps.people.hydrate();
  await deps.credentials.hydrate();

  // Cookie-authenticated requests need the jar spelled out as a header; the
  // native layer will not attach it on its own.
  setCookieProvider(cookiesFor);

  const core = createCore({ kv: deps.kv, people: deps.people, credentials: deps.credentials });
  deps.installDispatch(createDispatcher(core));

  const saved = deps.credentials.load();
  // An SSO profile stores no token on purpose, so a token is not what proves a
  // session exists. Testing for one here meant every reload after an HP OneUID
  // sign-in landed back on the login screen with the sign-in silently discarded.
  const hasCredential =
    saved !== null &&
    saved.jiraBaseUrl.trim().length > 0 &&
    (saved.authMode === 'sso' || saved.jiraPat.trim().length > 0);
  if (saved && hasCredential) {
    // Activate immediately so the UI is usable, then resolve who we are.
    //
    // The user is not cosmetic: TimeLoggedService attributes a worklog by
    // comparing its author against session.currentUser, so booting with null
    // silently zeroed every time total — Time Spent showed no logged work and
    // the dashboard read 0m today. A failure here still leaves the app usable;
    // the first 401 drops back to login through session-lost.
    core.session.activate(saved, null);
    try {
      core.session.activate(saved, await core.issues.getCurrentUser());
    } catch {
      // Offline or unauthorised: keep the optimistic session.
    }
  }

  return {
    core,
    async reconnectTestRail() {
      const creds = deps.credentials.load();
      // Under SSO the session cookie stands in for the key, so an empty key is
      // no longer a reason to skip the reconnect.
      const sso = creds?.authMode === 'sso';
      if (!creds || (!sso && creds.testRailApiKey.trim().length === 0)) return;
      try {
        await core.testrail.connect({
          baseUrl: creds.testRailBaseUrl,
          email: creds.testRailEmail,
          apiKey: creds.testRailApiKey,
          cookieAuth: sso,
        });
      } catch {
        // A failed TestRail reconnect must not block the Jira side of the app.
      }
    },
    async flushStorage() {
      await deps.kv.flush?.();
      await deps.people.flush?.();
      await deps.credentials.flush?.();
    },
  };
}

let runtime: NativeRuntime | null = null;

export function nativeRuntime(): NativeRuntime | null {
  return runtime;
}

/** Unlock, build the runtime, and reconnect TestRail in the background. */
export async function bootstrapNative(): Promise<{ unlocked: boolean }> {
  if (!(await requireUnlock('Unlock MissionControl'))) return { unlocked: false };

  runtime = await buildNativeRuntime({
    kv: new HydratedKvStore(persistenceFor),
    people: new PreferencesPeopleStore(),
    credentials: new KeystoreCredentials(),
    installDispatch: setNativeDispatch,
  });
  void runtime.reconnectTestRail();
  return { unlocked: true };
}

/**
 * Hardware back button, plus a re-lock when the app has been backgrounded for
 * longer than LOCK_TIMEOUT_MS. Reloading is what forces the gate again: it
 * discards the in-memory secrets along with the page.
 */
export function installAppListeners(): void {
  void import('@capacitor/app').then(({ App }) => {
    let backgroundedAt: number | null = null;

    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundedAt = Date.now();
        return;
      }
      if (backgroundedAt !== null && Date.now() - backgroundedAt > LOCK_TIMEOUT_MS) {
        window.location.reload();
      }
      backgroundedAt = null;
    });

    // The shell navigates with React state, so the screen stack is the only
    // authority on what "back" means. There is deliberately no window.history
    // fallback: a WebView reports history.length > 1 from the initial load
    // onwards, so consulting it walked hash entries silently and the app could
    // never be closed no matter how many times back was pressed.
    void App.addListener('backButton', () => {
      if (handleBack()) return;
      void App.exitApp();
    });
  });
}
