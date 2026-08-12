import type { Credentials } from '../config/credentialsStore.js';
import type { JiraUser } from '../types.js';

export type SessionChangedListener = () => void;

/**
 * Process-lifetime Jira session (jira-rest-layer.md §1).
 * isConnected = profile present with a non-empty PAT. Services early-return
 * empty results when disconnected; write ops throw "No active Jira session."
 */
export class JiraSession {
  profile: Credentials | null = null;
  currentUser: JiraUser | null = null;

  private readonly listeners = new Set<SessionChangedListener>();

  get isConnected(): boolean {
    return this.profile !== null && this.profile.jiraPat.trim().length > 0;
  }

  activate(credentials: Credentials, user: JiraUser | null): void {
    this.profile = credentials;
    this.currentUser = user;
    this.emit();
  }

  clear(): void {
    this.profile = null;
    this.currentUser = null;
    this.emit();
  }

  /** Subscribe to session changes; returns an unsubscribe function. */
  onChanged(cb: SessionChangedListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // listener failures must not break session state changes
      }
    }
  }
}
