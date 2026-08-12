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
}

export const sessionStore = createStore<SessionState>({
  phase: 'loading',
  user: null,
  profile: null,
});

function apply(status: AuthStatus): void {
  sessionStore.set({
    phase: status.connected ? 'connected' : 'disconnected',
    user: status.user,
    profile: status.profile,
  });
}

/** Fetch GET /api/auth/status and populate the store. Call once on boot. */
export async function initSession(): Promise<void> {
  try {
    apply(await auth.status());
  } catch {
    sessionStore.set({ phase: 'disconnected', user: null, profile: null });
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
    sessionStore.set({ phase: 'disconnected', user: null, profile: null });
  }
}

onSessionLost(() => {
  if (sessionStore.get().phase === 'connected') {
    sessionStore.set({ phase: 'disconnected', user: null, profile: null });
  }
});
