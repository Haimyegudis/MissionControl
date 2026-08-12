// Create issue dialog (ui-parity §10.2) — hardcoded ISW / Incident, meta from
// GET /api/create/meta, priority automation, defaults, fallback skeleton.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create as createApi } from '../api/client';
import { Modal } from '../components/Modal';
import { computePriority } from '../lib/priorityAutomation';
import { sessionStore } from '../stores/session';
import { pushToast } from '../stores/toasts';
import { useStore } from '../stores/useStore';
import type { JiraCreateFieldMeta } from '../types';

const PROJECT = 'ISW';
const ISSUE_TYPE = 'Incident';
const DEFAULTS_KEY = `${PROJECT}:${ISSUE_TYPE}`;

export type FieldKind = 'text' | 'longtext' | 'select' | 'multiselect' | 'date' | 'datetime' | 'number' | 'user';

/** Field kind per the §10.2 table. */
export function fieldKind(field: JiraCreateFieldMeta): FieldKind {
  const type = (field.schemaType ?? '').toLowerCase();
  const name = (field.displayName ?? '').toLowerCase();
  if (field.allowedValues.length > 0) return type === 'array' ? 'multiselect' : 'select';
  if (type === 'string' && (name.includes('description') || name.includes('environment'))) return 'longtext';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime';
  if (type === 'number') return 'number';
  if (type === 'user') return 'user';
  return 'text';
}

