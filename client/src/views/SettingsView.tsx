// Settings page (ui-parity-contract.md §14) — redesigned shell: left sticky
// mini-nav (anchor buttons) + a single content column of flat sections
// (Connections / Preferences / Notifications / Dashboard / AI Assistant /
// Reminders / Data), separated by hairlines — no cards. Connections is THE
// one place for all identity/secrets (Jira, TestRail, Confluence, Copilot).
// Save semantics unchanged: the sticky bottom bar sends ONLY the fields this
// page owns via partial PUT (server merges load-then-mutate), then the
// scheduler restarts on the new interval. Section UIs live in ./settings/*.

import { useEffect, useState } from 'react';
import { syncFromSettings } from '../stores/scheduler';
import { loadSettings, resolveTheme, updateSettings } from '../stores/settings';
import { buildWidgetToggles, enabledWidgetIds, type WidgetToggle } from '../lib/viewWidgets';
import { AiSection } from './settings/AiSection';
import { ConnectionsSection } from './settings/ConnectionsSection';
import { DashboardSection } from './settings/DashboardSection';
import { DataSection } from './settings/DataSection';
import { NotificationsSection } from './settings/NotificationsSection';
import { PreferencesSection } from './settings/PreferencesSection';
import { RemindersSection } from './settings/RemindersSection';

const NAV: Array<[id: string, label: string]> = [
  ['set-connections', 'Connections'],
  ['set-preferences', 'Preferences'],
  ['set-notifications', 'Notifications'],
  ['set-dashboard', 'Dashboard'],
  ['set-ai', 'AI Assistant'],
  ['set-reminders', 'Alerts'],
  ['set-data', 'Data'],
];

export function SettingsView() {
  const [loaded, setLoaded] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(30);
  const [pauseWhenMinimized, setPauseWhenMinimized] = useState(true);
  const [theme, setTheme] = useState('Dark');
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [muteAll, setMuteAll] = useState(false);
  const [defaultProjectKey, setDefaultProjectKey] = useState('ISW');
  const [aiModel, setAiModel] = useState('');
  const [widgets, setWidgets] = useState<WidgetToggle[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((s) => {
      setAutoRefreshEnabled(s.autoRefreshEnabled);
      setRefreshIntervalSeconds(s.refreshIntervalSeconds);
      setPauseWhenMinimized(s.pauseWhenMinimized);
      setTheme(s.theme);
      setInAppNotifications(s.inAppNotifications);
      setCriticalOnly(s.criticalOnly);
      setMuteAll(s.muteAll);
      setDefaultProjectKey(s.defaultProjectKey);
      setAiModel(s.aiModel ?? '');
      setWidgets(buildWidgetToggles(s.dashboardWidgets));
      setLoaded(true);
    });
  }, []);

  const applyThemeLive = (value: string) => {
    setTheme(value);
    // Applies immediately (App also re-syncs from the settings store on save).
    document.documentElement.dataset.theme = resolveTheme(value);
  };

  const save = async () => {
    setError(null);
    setStatusMessage('');
    try {
      // §14 save semantics: partial PUT — server load-then-mutates so fields
      // not owned by this page (recent issues, saved queries, incident
      // filters, starred, WIP limits) survive. `incidentDashboardUrl` and
      // `aiEndpoint` are managed URLs with no UI — never sent, so their
      // persisted values also survive.
      await updateSettings({
        autoRefreshEnabled,
        refreshIntervalSeconds,
        pauseWhenMinimized,
        theme,
        inAppNotifications,
        criticalOnly,
        muteAll,
        defaultProjectKey,
        aiModel,
        dashboardWidgets: enabledWidgetIds(widgets),
      });
      syncFromSettings(); // restart scheduler on the new interval
      setStatusMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const jumpTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="set-page">
      <div className="set-body">
        <nav className="set-nav" aria-label="Settings sections">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => jumpTo(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="set-col">
          <header className="set-head">
            <h2>Settings</h2>
            <p>All connections, tokens and preferences in one place.</p>
            {!loaded ? <p className="muted">Loading...</p> : null}
          </header>

          <ConnectionsSection />
          <PreferencesSection
            theme={theme}
            onTheme={applyThemeLive}
            autoRefreshEnabled={autoRefreshEnabled}
            onAutoRefreshEnabled={setAutoRefreshEnabled}
            refreshIntervalSeconds={refreshIntervalSeconds}
            onRefreshIntervalSeconds={setRefreshIntervalSeconds}
            pauseWhenMinimized={pauseWhenMinimized}
            onPauseWhenMinimized={setPauseWhenMinimized}
            defaultProjectKey={defaultProjectKey}
            onDefaultProjectKey={setDefaultProjectKey}
          />
          <NotificationsSection
            inAppNotifications={inAppNotifications}
            onInAppNotifications={setInAppNotifications}
            criticalOnly={criticalOnly}
            onCriticalOnly={setCriticalOnly}
            muteAll={muteAll}
            onMuteAll={setMuteAll}
          />
          <DashboardSection widgets={widgets} onWidgets={setWidgets} />
          <AiSection aiModel={aiModel} onAiModel={setAiModel} />
          <RemindersSection />
          <DataSection />
        </div>
      </div>

      <div className="set-actionbar">
        {statusMessage ? <span style={{ color: 'var(--accent-green)' }}>{statusMessage}</span> : null}
        {error ? <span style={{ color: 'var(--accent-red)' }}>{error}</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => void save()} disabled={!loaded}>
          Save
        </button>
      </div>
    </div>
  );
}
