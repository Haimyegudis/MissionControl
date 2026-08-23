// Session store — auth status, login/logout. Drops to 'disconnected' whenever
// the API layer sees a 401 (session-lost event).

import { auth, onSessionLost } from '../api/client';
import type { AuthStatus, JiraUser, LoginRequest } from '../types';
import { createStore } from './store';

export type SessionPhase = 'loading' | 'connected' | 'disconnected';

export interface SessionState {
  phase: SessionPhase;
  user: JiraUser | null;
  profile: AuthStatus['profile'];
  /** Who was signed in last, secrets excluded; survives a lost session. */
  saved: AuthStatus['saved'];
}

export const sessionStore = createStore<SessionState>({
  phase: 'loading',
  user: null,
  profile: null,
  saved: null,
});

function apply(status: AuthStatus): void {
  sessionStore.set({
    phase: status.connected ? 'connected' : 'disconnected',
    user: status.user,
    profile: status.profile,
    saved: status.saved ?? null,
  });
}

/** Losing a session must not lose the identity the login form prefills from. */
function disconnect(keepSaved = true): void {
  sessionStore.set({
    phase: 'disconnected',
    user: null,
    profile: null,
    saved: keepSaved ? sessionStore.get().saved : null,
  });
}

/** Fetch GET /api/auth/status and populate the store. Call once on boot. */
export async function initSession(): Promise<void> {
  try {
    apply(await auth.status());
  } catch {
    disconnect(false);
  }
}

export async function login(req: LoginRequest): Promise<void> {
  const status = await auth.login(req);
  apply(status);
}

export async function logout(): Promise<void> {
  try {
    await auth.logout();
  } finally {
    // Signing out clears the token but not who you are: the form stays filled.
    disconnect();
  }
}

onSessionLost(() => {
  if (sessionStore.get().phase === 'connected') disconnect();
});
