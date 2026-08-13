// Transition dialog (ui-parity §10.5) — dynamic fields from the transition
// screen. Title = transition name; subtitle "{key}  →  {toStatus}"; OK label =
// transition name.

import { useMemo, useState } from 'react';
import { issues as issuesApi } from '../api/client';
import { Modal } from '../components/Modal';
import type { JiraTransition, JiraTransitionField } from '../types';

export interface TransitionDialogProps {
  issueKey: string;
  transition: JiraTransition;
  fields: JiraTransitionField[];
  onClose: () => void;
  /** Called after the transition POST succeeds (dialog closes itself). */
  onDone?: () => void;
}

/** Name heuristics that force a red required `*` even without the Jira flag. */
const REQUIRED_NAME_HINTS = [
  'verified in build',
  'approved build',
  'time spent',
  'reopened reason',
  'on hold reason',
  'resolution',
  'rejected reason',
  'reject reason',
  'cancel reason',
];

export function isHeuristicallyRequired(field: JiraTransitionField): boolean {
  if (field.required) return true;
  const name = (field.name ?? '').toLowerCase();
  return REQUIRED_NAME_HINTS.some((h) => name.includes(h));
}

type ControlKind = 'select' | 'date' | 'user' | 'timetracking' | 'text';

function controlKind(field: JiraTransitionField): ControlKind {
  const type = (field.schemaType ?? '').toLowerCase();
  const item = (field.itemType ?? '').toLowerCase();
  if (field.allowedValues.length > 0 || ['option', 'resolution', 'priority'].includes(type)) return 'select';
  if (type === 'date' || type === 'datetime') return 'date';
  if (type === 'user' || item === 'user') return 'user';
  if (type === 'timetracking') return 'timetracking';
  return 'text';
}

/** Resolution preselect: Fixed → Done → Resolved → first. */
export function preselectResolution(allowedValues: string[]): string {
  for (const wanted of ['Fixed', 'Done', 'Resolved']) {
    const hit = allowedValues.find((v) => v.toLowerCase() === wanted.toLowerCase());
    if (hit) return hit;
  }
  return allowedValues[0] ?? '';
}

/**
 * Initial dialog value for one screen field. Prefers the issue's current
 * value (so e.g. Task Type stays as-is on close); falls back to the
 * resolution preselect for resolutions and today for dates.
 */
