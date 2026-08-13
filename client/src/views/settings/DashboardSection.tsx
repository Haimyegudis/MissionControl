// Dashboard — the dashboard widget toggles/reorder list (lib/viewWidgets
// helpers). Saved by the shell's bottom action bar.
// Note: `incidentDashboardUrl` is intentionally NOT surfaced here — it is a
// managed URL; the persisted value stays untouched server-side (the shell's
// partial PUT simply never sends it).

import { moveWidget, toggleWidget, type WidgetToggle } from '../../lib/viewWidgets';
import { Field, Section } from './common';

export interface DashboardProps {
  widgets: WidgetToggle[];
  onWidgets: (update: (prev: WidgetToggle[]) => WidgetToggle[]) => void;
}

export function DashboardSection(p: DashboardProps) {
  return (
    <Section id="set-dashboard" label="Dashboard">
      <Field label="Dashboard widgets" hint="Toggle and reorder the Dashboard page widgets.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {p.widgets.map((w, i) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={w.enabled} onChange={() => p.onWidgets((prev) => toggleWidget(prev, i))} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{w.id}</span>
              <button
                className="btn btn-icon"
                title="Move up"
                disabled={i === 0}
                onClick={() => p.onWidgets((prev) => moveWidget(prev, i, -1))}
              >
                ▲
              </button>
              <button
                className="btn btn-icon"
                title="Move down"
                disabled={i === p.widgets.length - 1}
                onClick={() => p.onWidgets((prev) => moveWidget(prev, i, 1))}
              >
                ▼
              </button>
            </div>
          ))}
        </div>
      </Field>
    </Section>
  );
}
