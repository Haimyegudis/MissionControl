// Data — cache housekeeping. Clearing the Jira issue cache lives here; the
// TestRail disk cache has its own button inside its Connections block.

import { useState } from 'react';
import { settings as settingsApi } from '../../api/client';
import { errText } from '../../lib/errors';
import { ConfirmDialog, type ConfirmSpec } from '../testrail/common';
import { ConnNote, Field, Section } from './common';

export function DataSection() {
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [health, setHealth] = useState<Array<{ name: string; ok: boolean; latencyMs: number | null; message: string }>>([]);

  const clearCache = () =>
    setConfirm({
      title: 'Clear issue cache',
      message: 'Remove all cached issue data? Views refetch on next load.',
      confirmLabel: 'Clear cache',
      danger: false,
      onConfirm: async () => {
        setStatus('');
        try {
          await settingsApi.clearIssueCache();
          setStatus('✓ Cache cleared.');
        } catch (err) {
          setStatus(`✕ ${errText(err)}`);
        }
      },
    });

  const clearAllCaches = () =>
    setConfirm({
      title: 'Clear all cached work data',
      message: 'Remove Jira issue/metadata caches and the TestRail disk cache? Saved settings and connections are kept.',
      confirmLabel: 'Clear all caches',
      danger: false,
      onConfirm: async () => {
        await settingsApi.clearCaches();
        setStatus('✓ All server caches cleared.');
      },
    });

  const clearBrowserData = () =>
    setConfirm({
      title: 'Clear browser data',
      message: 'Remove autosaved drafts, grid layouts, recent UI state, TestRail coverage snapshots and browser-local preferences? Your selected theme is kept.',
      confirmLabel: 'Clear browser data',
      danger: true,
      onConfirm: async () => {
        const theme = localStorage.getItem('jiraweb.theme');
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('mc.') || key.startsWith('deck.') || key.startsWith('jiraweb.')) localStorage.removeItem(key);
        }
        if (theme) localStorage.setItem('jiraweb.theme', theme);
        setStatus('✓ Browser-local data cleared. Reload the app to reset every view.');
      },
    });

  const disconnectAll = () =>
    setConfirm({
      title: 'Disconnect every service',
      message: 'Remove saved Jira, TestRail and Confluence credentials and disconnect all three sessions? Cached work data is not removed.',
      confirmLabel: 'Disconnect all',
      danger: true,
      onConfirm: async () => {
        await settingsApi.disconnectAll();
        setStatus('✓ All service credentials removed.');
      },
    });

  const runDiagnostics = async () => {
    setStatus('Checking Jira, TestRail and Confluence…');
    try {
      const result = await settingsApi.connectionHealth();
      setHealth(result.services);
      setStatus(`✓ Connection check completed at ${new Date(result.checkedAt).toLocaleTimeString()}.`);
    } catch (error) {
      setStatus(`✕ ${errText(error)}`);
    }
  };

  return (
    <Section id="set-data" label="Data">
      <Field label="Issue cache" hint="Drops cached Jira issue data; views refetch on next load.">
        <div className="conn-actions">
          <button className="btn" onClick={clearCache}>
            Clear cache
          </button>
          <button className="btn" onClick={clearAllCaches}>Clear all caches</button>
        </div>
      </Field>
      <Field label="Browser-local data" hint="Drafts expire after 14 days; layouts, filters and coverage snapshots persist until cleared.">
        <button className="btn" onClick={clearBrowserData}>Clear browser data</button>
      </Field>
      <Field label="Connections" hint="Credentials are encrypted for your Windows account using DPAPI.">
        <div className="conn-actions">
          <button className="btn" onClick={() => void runDiagnostics()}>Run diagnostics</button>
          <button className="btn" onClick={disconnectAll}>Disconnect all services</button>
        </div>
        {health.map((service) => <div key={service.name} className="muted" style={{ marginTop: 5 }}><span style={{ color: service.ok ? 'var(--accent-green)' : 'var(--accent-red)' }}>{service.ok ? '●' : '●'}</span> {service.name}: {service.message}{service.latencyMs === null ? '' : ` · ${service.latencyMs} ms`}</div>)}
      </Field>
      <ConnNote text={status} />
      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </Section>
  );
}