export function initialFieldValue(field: JiraTransitionField): string {
  if (field.id === 'worklog' || field.id === 'assignee') return '';
  const current = (field.currentValue ?? '').trim();
  const kind = controlKind(field);
  if (kind === 'select') {
    if (current && field.allowedValues.includes(current)) return current;
    return (field.schemaType ?? '').toLowerCase() === 'resolution' ? preselectResolution(field.allowedValues) : '';
  }
  if (kind === 'date') {
    const m = current.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : todayIso();
  }
  if (kind === 'timetracking') return '';
  return current;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tzOffsetString(d: Date = new Date()): string {
  const min = -d.getTimezoneOffset();
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Shape a raw input value per §10.5 for one screen field. */
export function shapeFieldValue(field: JiraTransitionField, raw: string): unknown {
  const type = (field.schemaType ?? '').toLowerCase();
  const item = (field.itemType ?? '').toLowerCase();
  // Cascading selects ("Parent Option object") reject {name}; they need {value}.
  if (type === 'option-with-child') return { value: raw };
  if (type === 'option') return { value: raw };
  if (type === 'array' && item === 'option') return [{ value: raw }];
  const named = ['resolution', 'priority', 'user'];
  if (named.includes(type) || named.includes(item)) return { name: raw };
  if (type === 'date') return raw; // yyyy-MM-dd from the date input
  if (type === 'datetime') return `${raw}T00:00:00.000${tzOffsetString()}`;
  if (type === 'number') return Number(raw);
  if (type === 'timetracking') return { originalEstimate: raw, remainingEstimate: raw };
  return raw;
}

export function TransitionDialog({ issueKey, transition, fields, onClose, onDone }: TransitionDialogProps) {
  // Special ids: comment → bottom box; worklog → "Time Spent"; assignee → assignee.
  const formFields = useMemo(() => fields.filter((f) => f.id !== 'comment'), [fields]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of formFields) initial[f.id] = initialFieldValue(f);
    return initial;
  });
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setValue = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const submit = async () => {
    // Client-side required check.
    const missing = formFields
      .filter((f) => (f.id === 'worklog' ? true : isHeuristicallyRequired(f)))
      .filter((f) => !(values[f.id] ?? '').trim())
      .map((f) => (f.id === 'worklog' ? 'Time Spent' : f.name));
    if (missing.length > 0) {
      setError(`Required: ${missing.join(', ')}`);
      return;
    }

    const shaped: Record<string, unknown> = {};
    let assignee: string | undefined;
    let timeSpent: string | undefined;
    for (const f of formFields) {
      const raw = (values[f.id] ?? '').trim();
      if (!raw) continue;
      if (f.id === 'worklog') {
        timeSpent = raw;
        continue;
      }
      if (f.id === 'assignee') {
        assignee = raw;
        continue;
      }
      shaped[f.id] = shapeFieldValue(f, raw);
    }

    setBusy(true);
    setError(null);
    try {
      await issuesApi.performTransition(issueKey, {
        id: transition.id,
        fields: Object.keys(shaped).length > 0 ? shaped : undefined,
        comment: comment.trim() ? comment : undefined,
        assignee,
        timeSpent,
      });
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const renderControl = (f: JiraTransitionField) => {
    if (f.id === 'worklog') {
      return (
        <input
          value={values[f.id] ?? ''}
          onChange={(e) => setValue(f.id, e.target.value)}
          placeholder="e.g. 1h 30m"
          title="Time format e.g. 3w 4d 12h"
          style={{ width: '100%' }}
        />
      );
    }
    if (f.id === 'assignee') {
      return (
        <input
          value={values[f.id] ?? ''}
          onChange={(e) => setValue(f.id, e.target.value)}
          title="Jira username or email"
          style={{ width: '100%' }}
        />
      );
    }
    switch (controlKind(f)) {
      case 'select':
        return (
          <select value={values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value)} style={{ width: '100%' }}>
            <option value="" />
            {f.allowedValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      case 'date':
        return (
          <input
            type="date"
            value={values[f.id] ?? ''}
            onChange={(e) => setValue(f.id, e.target.value)}
            style={{ width: '100%' }}
          />
        );
      case 'user':
        return (
          <input
            value={values[f.id] ?? ''}
            onChange={(e) => setValue(f.id, e.target.value)}
            title="Jira username or email"
            style={{ width: '100%' }}
          />
        );
      case 'timetracking':
        return (
          <input
            value={values[f.id] ?? ''}
            onChange={(e) => setValue(f.id, e.target.value)}
            placeholder="Time format e.g. 3w 4d 12h"
            title="Time format e.g. 3w 4d 12h"
            style={{ width: '100%' }}
          />
        );
      default:
        return (
          <input
            value={values[f.id] ?? ''}
            onChange={(e) => setValue(f.id, e.target.value)}
            style={{ width: '100%' }}
          />
        );
    }
  };

  return (
    <Modal
      width={640}
      maxHeight={640}
      onClose={onClose}
      title={
        <div style={{ minWidth: 0 }}>
          <div>{transition.name}</div>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>
            {`${issueKey}  →  ${transition.toStatus ?? ''}`}
          </div>
        </div>
      }
      footer={
        <>
          {error && (
            <div style={{ flex: 1, alignSelf: 'center', color: 'var(--accent-red)', fontSize: 12 }}>{error}</div>
          )}
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {transition.name}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {formFields.map((f) => (
          <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label>
              {f.id === 'worklog' ? 'Time Spent' : f.name}
              {(f.id === 'worklog' || isHeuristicallyRequired(f)) && (
                <span style={{ color: 'var(--accent-red)' }}> *</span>
              )}
            </label>
            {renderControl(f)}
          </div>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>Comment</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ height: 80, resize: 'vertical', width: '100%' }}
          />
        </div>
      </div>
    </Modal>
  );
}
