// Log work dialog (ui-parity §10.4). Title "Log Work: {key}".
// POST /api/issues/:key/worklogs {seconds, started, comment, adjustEstimate, adjustValue}.

import { useState, type ReactNode } from 'react';
import { issues as issuesApi } from '../api/client';
import { Modal } from '../components/Modal';
import { nowLocalInput, parseJiraTime } from '../lib/timeFormat';

export type AdjustMode = 'auto' | 'leave' | 'new' | 'manual';

export interface LogWorkProps {
  issueKey: string;
  /** Seconds; null hides the "Use existing estimate" radio. */
  remainingEstimate?: number | null;
  onClose: () => void;
  onLogged?: () => void;
}

/** "{h:0.##} hours" when >= 1h, else "{m:0} minutes". */
export function formatExistingEstimate(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.round((seconds / 3600) * 100) / 100;
    return `${hours} hours`;
  }
  return `${Math.round(seconds / 60)} minutes`;
}

export function LogWork({ issueKey, remainingEstimate = null, onClose, onLogged }: LogWorkProps) {
  const [timeSpent, setTimeSpent] = useState('');
  const [started, setStarted] = useState(nowLocalInput());
  const [mode, setMode] = useState<AdjustMode>('auto');
  const [setToValue, setSetToValue] = useState('');
  const [reduceByValue, setReduceByValue] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasExisting = remainingEstimate !== null && remainingEstimate !== undefined && remainingEstimate > 0;

  const submit = async () => {
    const seconds = parseJiraTime(timeSpent);
    if (seconds === null || seconds <= 0) {
      setError("Time Spent must be like '1h 30m', '45m', '2h'.");
      return;
    }
    if (mode === 'new' && !setToValue.trim()) {
      setError('Enter a value for the new remaining estimate.');
      return;
    }
    if (mode === 'manual' && !reduceByValue.trim()) {
      setError('Enter a value to reduce the remaining estimate by.');
      return;
    }

    const adjustValue = mode === 'new' ? setToValue.trim() : mode === 'manual' ? reduceByValue.trim() : undefined;

    setBusy(true);
    setError(null);
    try {
      await issuesApi.addWorklog(issueKey, {
        seconds: Math.round(seconds),
        started: new Date(started).toISOString(),
        comment: description.trim() ? description : undefined,
        adjustEstimate: mode,
        adjustValue,
      });
      onLogged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const radioRow = (
    value: AdjustMode,
    label: ReactNode,
    extra?: ReactNode,
    hint?: string,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 12.5 }}>
        <input
          type="radio"
          name="remaining-estimate"
          checked={mode === value}
          onChange={() => setMode(value)}
          style={{ margin: 0 }}
        />
        <span>{label}</span>
        {extra}
      </label>
      {hint && (
        <div className="muted" style={{ fontSize: 11, marginLeft: 24 }}>
          {hint}
        </div>
      )}
    </div>
  );

  return (
    <Modal
      width={640}
      onClose={onClose}
      title={`Log Work: ${issueKey}`}
      footer={
        <>
          {error && (
            <div style={{ flex: 1, alignSelf: 'center', color: 'var(--accent-red)', fontSize: 12 }}>{error}</div>
          )}
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            Log
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>
            Time Spent<span style={{ color: 'var(--accent-red)' }}> *</span>
          </label>
          <input value={timeSpent} onChange={(e) => setTimeSpent(e.target.value)} style={{ width: '100%' }} />
          <div className="muted" style={{ fontSize: 11 }}>
            (eg. 3w 4d 12h) — estimate of time you spent working.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>
            Date Started<span style={{ color: 'var(--accent-red)' }}> *</span>
          </label>
          <input
            type="datetime-local"
            value={started}
            onChange={(e) => setStarted(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>Remaining Estimate</label>
          {radioRow(
            'auto',
            'Adjust automatically',
            undefined,
            'The estimate is reduced by the amount of work done, but never below 0.',
          )}
          {hasExisting &&
            radioRow('leave', `Use existing estimate of ${formatExistingEstimate(remainingEstimate as number)}`)}
          {radioRow(
            'new',
            'Set to',
            <input
              value={setToValue}
              onChange={(e) => setSetToValue(e.target.value)}
              disabled={mode !== 'new'}
              placeholder="e.g. 2h"
              style={{ width: 120 }}
            />,
          )}
          {radioRow(
            'manual',
            'Reduce by',
            <input
              value={reduceByValue}
              onChange={(e) => setReduceByValue(e.target.value)}
              disabled={mode !== 'manual'}
              placeholder="e.g. 30m"
              style={{ width: 120 }}
            />,
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label>Work Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ height: 120, resize: 'vertical', width: '100%' }}
          />
        </div>
      </div>
    </Modal>
  );
}
