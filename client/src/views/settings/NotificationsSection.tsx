// Notifications — the in-app notification flags. Saved by the shell's
// single bottom action bar (partial PUT).

import { Field, Section } from './common';

export interface NotificationsProps {
  inAppNotifications: boolean;
  onInAppNotifications: (value: boolean) => void;
  criticalOnly: boolean;
  onCriticalOnly: (value: boolean) => void;
  muteAll: boolean;
  onMuteAll: (value: boolean) => void;
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
    </Section>
  );
}
