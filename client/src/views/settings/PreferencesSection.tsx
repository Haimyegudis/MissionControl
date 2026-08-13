// Preferences — theme (applies live), auto-refresh cadence and the default
// project key. Values live in the SettingsView shell; saved by the single
// bottom action bar (partial PUT).

import { ALLOWED_INTERVALS_SECONDS } from '../../stores/scheduler';
import { Field, Section } from './common';

export interface PreferencesProps {
  theme: string;
  onTheme: (value: string) => void;
  autoRefreshEnabled: boolean;
  onAutoRefreshEnabled: (value: boolean) => void;
  refreshIntervalSeconds: number;
  onRefreshIntervalSeconds: (value: number) => void;
  pauseWhenMinimized: boolean;
  onPauseWhenMinimized: (value: boolean) => void;
  defaultProjectKey: string;
  onDefaultProjectKey: (value: string) => void;
}

export function PreferencesSection(p: PreferencesProps) {
  return (
    <Section id="set-preferences" label="Preferences">
      <Field label="Theme" hint="Applies immediately; Save makes it permanent.">
        <select value={p.theme} onChange={(e) => p.onTheme(e.target.value)} style={{ width: 180 }}>
          <option value="Dark">Dark</option>
          <option value="Light">Light</option>
          <option value="railbook">Railbook</option>
        </select>
      </Field>
      <Field label="Auto-refresh">
        <label className="set-check">
          <input
            type="checkbox"
            checked={p.autoRefreshEnabled}
            onChange={(e) => p.onAutoRefreshEnabled(e.target.checked)}
          />
          Refresh data automatically
        </label>
        <label className="set-check">
          <input
            type="checkbox"
            checked={p.pauseWhenMinimized}
            onChange={(e) => p.onPauseWhenMinimized(e.target.checked)}
          />
          Pause when minimized
        </label>
      </Field>
      <Field label="Refresh interval">
        <select
          value={p.refreshIntervalSeconds}
          onChange={(e) => p.onRefreshIntervalSeconds(Number(e.target.value))}
          style={{ width: 180 }}
        >
          {ALLOWED_INTERVALS_SECONDS.map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
      </Field>
      <Field label="Default project key" hint="Used by search, create dialogs and HP Indigo views.">
        <input
          value={p.defaultProjectKey}
          onChange={(e) => p.onDefaultProjectKey(e.target.value)}
          style={{ width: 180 }}
        />
      </Field>
    </Section>
  );
}
