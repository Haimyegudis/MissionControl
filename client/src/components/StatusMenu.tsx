// Change-status submenu (ui-parity §12.4).
// Lazy 'Loading...' → one item per transition `"{Name}  →  {ToStatus}"`;
// empty → '(no transitions available)'; error → 'Error: {msg}'.
// Click: screen probe → TransitionDialog when the screen has fields OR the
// NeedsDialog name/status heuristics hit → onNeedsDialog(transition, screen);
// otherwise perform the bare transition, refetch the single issue live and
// call onPatched(issue). Failure → alert 'Transition failed'.

import { useEffect, useState } from 'react';
import { issues as issuesApi } from '../api/client';
import { errText } from '../lib/errors';
import { pushToast } from '../stores/toasts';
import type { JiraIssue, JiraTransition, JiraTransitionField } from '../types';
import type { MenuEntry } from './ContextMenu';

const NAME_HINTS = ['fix', 'close', 'resolve', 'done', 'cancel', 'reject', 'reopen', 'reassign', 'assign'];
const TARGET_HINTS = ['closed', 'done', 'resolved', 'cancel', 'reject', 'reopen'];

/** NeedsDialog heuristic (ui-parity §12.4), independent of screen fields. */
export function needsTransitionDialog(transition: JiraTransition): boolean {
  const name = (transition.name ?? '').toLowerCase();
  const target = (transition.toStatus ?? '').toLowerCase();
  return NAME_HINTS.some((h) => name.includes(h)) || TARGET_HINTS.some((h) => target.includes(h));
}

export interface StatusMenuHandlers {
  /** The transition needs a TransitionDialog (fields present or heuristics hit). */
  onNeedsDialog: (transition: JiraTransition, screen: JiraTransitionField[]) => void;
  /** Bare transition succeeded; `issue` is the freshly refetched live issue. */
  onPatched: (issue: JiraIssue) => void;
}

/** Menu-item label per §12.4: `"{Name}  →  {ToStatus}"` (two-space arrow). */
export function transitionLabel(t: JiraTransition): string {
  return `${t.name}  →  ${t.toStatus ?? ''}`;
}

async function chooseTransition(issueKey: string, transition: JiraTransition, handlers: StatusMenuHandlers): Promise<void> {
  try {
    const screen = await issuesApi.transitionScreen(issueKey, transition.id);
    if (screen.length > 0 || needsTransitionDialog(transition)) {
      handlers.onNeedsDialog(transition, screen);
      return;
    }
    await issuesApi.performTransition(issueKey, { id: transition.id });
    const details = await issuesApi.details(issueKey);
    handlers.onPatched(details.issue);
  } catch (err) {
    pushToast({ title: 'Transition failed', body: errText(err), severity: 'error' });
  }
}

function entriesFor(issueKey: string, transitions: JiraTransition[], handlers: StatusMenuHandlers): MenuEntry[] {
  if (transitions.length === 0) return [{ label: '(no transitions available)', disabled: true }];
  return transitions.map((t) => ({
    label: transitionLabel(t),
    onClick: () => {
      void chooseTransition(issueKey, t, handlers);
    },
  }));
}

/**
 * Lazy submenu loader for ContextMenu: `{ label: 'Change status', submenu:
 * statusSubmenu(key, handlers) }`. The ContextMenu shows 'Loading...' while
 * the promise is pending.
 */
export function statusSubmenu(issueKey: string, handlers: StatusMenuHandlers): () => Promise<MenuEntry[]> {
  return async () => {
    try {
      const transitions = await issuesApi.transitions(issueKey);
      return entriesFor(issueKey, transitions, handlers);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [{ label: `Error: ${msg}`, disabled: true }];
    }
  };
}

export interface StatusMenuProps extends StatusMenuHandlers {
  issueKey: string;
  /** Called after any click is handled (close the hosting popup). */
  onDone?: () => void;
}

/** Inline variant: renders the submenu content as a list (for embedding). */
export function StatusMenu({ issueKey, onNeedsDialog, onPatched, onDone }: StatusMenuProps) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; transitions: JiraTransition[] }>({
    loading: true,
    error: null,
    transitions: [],
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, transitions: [] });
    issuesApi.transitions(issueKey).then(
      (transitions) => {
        if (!cancelled) setState({ loading: false, error: null, transitions });
      },
      (err) => {
        if (!cancelled) {
          setState({ loading: false, error: err instanceof Error ? err.message : String(err), transitions: [] });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issueKey]);

  const itemStyle: React.CSSProperties = { padding: '6px 12px', fontSize: 12.5, whiteSpace: 'nowrap' };

  if (state.loading) {
    return (
      <div className="muted" style={itemStyle}>
        Loading...
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="muted" style={itemStyle}>
        {`Error: ${state.error}`}
      </div>
    );
  }
  if (state.transitions.length === 0) {
    return (
      <div className="muted" style={itemStyle}>
        (no transitions available)
      </div>
    );
  }
  return (
    <div>
      {state.transitions.map((t) => (
        <div
          key={t.id}
          style={{ ...itemStyle, cursor: 'pointer' }}
          onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-panel-high)')}
          onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          onClick={() => {
            onDone?.();
            void chooseTransition(issueKey, t, { onNeedsDialog, onPatched });
          }}
        >
          {transitionLabel(t)}
        </div>
      ))}
    </div>
  );
}
