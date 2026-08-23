// Notifications — the in-app notification flags, plus the dashboard watcher.
//
// The flags above are AppSettings and ride the shell's single bottom action
// bar (partial PUT). The watcher's config is its own resource (/api/watch/
// config, sanitized in @mc/core) and saves on change, so it does not wait for
// the shell's Save and cannot be half-applied by it.

import { useEffect, useState } from 'react';
import { watch as watchApi } from '../../api/client';
import { formatDateTime } from '../../lib/format';
import { pushToast } from '../../stores/toasts';
import { refreshWatchFeed, runWatchCycleNow, syncWatchConfigToNative, watchStore } from '../../stores/watch';
import { useStore } from '../../stores/useStore';
import type { WatchConfig, WatchEventKind } from '../../types';
import { Field, Section } from './common';

export interface NotificationsProps {
  inAppNotifications: boolean;
  onInAppNotifications: (value: boolean) => void;
  criticalOnly: boolean;
  onCriticalOnly: (value: boolean) => void;
  muteAll: boolean;
  onMuteAll: (value: boolean) => void;
}

const KIND_LABELS: Array<[WatchEventKind, string]> = [
  ['assigned', 'Assigned to me'],
  ['unassigned', 'No longer mine'],
  ['status', 'Status changed'],
  ['sprint', 'Sprint changed'],
  ['priority', 'Priority changed'],
  ['dueDate', 'Due date changed'],
  ['comment', 'New comments'],
];

const INTERVALS = [5, 10, 15, 30];

function WatchControls() {
  const feed = useStore(watchStore);
  const [config, setConfig] = useState<WatchConfig | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    watchApi
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  // Every edit is a full PUT of the sanitized config, so the stored shape is
  // always complete — no partial merge to get wrong on either platform.
  const save = (next: WatchConfig): void => {
    setConfig(next);
    watchApi
      .setConfig(next)
      .then((saved) => {
        setConfig(saved);
        void syncWatchConfigToNative();
      })
      .catch((err: unknown) => {
        pushToast({
          title: 'Notification settings not saved',
          body: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const checkNow = async (): Promise<void> => {
    setChecking(true);
    try {
      const count = await runWatchCycleNow();
      pushToast({
        title: 'Dashboard checked',
        body: count === 0 ? 'Nothing has changed.' : `${count} change(s) found.`,
      });
    } catch (err) {
      pushToast({ title: 'Check failed', body: err instanceof Error ? err.message : String(err) });
      void refreshWatchFeed();
    } finally {
      setChecking(false);
    }
  };

  if (config === null) return null;

  return (
    <>
      <Field
        label="Dashboard change alerts"
        hint="Alerts while Mission Control is running. On Android, background checks run about every 15 minutes, and every 5 minutes while the app is open."
      >
        <label className="set-check">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => save({ ...config, enabled: e.target.checked })}
          />
          Enabled
        </label>
      </Field>

      <Field label="Alert me about" hint="Each kind of change can be silenced on its own.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {KIND_LABELS.map(([kind, label]) => (
            <label key={kind} className="set-check">
              <input
                type="checkbox"
                checked={config.kinds[kind]}
                disabled={!config.enabled}
                onChange={(e) => save({ ...config, kinds: { ...config.kinds, [kind]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Check every"
        hint={
          feed.lastCycle
            ? `Last checked ${formatDateTime(feed.lastCycle)}.`
            : 'Not checked yet — the first check records what you have now and stays silent.'
        }
      >
        <select
          value={config.intervalMinutes}
          disabled={!config.enabled}
          onChange={(e) => save({ ...config, intervalMinutes: Number(e.target.value) })}
        >
          {INTERVALS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => void checkNow()} disabled={checking}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </Field>
    </>
  );
}

export function NotificationsSection(p: NotificationsProps) {
  return (
    <Section id="set-notifications" label="Notifications">
      <Field label="In-app notifications" hint="Toasts for new incidents and watched changes.">
        <label className="set-check">
          <input
            type="checkbox"
            checked={p.inAppNotifications}
            onChange={(e) => p.onInAppNotifications(e.target.checked)}
          />
          Enabled
        </label>
        <label className="set-check">
          <input type="checkbox" checked={p.criticalOnly} onChange={(e) => p.onCriticalOnly(e.target.checked)} />
          Critical only
        </label>
        <label className="set-check">
          <input type="checkbox" checked={p.muteAll} onChange={(e) => p.onMuteAll(e.target.checked)} />
          Mute all
        </label>
      </Field>
      <WatchControls />
    </Section>
  );
}