/** Hardcoded fallback skeleton (§10.2) used when the meta comes back empty. */
export function fallbackSkeleton(): JiraCreateFieldMeta[] {
  const f = (
    fieldId: string,
    displayName: string,
    required: boolean,
    schemaType: string,
    allowedValues: string[] = [],
  ): JiraCreateFieldMeta => ({ fieldId, displayName, required, schemaType, allowedValues });
  return [
    f('summary', 'Summary', true, 'string'),
    f('priority', 'Priority', true, 'priority', ['Highest', 'High', 'Medium', 'Low', 'Lowest']),
    f('program', 'Program', true, 'option', [
      'Indigo 7',
      'Indigo 8',
      'Indigo 12',
      'Indigo 14',
      'Indigo 15',
      'Indigo 17',
      'Indigo 35',
      'Indigo 100K',
      'Future',
      'Common',
    ]),
    f('reproducibility', 'Reproducibility', true, 'option', [
      'Always',
      'Often',
      'Sometimes',
      'Once',
      'Rare',
      'Did not try',
    ]),
    f('environmentAffected', 'Environment Affected', true, 'option', [
      'Production',
      'Customer',
      'Lab',
      'Test',
      'Development',
    ]),
    f('severity', 'Severity', false, 'option', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']),
    f('description', 'Description', false, 'string'),
  ];
}

function tzOffsetString(d: Date = new Date()): string {
  const min = -d.getTimezoneOffset();
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Shape one field value for submit; returns undefined when empty (omitted). */
export function shapeCreateValue(field: JiraCreateFieldMeta, value: string | string[]): unknown {
  const kind = fieldKind(field);
  if (kind === 'multiselect') {
    const arr = (value as string[]).filter(Boolean);
    return arr.length > 0 ? arr.map((v) => ({ name: v })) : undefined;
  }
  const raw = (value as string).trim();
  if (!raw) return undefined;
  switch (kind) {
    case 'select':
      return { name: raw };
    case 'user':
      return { name: raw };
    case 'date':
      return raw; // yyyy-MM-dd
    case 'datetime':
      // datetime-local "yyyy-MM-ddTHH:mm" → yyyy-MM-ddTHH:mm:ss.000zzz
      return `${raw}:00.000${tzOffsetString()}`;
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    default:
      return raw;
  }
}

type Values = Record<string, string | string[]>;

function emptyValues(fields: JiraCreateFieldMeta[]): Values {
  const v: Values = {};
  for (const f of fields) v[f.fieldId] = fieldKind(f) === 'multiselect' ? [] : '';
  return v;
}

function findDriver(fields: JiraCreateFieldMeta[], needle: string): JiraCreateFieldMeta | undefined {
  return fields.find((f) => f.displayName.toLowerCase().includes(needle));
}

export function CreateIssue({ onClose }: { onClose: () => void }) {
  const session = useStore(sessionStore);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fields, setFields] = useState<JiraCreateFieldMeta[]>([]);
  const [values, setValues] = useState<Values>({});
  const [createAnother, setCreateAnother] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultsRef = useRef<Record<string, unknown>>({});

  const applyDefaults = useCallback((flds: JiraCreateFieldMeta[], base: Values): Values => {
    const next = { ...base };
    for (const [id, val] of Object.entries(defaultsRef.current)) {
      const field = flds.find((f) => f.fieldId === id);
      if (!field) continue;
      if (fieldKind(field) === 'multiselect') {
        if (Array.isArray(val)) next[id] = val.map(String);
      } else if (typeof val === 'string' || typeof val === 'number') {
        next[id] = String(val);
      }
    }
    return next;
  }, []);

  // Meta load: server owns the disk cache (14d TTL, 15s timeout).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let metaFields: JiraCreateFieldMeta[] = [];
      try {
        const meta = await createApi.meta(PROJECT, ISSUE_TYPE);
        metaFields = meta.fields ?? [];
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          `${err instanceof Error ? err.message : String(err)} — you can still use "Open in Jira" to create the incident there.`,
        );
      }
      if (cancelled) return;
      // Empty meta → hardcoded fallback skeleton. Preserve Jira response order.
      const flds = metaFields.length > 0 ? metaFields : fallbackSkeleton();
      try {
        defaultsRef.current = (await createApi.getDefaults(DEFAULTS_KEY)) ?? {};
      } catch {
        defaultsRef.current = {};
      }
      if (cancelled) return;
      setFields(flds);
      setValues(applyDefaults(flds, emptyValues(flds)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDefaults]);

  const drivers = useMemo(
    () => ({
      severity: findDriver(fields, 'severity'),
      environment: findDriver(fields, 'environment'),
      reproducibility: findDriver(fields, 'reproducib'),
      priority: fields.find((f) => f.fieldId === 'priority' || f.displayName.toLowerCase() === 'priority'),
    }),
    [fields],
  );

  const setValue = (field: JiraCreateFieldMeta, v: string | string[]) => {
    setValues((prev) => {
      const next = { ...prev, [field.fieldId]: v };
      // Priority automation: recompute when a driver changes (§10.2).
      const { severity, environment, reproducibility, priority } = drivers;
      const isDriver =
        (severity && field.fieldId === severity.fieldId) ||
        (environment && field.fieldId === environment.fieldId) ||
        (reproducibility && field.fieldId === reproducibility.fieldId);
      if (isDriver && priority) {
        const suggested = computePriority(
          severity ? String(next[severity.fieldId] ?? '') : null,
          environment ? String(next[environment.fieldId] ?? '') : null,
          reproducibility ? String(next[reproducibility.fieldId] ?? '') : null,
        );
        if (suggested) {
          const match =
            priority.allowedValues.find((a) => a.toLowerCase() === suggested.toLowerCase()) ??
            priority.allowedValues.find((a) => a.toLowerCase().includes(suggested.toLowerCase())) ??
            suggested;
          next[priority.fieldId] = match;
        }
      }
      return next;
    });
  };

  const submit = async () => {
    // No client-side required validation — Jira is authoritative (§10.2).
    const shaped: Record<string, unknown> = {};
    for (const f of fields) {
      const v = shapeCreateValue(f, values[f.fieldId] ?? '');
      if (v !== undefined) shaped[f.fieldId] = v;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await createApi.issue({ project: PROJECT, type: ISSUE_TYPE, fields: shaped });
      if (createAnother) {
        setStatus({ text: `Created ${res.key}.`, ok: true });
        // Reset only text | longtext | number; keep selects; re-apply defaults.
        setValues((prev) => {
          const next = { ...prev };
          for (const f of fields) {
            const kind = fieldKind(f);
            if (kind === 'text' || kind === 'longtext' || kind === 'number') next[f.fieldId] = '';
          }
          return applyDefaults(fields, next);
        });
      } else {
        pushToast({ title: 'Issue created', body: `Created ${res.key}.` });
        onClose();
      }
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const saveDefaults = async () => {
    const toSave: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.fieldId];
      if (Array.isArray(v)) {
        if (v.length > 0) toSave[f.fieldId] = v;
      } else if ((v ?? '').trim()) {
        toSave[f.fieldId] = v;
      }
    }
    try {
      await createApi.putDefaults(DEFAULTS_KEY, toSave);
      defaultsRef.current = toSave;
      const n = Object.keys(toSave).length;
      setStatus({ text: `Saved ${n} default(s) — auto-applied next time.`, ok: true });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  const clearDefaults = async () => {
    try {
      await createApi.deleteDefaults(DEFAULTS_KEY);
      defaultsRef.current = {};
      setStatus({ text: 'Defaults cleared.', ok: true });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  const openInJira = () => {
    const base = session.profile?.jiraBaseUrl?.replace(/\/+$/, '');
    if (base) window.open(`${base}/secure/CreateIssue!default.jspa`, '_blank', 'noopener,noreferrer');
  };

  const renderField = (f: JiraCreateFieldMeta) => {
    const kind = fieldKind(f);
    const v = values[f.fieldId] ?? (kind === 'multiselect' ? [] : '');
    switch (kind) {
      case 'longtext':
        return (
          <textarea
            value={v as string}
            onChange={(e) => setValue(f, e.target.value)}
            style={{ height: 100, resize: 'vertical', width: '100%' }}
          />
        );
      case 'select':
        return (
          <select value={v as string} onChange={(e) => setValue(f, e.target.value)} style={{ width: '100%' }}>
            <option value="" />
            {f.allowedValues.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        );
      case 'multiselect': {
        const selected = new Set(v as string[]);
        return (
          <div
            style={{
              maxHeight: 120,
              overflowY: 'auto',
              border: '1px solid var(--border-soft)',
              borderRadius: 8,
              padding: '6px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {f.allowedValues.map((a) => (
              <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={selected.has(a)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(a);
                    else next.delete(a);
                    setValue(f, [...next]);
                  }}
                  style={{ margin: 0 }}
                />
                {a}
              </label>
            ))}
          </div>
        );
      }
      case 'date':
        return (
          <input type="date" value={v as string} onChange={(e) => setValue(f, e.target.value)} style={{ width: '100%' }} />
        );
      case 'datetime':
        return (
          <input
            type="datetime-local"
            value={v as string}
            onChange={(e) => setValue(f, e.target.value)}
            style={{ width: '100%' }}
          />
        );
      case 'number':
        return (
          <input type="number" value={v as string} onChange={(e) => setValue(f, e.target.value)} style={{ width: '100%' }} />
        );
      case 'user':
        return (
          <input
            value={v as string}
            onChange={(e) => setValue(f, e.target.value)}
            title="Jira username or email"
            style={{ width: '100%' }}
          />
        );
      default:
        return <input value={v as string} onChange={(e) => setValue(f, e.target.value)} style={{ width: '100%' }} />;
    }
  };

  return (
    <Modal
      width={780}
      maxHeight="86vh"
      onClose={onClose}
      title={
        <div style={{ minWidth: 0 }}>
          <div>Create Incident — Indigo Software (ISW)</div>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>
            Required fields are marked with an asterisk *
          </div>
        </div>
      }
      footer={
        <>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginRight: 'auto',
              fontSize: 12.5,
              color: 'var(--text-primary)',
            }}
          >
            <input
              type="checkbox"
              checked={createAnother}
              onChange={(e) => setCreateAnother(e.target.checked)}
              style={{ margin: 0 }}
            />
            Create another
          </label>
          <button className="btn" onClick={() => void saveDefaults()} disabled={loading}>
            Save as defaults
          </button>
          <button className="btn" onClick={() => void clearDefaults()} disabled={loading}>
            Clear defaults
          </button>
          <button className="btn" onClick={openInJira}>
            Open in Jira
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={loading || busy}>
            Create
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {loading && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Loading create screen…</div>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loadError && (
            <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{loadError}</div>
          )}
          {fields.map((f) => (
            <div key={f.fieldId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label>
                {f.displayName}
                {f.required && <span style={{ color: 'var(--accent-red)' }}> *</span>}
              </label>
              {renderField(f)}
            </div>
          ))}
          {status && (
            <div style={{ fontSize: 12.5, color: status.ok ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {status.text}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
