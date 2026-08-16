// Error boundary — a render-time throw in one view no longer blanks the
// whole app. Shows the error with a reload action, keeps the shell alive.

import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card" style={{ maxWidth: 560, margin: '48px auto', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Something broke in this view</div>
          <div className="muted" style={{ marginTop: 8, fontSize: 12.5, overflowWrap: 'anywhere' }}>
            {this.state.error.message}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
