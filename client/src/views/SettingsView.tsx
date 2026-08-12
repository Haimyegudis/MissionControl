// Settings page (ui-parity-contract.md §14). Cards: AI Assistant (endpoint,
// model, reorderable dashboard-widget list), Account (Connected as, Update
// PAT via /api/auth/login with the saved profile + new token, Log out),
// Appearance (theme applies live), Refresh, Notifications, HP Indigo.
// Sticky action bar: green StatusMessage + Clear cache + Save. Save sends
// ONLY the fields this page owns (server merges load-then-mutate), then the
// scheduler restarts on the new interval.

import { useEffect, useState } from 'react';
import { settings as settingsApi } from '../api/client';
import { ALLOWED_INTERVALS_SECONDS, syncFromSettings } from '../stores/scheduler';
import { login, logout, sessionStore } from '../stores/session';
import { loadSettings, updateSettings } from '../stores/settings';
import { useStore } from '../stores/useStore';
import {
  buildWidgetToggles,
  enabledWidgetIds,
  moveWidget,
  toggleWidget,
  type WidgetToggle,
} from '../lib/viewWidgets';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700 }}>{title}</h3>
      {children}
    </div>
  );
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };

export function SettingsView() {
  const session = useStore(sessionStore);

  const [loaded, setLoaded] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(30);
  const [pauseWhenMinimized, setPauseWhenMinimized] = useState(true);
  const [theme, setTheme] = useState('Dark');
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [muteAll, setMuteAll] = useState(false);
  const [incidentDashboardUrl, setIncidentDashboardUrl] = useState('');
  const [defaultProjectKey, setDefaultProjectKey] = useState('ISW');
  const [aiEndpoint, setAiEndpoint] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [widgets, setWidgets] = useState<WidgetToggle[]>([]);
  const [newToken, setNewToken] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => {
      setAutoRefreshEnabled(s.autoRefreshEnabled);
      setRefreshIntervalSeconds(s.refreshIntervalSeconds);
      setPauseWhenMinimized(s.pauseWhenMinimized);
      setTheme(s.theme);
      setInAppNotifications(s.inAppNotifications);
      setCriticalOnly(s.criticalOnly);
      setMuteAll(s.muteAll);
      setIncidentDashboardUrl(s.incidentDashboardUrl ?? '');
      setDefaultProjectKey(s.defaultProjectKey);
      setAiEndpoint(s.aiEndpoint ?? '');
      setAiModel(s.aiModel ?? '');
      setWidgets(buildWidgetToggles(s.dashboardWidgets));
      setLoaded(true);
    });
  }, []);

  const applyThemeLive = (value: string) => {
    setTheme(value);
    // Applies immediately (App also re-syncs from the settings store on save).
    document.documentElement.dataset.theme = value === 'Light' ? 'light' : 'dark';
  };

  const save = async () => {
    setError(null);
    setStatusMessage('');
    try {
      // §14 save semantics: partial PUT — server load-then-mutates so fields
      // not owned by this page (recent issues, saved queries, incident
      // filters, starred, WIP limits) survive.
      await updateSettings({
        autoRefreshEnabled,
        refreshIntervalSeconds,
        pauseWhenMinimized,
        theme,
        inAppNotifications,
        criticalOnly,
        muteAll,
        incidentDashboardUrl,
        defaultProjectKey,
        aiEndpoint,
        aiModel,
        dashboardWidgets: enabledWidgetIds(widgets),
      });
      syncFromSettings(); // restart scheduler on the new interval
      setStatusMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const clearCache = async () => {
    if (!window.confirm('Remove all cached issue data?')) return;
    setError(null);
    try {
      await settingsApi.clearIssueCache();
      setStatusMessage('Cache cleared.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateToken = async () => {
    setStatusMessage('');
    setError(null);
    if (!newToken.trim()) {
      setError('Enter a token first.');
      return;
    }
    const profile = sessionStore.get().profile;
    if (!profile) {
      setError('No active profile — log in first.');
      return;
    }
    setBusy(true);
    try {
      // Validates the token against /myself server-side, persists it and
      // re-activates the session (POST /api/auth/login with saved profile).
      await login({
        baseUrl: profile.jiraBaseUrl,
        email: profile.email,
        pat: newToken,
        instanceType: profile.instanceType,
      });
      setNewToken('');
      setStatusMessage('Token updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    if (!window.confirm('Disconnect from Jira and clear the stored token?')) return;
    await logout();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, paddingBottom: 0 }}>
      <h2 style={{ fontSize: 18 }}>Settings</h2>
      {!loaded ? <div className="muted">Loading...</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Card title="AI Assistant">
          <label>
            Endpoint
            <input value={aiEndpoint} onChange={(e) => setAiEndpoint(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          </label>
          <label>
            Model
            <input value={aiModel} onChange={(e) => setAiModel(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          </label>
          <div>
            <label>Dashboard widgets</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
              {widgets.map((w, i) => (
                <div key={w.id} style={{ ...row, gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={() => setWidgets((prev) => toggleWidget(prev, i))}
                  />
                  <span style={{ flex: 1, fontSize: 12.5 }}>{w.id}</span>
                  <button
                    className="btn btn-icon"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => setWidgets((prev) => moveWidget(prev, i, -1))}
                  >
                    ▲
                  </button>
                  <button
                    className="btn btn-icon"
                    title="Move down"
                    disabled={i === widgets.length - 1}
                    onClick={() => setWidgets((prev) => moveWidget(prev, i, 1))}
                  >
                    ▼
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Account">
          <div>
            Connected as: <b>{session.user?.displayName ?? '—'}</b>
          </div>
          <div style={row}>
            <input
              type="password"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="New personal access token"
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={() => void updateToken()} disabled={busy}>
              Update PAT
            </button>
          </div>
          <div>
            <button className="btn" onClick={() => void doLogout()}>
              Log out
            </button>
          </div>
        </Card>

        <Card title="Appearance">
          <div style={row}>
            <label style={{ width: 60 }}>Theme</label>
            <select value={theme} onChange={(e) => applyThemeLive(e.target.value)}>
              <option value="Dark">Dark</option>
              <option value="Light">Light</option>
            </select>
          </div>
        </Card>

        <Card title="Refresh">
          <label style={row}>
            <input type="checkbox" checked={autoRefreshEnabled} onChange={(e) => setAutoRefreshEnabled(e.target.checked)} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12.5 }}>Auto-refresh enabled</span>
          </label>
          <div style={row}>
            <label style={{ width: 100 }}>Interval</label>
            <select
              value={refreshIntervalSeconds}
              onChange={(e) => setRefreshIntervalSeconds(Number(e.target.value))}
            >
              {ALLOWED_INTERVALS_SECONDS.map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </div>
          <label style={row}>
            <input type="checkbox" checked={pauseWhenMinimized} onChange={(e) => setPauseWhenMinimized(e.target.checked)} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12.5 }}>Pause when minimized</span>
          </label>
        </Card>

        <Card title="Notifications">
          <label style={row}>
            <input type="checkbox" checked={inAppNotifications} onChange={(e) => setInAppNotifications(e.target.checked)} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12.5 }}>In-app notifications</span>
          </label>
          <label style={row}>
            <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12.5 }}>Critical only</span>
          </label>
          <label style={row}>
            <input type="checkbox" checked={muteAll} onChange={(e) => setMuteAll(e.target.checked)} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12.5 }}>Mute all</span>
          </label>
        </Card>

        <Card title="HP Indigo">
          <label>
            Default project key
            <input
              value={defaultProjectKey}
              onChange={(e) => setDefaultProjectKey(e.target.value)}
              style={{ width: 140, marginTop: 4, display: 'block' }}
            />
          </label>
          <label>
            Incident dashboard URL
            <input
              value={incidentDashboardUrl}
              onChange={(e) => setIncidentDashboardUrl(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        </Card>
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          margin: '0 -16px',
          background: 'var(--bg-panel-high)',
          borderTop: '1px solid var(--border-strong)',
        }}
      >
        {statusMessage ? <span style={{ color: 'var(--accent-green)' }}>{statusMessage}</span> : null}
        {error ? <span style={{ color: 'var(--accent-red)' }}>{error}</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => void clearCache()}>
          Clear cache
        </button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!loaded}>
          Save
        </button>
      </div>
    </div>
  );
}
