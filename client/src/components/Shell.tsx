// App shell (ui-parity §0.2): top bar + 220px sidebar + content host.

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { pinnedBoards as pinnedBoardsApi, settings as settingsApi } from '../api/client';
import { formatClock, formatElapsed, trimRecentSummary } from '../lib/format';
import { activePageName, navigate, ROUTES, TESTRAIL_ROUTES, routeStore, type RouteId } from '../router';
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
      window.alert(`Logged ${Math.floor(elapsed / 60)}m on ${key}`);
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
        <button style={iconBtn} title="Pick issue for Pomodoro" onClick={onPickIssue}>
          ▶
        </button>
      )}
      {state.phase === 'running' && (
        <button style={iconBtn} title="Pause" onClick={pausePomodoro}>
          ⏸
        </button>
      )}
      {state.phase === 'paused' && (
        <button style={iconBtn} title="Resume" onClick={resumePomodoro}>
          ▶
        </button>
      )}
      {state.phase !== 'idle' && (
        <button style={iconBtn} title="Stop (logs work when ≥ 1 minute)" onClick={handleStop}>
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
  const [pinned, setPinned] = useState<PinnedBoard[]>([]);

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

  // Pinned boards.
  useEffect(() => {
    let cancelled = false;
    pinnedBoardsApi
      .list()
      .then((boards) => {
        if (!cancelled) setPinned(boards);
      })
      .catch(() => {
        /* server route may not be up yet; sidebar just omits the group */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unpin = async (board: PinnedBoard) => {
    try {
      await pinnedBoardsApi.remove(board.id);
      setPinned((prev) => prev.filter((b) => b.id !== board.id));
    } catch (err) {
      pushToast({ title: 'Unpin failed', body: err instanceof Error ? err.message : String(err) });
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

  const toggleTheme = () => {
    const next = appSettings.theme === 'Light' ? 'Dark' : 'Light';
    updateSettings({ theme: next }).catch(() => {
      /* optimistic local flip already applied */
    });
  };

  const recent = (appSettings.recentIssues ?? []).slice(0, 3);
  const isDark = appSettings.theme !== 'Light';
  const isRailbook = resolveTheme(appSettings.theme) === 'railbook';

  const toggleRailbook = () => {
    const next = isRailbook ? 'Dark' : 'railbook';
    updateSettings({ theme: next }).catch(() => {
      /* optimistic local flip already applied */
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ------------------------------------------------------- top bar --- */}
      <header style={topBarStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--accent-cyan)' }}>JIRA</span>
          <span style={{ color: 'var(--text-primary)' }}> WEB</span>
        </div>
        <div style={{ marginLeft: 24, color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
          {activePageName(route)}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
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

        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          Last refresh: {formatClock(lastRefresh)}
        </div>

        <button className="btn btn-primary" onClick={() => onCreateIncident?.()}>
          + Create Incident
        </button>

        <PomodoroWidget onPickIssue={() => openPalette('pomodoro')} />

        <button className="btn btn-icon" title="Command palette (Ctrl+K)" onClick={() => openPalette()}>
          🔍
        </button>

        <button className="btn btn-icon" title="Toggle theme" onClick={toggleTheme}>
          {isDark ? '🌙' : '☀️'}
        </button>

        <button
          className="btn btn-icon"
          title={isRailbook ? 'Switch to Nightdeck (dark)' : 'Switch to Railbook'}
          onClick={toggleRailbook}
        >
          {isRailbook ? '☾' : '☀'}
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

        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {session.user?.displayName ?? ''}
        </div>
      </header>

      {/* ---------------------------------------------------- body -------- */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <nav style={sidebarStyle}>
          <GroupLabel>JIRA</GroupLabel>
          {ROUTES.filter((r) => r.id !== 'settings').map((r) => (
            <NavItem key={r.id} route={r} active={route === r.id} />
          ))}

          <GroupLabel>TESTRAIL</GroupLabel>
          {TESTRAIL_ROUTES.map((r) => (
            <NavItem
              key={r.id}
              route={r}
              active={route === r.id || (r.id === 'testrail-runs' && route === 'testrail-run')}
            />
          ))}

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
                    onClick={() => navigate('mywork')}
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

          {recent.length > 0 && (
            <>
              <GroupLabel>Recent</GroupLabel>
              {recent.map((r) => (
                <div
                  key={r.key}
                  title={`${r.key} — ${r.summary}`}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{r.key}</span>
                  <span style={{ color: 'var(--muted)' }}> {trimRecentSummary(r.key, r.summary)}</span>
                </div>
              ))}
            </>
          )}
        </nav>

        <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 16 }}>{children}</main>
      </div>
    </div>
  );
}
