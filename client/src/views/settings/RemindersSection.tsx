// Reminders — log-work reminder (Windows scheduled task, fires even when the
// app is closed). Own GET/PUT /api/reminders round-trip with its own Save;
// intentionally outside the settings partial-PUT.

import { useEffect, useState } from 'react';
import { ConnNote, Field, Section } from './common';

const REMINDER_DAYS = [
  ['SUN', 'Sun'],
  ['MON', 'Mon'],
  ['TUE', 'Tue'],
  ['WED', 'Wed'],
  ['THU', 'Thu'],
  ['FRI', 'Fri'],
  ['SAT', 'Sat'],
] as const;

export function RemindersSection() {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<string[]>(['SUN', 'MON', 'TUE', 'WED', 'THU']);
  const [time, setTime] = useState('16:30');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/reminders')
      .then((r) => r.json())
      .then((c) => {
        if (typeof c?.enabled === 'boolean') setEnabled(c.enabled);
        if (Array.isArray(c?.days)) setDays(c.days);
        if (typeof c?.time === 'string') setTime(c.time);
      })
      .catch(() => {});
  }, []);

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const r = await fetch('/api/reminders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, days, time }),
      });
      const data = await r.json();
      if (!r.ok || data?.error) throw new Error(String(data?.error ?? `HTTP ${r.status}`));
      setStatus(
        enabled
          ? `✓ Scheduled — ${days.join(', ')} at ${time} (works even when the app is closed)`
          : '✓ Reminder disabled',
      );
    } catch (e) {
      setStatus(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="set-reminders" label="Reminders">
      <Field
        label="Log-work reminder"
        hint="Windows notification — fires even when Mission Control is closed."
      >
        <label className="set-check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Remind me to log work in Jira
        </label>
      </Field>
      <Field label="Days & time">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {REMINDER_DAYS.map(([value, label]) => (
            <button
              key={value}
              className="btn"
              onClick={() => toggleDay(value)}
              style={days.includes(value) ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' } : undefined}
            >
              {label}
            </button>
          ))}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 110 }} />
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save reminder'}
          </button>
        </div>
        <ConnNote text={status} />
      </Field>
    </Section>
  );
}
