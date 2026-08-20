// App shell (ui-parity §0.2): top bar + 220px sidebar + content host.

import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { settings as settingsApi } from '../api/client';
import { Modal } from './Modal';

// Lazy — keeps the JQL editor + results grid out of the entry chunk.
const FiltersView = lazy(() => import('../views/FiltersView').then((m) => ({ default: m.FiltersView })));
import { formatClock, formatElapsed } from '../lib/format';
import { boardHash } from '../lib/viewMyWorkJql';
import { CONFLUENCE_ROUTES, navigate, ROUTES, TESTRAIL_ROUTES, routeStore, type RouteId } from '../router';
import { pinBoard, pinnedBoardsStore, refreshPinnedBoards, unpinBoard } from '../stores/pinnedBoards';
import { errText } from '../lib/errors';
import { NotificationBell } from './NotificationBell';
import { pausePomodoro, pomodoroStore, resumePomodoro, statusText, stopPomodoro } from '../stores/pomodoro';
import { lastRefreshStore, triggerNow } from '../stores/scheduler';
import { sessionStore } from '../stores/session';
import { resolveTheme, settingsStore, updateSettings } from '../stores/settings';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { PinnedBoard } from '../types';

export interface ShellProps {
  children: ReactNode;
  /** "+ Create Incident" (create-issue dialog arrives in Task B3). */
  onCreateIncident?: () => void;
  /** Open command palette; mode 'pomodoro' = "Pick issue for Pomodoro". */
  onOpenPalette?: (mode?: 'default' | 'pomodoro') => void;
}

const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 16px',
  height: 52,
  borderBottom: '1px solid var(--border-soft)',
  background: 'var(--bg-panel)',
  backdropFilter: 'blur(14px)',
  flexShrink: 0,
};

const sidebarStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  borderRight: '1px solid var(--border-soft)',
  background: 'var(--bg-panel)',
  backdropFilter: 'blur(14px)',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  padding: '10px 8px',
  gap: 2,
};

function NavItem({ route, active }: { route: { id: RouteId; label: string }; active: boolean }) {
  return (
    <button
      onClick={() => navigate(route.id)}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        borderRadius: 8,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--accent-cyan)' : 'var(--text-primary)',
        background: active ? 'var(--bg-panel-high)' : 'transparent',
      }}
    >
      {route.label}
    </button>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '10px 12px 4px',
        fontSize: 10.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

/** Collapsible sidebar group; open state persists per group id. */
function NavGroup({
  id,
  label,
  emphasized,
  children,
}: {
  id: string;
  label: string;
  emphasized?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(`mc.grp.${id}`) !== '0');
  const toggle = () =>
    setOpen((prev) => {
      localStorage.setItem(`mc.grp.${id}`, prev ? '0' : '1');
      return !prev;
    });
  return (
    <>
      <button
        onClick={toggle}
        title={open ? 'Collapse group' : 'Expand group'}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '10px 12px 4px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: emphasized ? 12.5 : 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: emphasized ? 'var(--accent-cyan)' : 'var(--muted)',
          fontWeight: emphasized ? 800 : 600,
        }}
      >
        <span aria-hidden style={{ fontSize: 9, width: 11, display: 'inline-block' }}>
          {open ? '▾' : '▸'}
        </span>
        {label}
      </button>
      {open && children}
    </>
  );
}

