// Alerts & reminders — Windows scheduled-task toasts that fire even when the
// app is closed. Four alert kinds, each user-configurable:
//   • Log-work reminder (weekly days + time)
//   • In Progress summary alert (weekly days + time, live task list in toast)
//   • To Do → In Progress nudge (weekly days + time)
//   • Specific-task alerts (issue key + one-time date & time + optional note)
// Own GET/PUT /api/reminders round-trip with its own Save; intentionally
// outside the settings partial-PUT.

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

interface AlertRule {
  enabled: boolean;
  days: string[];
  time: string;
}

interface TaskAlert {
  key: string;
  date: string;
  time: string;
  note?: string;
}

const DEFAULT_RULE: AlertRule = { enabled: false, days: ['SUN', 'MON', 'TUE', 'WED', 'THU'], time: '16:30' };

function sanitizeRule(raw: unknown, fallback: AlertRule): AlertRule {
  const r = (raw ?? {}) as Partial<AlertRule>;
  return {
    enabled: r.enabled === true,
    days: Array.isArray(r.days) && r.days.length > 0 ? r.days.map(String) : fallback.days,
    time: typeof r.time === 'string' && r.time ? r.time : fallback.time,
  };
}

/** Days + time chips row shared by every weekly alert rule. */
function RuleEditor({ rule, onChange }: { rule: AlertRule; onChange: (rule: AlertRule) => void }) {
  const toggleDay = (d: string) =>
    onChange({
      ...rule,
      days: rule.days.includes(d) ? rule.days.filter((x) => x !== d) : [...rule.days, d],
    });
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      {REMINDER_DAYS.map(([value, label]) => (
        <button
          key={value}
          className="btn"
          disabled={!rule.enabled}
          onClick={() => toggleDay(value)}
          style={
            rule.days.includes(value) && rule.enabled
              ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }
              : undefined
          }
        >
          {label}
        </button>
      ))}
      <input
        type="time"
        value={rule.time}
        disabled={!rule.enabled}
        onChange={(e) => onChange({ ...rule, time: e.target.value })}
        style={{ width: 110 }}
      />
    </div>
  );
}

export function RemindersSection() {
  const [logWork, setLogWork] = useState<AlertRule>({ ...DEFAULT_RULE });
  const [inProgress, setInProgress] = useState<AlertRule>({ ...DEFAULT_RULE, time: '10:00' });
  const [todo, setTodo] = useState<AlertRule>({ ...DEFAULT_RULE, time: '09:30' });
  const [taskAlerts, setTaskAlerts] = useState<TaskAlert[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('09:00');
  const [newNote, setNewNote] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/reminders')
      .then((r) => r.json())
      .then((c) => {
        // Back-compat: a legacy flat config maps to the log-work rule.
        if (c?.logWork || c?.inProgress) {
          setLogWork(sanitizeRule(c.logWork, DEFAULT_RULE));
          setInProgress(sanitizeRule(c.inProgress, { ...DEFAULT_RULE, time: '10:00' }));
          setTodo(sanitizeRule(c.todo, { ...DEFAULT_RULE, time: '09:30' }));
          if (Array.isArray(c.taskAlerts)) setTaskAlerts(c.taskAlerts);
        } else if (typeof c?.enabled === 'boolean') {
          setLogWork(sanitizeRule(c, DEFAULT_RULE));
        }
      })
      .catch(() => {});
  }, []);

  const addTaskAlert = () => {
    const key = newKey.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
      setStatus('✕ Issue key must look like ISW-1234');
      return;
    }
    if (!newDate) {
      setStatus('✕ Pick a date for the task alert');
      return;
    }
    setTaskAlerts((prev) => [
      ...prev,
      { key, date: newDate, time: newTime || '09:00', ...(newNote.trim() ? { note: newNote.trim() } : {}) },
    ]);
    setNewKey('');
    setNewNote('');
    setStatus('');
  };

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const r = await fetch('/api/reminders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logWork, inProgress, todo, taskAlerts }),
      });
      const data = await r.json();
      if (!r.ok || data?.error) throw new Error(String(data?.error ?? `HTTP ${r.status}`));
      const active = [
        logWork.enabled ? 'log work' : null,
        inProgress.enabled ? 'in progress' : null,
        todo.enabled ? 'to do' : null,
        taskAlerts.length > 0 ? `${taskAlerts.length} task alert(s)` : null,
      ].filter(Boolean);
      setStatus(
        active.length > 0
          ? `✓ Scheduled: ${active.join(', ')} (fires even when the app is closed)`
          : '✓ All alerts disabled',
      );
    } catch (e) {
      setStatus(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="set-reminders" label="Alerts & Reminders">
      <Field
        label="Log-work reminder"
        hint="Nudge to log your work in Jira. Opens the Time Spent page."
      >
        <label className="set-check">
          <input
            type="checkbox"
            checked={logWork.enabled}
            onChange={(e) => setLogWork({ ...logWork, enabled: e.target.checked })}
          />
          Remind me to log work in Jira
        </label>
        <RuleEditor rule={logWork} onChange={setLogWork} />
      </Field>

      <Field
        label="In Progress summary"
        hint="Windows notification listing your tasks currently In Progress (live from Jira)."
      >
        <label className="set-check">
          <input
            type="checkbox"
            checked={inProgress.enabled}
            onChange={(e) => setInProgress({ ...inProgress, enabled: e.target.checked })}
          />
          Alert me about all my In Progress tasks
        </label>
        <RuleEditor rule={inProgress} onChange={setInProgress} />
      </Field>

      <Field
        label="To Do nudge"
        hint="Reminds you to move waiting tasks from To Do to In Progress. Silent when To Do is empty."
      >
        <label className="set-check">
          <input
            type="checkbox"
            checked={todo.enabled}
            onChange={(e) => setTodo({ ...todo, enabled: e.target.checked })}
          />
          Nudge me to move tasks from To Do to In Progress
        </label>
        <RuleEditor rule={todo} onChange={setTodo} />
      </Field>

      <Field
        label="Specific task alerts"
        hint="One-time Windows notification about a specific issue at a date and time you choose."
      >
        {taskAlerts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {taskAlerts.map((a, i) => (
              <div
                key={`${a.key}-${a.date}-${a.time}-${i}`}
                style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 }}
              >
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, minWidth: 90 }}>{a.key}</span>
                <span>
                  {a.date} at {a.time}
                </span>
                {a.note ? <span className="muted">— {a.note}</span> : null}
                <button
                  className="btn"
                  title="Remove this alert"
                  onClick={() => setTaskAlerts((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            No task alerts yet.
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="ISW-1234"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            style={{ width: 110 }}
          />
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ width: 140 }} />
          <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} style={{ width: 110 }} />
          <input
            placeholder="Note (optional)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            style={{ width: 200 }}
          />
          <button className="btn" onClick={addTaskAlert}>
            + Add
          </button>
        </div>
      </Field>

      <Field label=" ">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save alerts'}
          </button>
        </div>
        <ConnNote text={status} />
      </Field>
    </Section>
  );
}
