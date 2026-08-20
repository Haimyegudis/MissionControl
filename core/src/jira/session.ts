import type { Credentials, JiraUser } from '../types.js';

export type SessionChangedListener = () => void;

/**
 * Process-lifetime Jira session (jira-rest-layer.md §1).
 * isConnected = profile present with a non-empty PAT. Services early-return
 * empty results when disconnected; write ops throw "No active Jira session."
 */
export class JiraSession {
  profile: Credentials | null = null;
  currentUser: JiraUser | null = null;
  /**
   * Set once a cookie-authenticated call comes back unauthorised, so later
   * requests go straight to the stored token instead of paying for a doomed
   * attempt on every call. Reset by a fresh sign-in via activate().
   */
  cookieExpired = false;

  private readonly listeners = new Set<SessionChangedListener>();

  get isConnected(): boolean {
    if (this.profile === null) return false;
    // Under SSO the session cookie is the credential, so a stored token is
    // optional rather than proof of a connection.
    if (this.profile.authMode === 'sso') return true;
    return this.profile.jiraPat.trim().length > 0;
  }

  activate(credentials: Credentials, user: JiraUser | null): void {
    this.profile = credentials;
    this.currentUser = user;
    this.cookieExpired = false;
    this.emit();
  }

  clear(): void {
    this.profile = null;
    this.currentUser = null;
    this.cookieExpired = false;
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