function PomodoroWidget({ onPickIssue }: { onPickIssue: () => void }) {
  const state = useStore(pomodoroStore);
  const iconBtn: CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    fontSize: 12,
    padding: '2px 4px',
    lineHeight: 1,
  };
  const handleStop = async () => {
    const key = state.issueKey;
    const elapsed = await stopPomodoro();
    if (elapsed >= 60 && key) {
      pushToast({ title: 'Pomodoro', body: `Logged ${Math.floor(elapsed / 60)}m on ${key}`, severity: 'success' });
    }
  };
  return (
    <div
      title="Pomodoro"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 8,
        border: '1px solid var(--border-soft)',
        fontSize: 11.5,
        color: 'var(--muted)',
      }}
    >
      <span>{statusText(state)}</span>
      {state.phase !== 'idle' && (
        <span style={{ color: 'var(--accent-cyan)', fontVariantNumeric: 'tabular-nums' }}>
          {formatElapsed(state.elapsedSeconds)}
        </span>
      )}
      {state.phase === 'idle' && (
        <button style={iconBtn} title="Pick issue for Pomodoro" aria-label="Pick issue for Pomodoro" onClick={onPickIssue}>
          ▶
        </button>
      )}
      {state.phase === 'running' && (
        <button style={iconBtn} title="Pause" aria-label="Pause Pomodoro" onClick={pausePomodoro}>
          ⏸
        </button>
      )}
      {state.phase === 'paused' && (
        <button style={iconBtn} title="Resume" aria-label="Resume Pomodoro" onClick={resumePomodoro}>
          ▶
        </button>
      )}
      {state.phase !== 'idle' && (
        <button style={iconBtn} title="Stop (logs work when ≥ 1 minute)" aria-label="Stop Pomodoro" onClick={handleStop}>
          ■
        </button>
      )}
    </div>
  );
}

export function Shell({ children, onCreateIncident, onOpenPalette }: ShellProps) {
  const route = useStore(routeStore);
  const session = useStore(sessionStore);
  const appSettings = useStore(settingsStore);
  const lastRefresh = useStore(lastRefreshStore);
  const [refreshRunning, setRefreshRunning] = useState(false);
  const pinned = useStore(pinnedBoardsStore);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('mc.sidebar') !== '0');
  const [jqlOpen, setJqlOpen] = useState(false);

  const toggleSidebar = () =>
    setSidebarOpen((prev) => {
      localStorage.setItem('mc.sidebar', prev ? '0' : '1');
      return !prev;
    });

  const openPalette = useCallback(
    (mode: 'default' | 'pomodoro' = 'default') => onOpenPalette?.(mode),
    [onOpenPalette],
  );

  // Ctrl+K / Ctrl+L → palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openPalette]);

  // Load pins on connection. Pin/unpin updates the shared store immediately,
  // so the sidebar never needs to remount to reflect a change.
  useEffect(() => {
    if (session.phase !== 'connected') return;
    void refreshPinnedBoards()
      .catch(() => {
        /* server route may not be up yet; sidebar just omits the group */
      });
  }, [session.phase]);

  const unpin = async (board: PinnedBoard) => {
    try {
      await unpinBoard(board.id);
      pushToast({
        title: 'Board unpinned',
        body: board.name,
        severity: 'info',
        action: {
          label: 'Undo',
          onClick: () => {
            void pinBoard({ boardId: board.boardId, name: board.name, filterId: board.filterId ?? null }).catch(
              (err) => pushToast({ title: 'Re-pin failed', body: errText(err), severity: 'error' }),
            );
          },
        },
      });
    } catch (err) {
      pushToast({ title: 'Unpin failed', body: errText(err), severity: 'error' });
    }
  };

  // Hard refresh (§0.1 RefreshNowAsync): server clears caches, then TriggerNow.
  const refreshNow = async () => {
    if (refreshRunning) return;
    setRefreshRunning(true);
    try {
      await settingsApi.hardRefresh();
    } catch (err) {
      pushToast({ title: 'Refresh failed', body: err instanceof Error ? err.message : String(err) });
    } finally {
      triggerNow();
      setRefreshRunning(false);
    }
  };

  const resolvedTheme = resolveTheme(appSettings.theme);

  // Single button cycles Dark → Light → Railbook → Dark.
  const THEME_CYCLE: Record<string, { next: string; icon: string; label: string }> = {
    dark: { next: 'Light', icon: '🌙', label: 'Nightdeck — click for Light' },
    light: { next: 'railbook', icon: '☀️', label: 'Light — click for Railbook' },
    railbook: { next: 'Dark', icon: '📖', label: 'Railbook — click for Nightdeck' },
  };
  const themeInfo = THEME_CYCLE[resolvedTheme] ?? THEME_CYCLE.dark;
  const cycleTheme = () => {
    updateSettings({ theme: themeInfo.next }).catch(() => {
      /* optimistic local flip already applied */
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ------------------------------------------------------- top bar --- */}
      <header className="mc-topbar" style={topBarStyle}>
        <button
          className="btn btn-icon"
          title={sidebarOpen ? 'Hide menu' : 'Show menu'}
          aria-label={sidebarOpen ? 'Hide menu' : 'Show menu'}
          onClick={toggleSidebar}
        >
          ☰
        </button>
        <div className="mc-brand"
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-display)',
          }}
        >
          <span style={{ color: 'var(--accent-cyan)' }}>MISSION</span>
          <span style={{ color: 'var(--text-primary)' }}> CONTROL</span>
        </div>
        <div style={{ flex: 1 }} />

        <div className="mc-live" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent-green)',
              boxShadow: '0 0 6px var(--accent-green)',
              display: 'inline-block',
            }}
          />
          <span>Live</span>
        </div>

        <div className="mc-refresh-stamp" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          Last refresh: {formatClock(lastRefresh)}
        </div>

        <button className="btn btn-primary" onClick={() => onCreateIncident?.()}>
          + Create Incident
        </button>

        <PomodoroWidget onPickIssue={() => openPalette('pomodoro')} />

        <button className="btn btn-icon" title="Command palette (Ctrl+K)" aria-label="Open command palette" onClick={() => openPalette()}>
          🔍
        </button>

        <button
          className="btn btn-icon"
          title="JQL search — saved filters + free JQL, results from anywhere"
          aria-label="Open JQL search"
          onClick={() => setJqlOpen(true)}
        >
          ⚡
        </button>

        <NotificationBell />

        <button
          className="btn btn-icon"
          title="Help — all features and how to use them (F1)"
          aria-label="Open help"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }))}
        >
          ?
        </button>

        <button className="btn btn-icon" title={themeInfo.label} aria-label={themeInfo.label} onClick={cycleTheme}>
          {themeInfo.icon}
        </button>

        <button
          className="btn"
          onClick={refreshNow}
          disabled={refreshRunning}
          title="Hard refresh — clears caches and reloads"
          style={refreshRunning ? { color: 'var(--accent-cyan)' } : undefined}
        >
          {refreshRunning ? '…' : 'Refresh'}
        </button>

        <div className="mc-user" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {session.user?.displayName ?? ''}
        </div>
      </header>

      {/* ---------------------------------------------------- body -------- */}
      <div className="mc-body" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {sidebarOpen && (
        <nav className="mc-sidebar" style={sidebarStyle} aria-label="Primary navigation">
          <NavGroup id="jira" label="JIRA" emphasized>
            {ROUTES.filter((r) => r.id !== 'settings').map((r) => (
              <NavItem key={r.id} route={r} active={route === r.id} />
            ))}
          </NavGroup>

          <NavGroup id="testrail" label="TESTRAIL" emphasized>
            {TESTRAIL_ROUTES.map((r) => (
              <NavItem
                key={r.id}
                route={r}
                active={route === r.id || (r.id === 'testrail-runs' && route === 'testrail-run')}
              />
            ))}
          </NavGroup>

          <NavGroup id="confluence" label="CONFLUENCE" emphasized>
            {CONFLUENCE_ROUTES.map((r) => <NavItem key={r.id} route={r} active={route === r.id} />)}
          </NavGroup>

          <div style={{ height: 1, background: 'var(--border-soft)', margin: '10px 8px' }} />

          <NavItem route={{ id: 'settings', label: 'Settings' }} active={route === 'settings'} />

          {pinned.length > 0 && (
            <>
              <GroupLabel>Pinned Boards</GroupLabel>
              {pinned.map((b) => (
                <div
                  key={b.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 12px' }}
                >
                  <button
                    onClick={() => {
                      window.location.hash = boardHash(b.boardId, b.filterId, b.name);
                    }}
                    title={b.name}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                      fontSize: 12.5,
                      padding: '4px 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.name}
                  </button>
                  <button
                    onClick={() => unpin(b)}
                    title="Unpin board"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--muted)',
                      fontSize: 11,
                      padding: 2,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </>
          )}

        </nav>
        )}

        <main className="mc-main" style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 16 }}>{children}</main>
      </div>

      {jqlOpen && (
        <Modal title="JQL search & saved filters" width={1150} maxHeight="90vh" onClose={() => setJqlOpen(false)}>
          <Suspense fallback={<div className="muted">Loading…</div>}>
            <FiltersView />
          </Suspense>
        </Modal>
      )}
    </div>
  );
}
