// Case editor dialog (Railbook caseEditorModal): title, section (create only),
// type/priority/estimate/refs/owner, preconditions, steps editor rows and an
// overall expected. Steps serialize to the API's plain-text form.

import { useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { Modal } from '../../components/Modal';
import { stepsToText } from '../../lib/testrail';
import { pushToast } from '../../stores/toasts';
import { currentSections, userName, type TestRailState } from '../../stores/testrail';
import type { TrCase } from '../../testrailTypes';
import { errText } from './common';

interface StepRow {
  action: string;
  expected: string;
}

export interface CaseEditorProps {
  st: TestRailState;
  /** null → create a new case. */
  existing: TrCase | null;
  onClose: () => void;
  /** Called after a successful save so the view refetches fresh cases. */
  onSaved: () => void;
}

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

export function CaseEditor({ st, existing, onClose, onSaved }: CaseEditorProps) {
  const isEdit = existing !== null;
  const sections = useMemo(
    () => [...currentSections(st)].sort((a, b) => a.displayOrder - b.displayOrder),
    [st],
  );
  const defaultSection = existing?.sectionId ?? st.selSectionId ?? sections[0]?.id ?? null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [sectionId, setSectionId] = useState<number | null>(defaultSection);
  const [typeId, setTypeId] = useState<string>(existing?.typeId ? String(existing.typeId) : '');
  const [priorityId, setPriorityId] = useState<string>(existing?.priorityId ? String(existing.priorityId) : '');
  const [estimate, setEstimate] = useState(existing?.estimate ?? '');
  const [refs, setRefs] = useState(existing?.refs ?? '');
  const [ownerId, setOwnerId] = useState<string>(existing?.ownerId ? String(existing.ownerId) : '');
  const [preconds, setPreconds] = useState(existing?.preconds ?? '');
  const [expected, setExpected] = useState(existing?.expected ?? '');
  const [steps, setSteps] = useState<StepRow[]>(
    existing?.stepsSeparated.length
      ? existing.stepsSeparated.map((s) => ({ action: s.action, expected: s.expected }))
      : [{ action: '', expected: '' }],
  );
  const [busy, setBusy] = useState(false);

  // Owner options: known people plus meta users (people names win).
  const ownerOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of st.meta?.users ?? []) map.set(u.id, u.name);
    for (const [id, name] of Object.entries(st.people)) map.set(Number(id), name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [st.meta, st.people]);

  const save = async () => {
    if (!title.trim()) {
      pushToast({ title: 'TestRail', body: 'Title is required.' });
      return;
    }
    const payload = {
      title: title.trim(),
      typeId: Number(typeId) || null,
      priorityId: Number(priorityId) || null,
      estimate: estimate.trim() || null,
      refs: refs.trim() || null,
      description: null,
      preconds: preconds.trim() || null,
      steps: stepsToText(steps) || null,
      expected: expected.trim() || null,
      ownerId: Number(ownerId) || null,
    };
    setBusy(true);
    try {
      if (isEdit) {
        await trApi.updateCase((existing as TrCase).id, payload);
        pushToast({ title: 'TestRail', body: 'Case updated.' });
      } else {
        if (sectionId == null) {
          pushToast({ title: 'TestRail', body: 'Create a section first.' });
          return;
        }
        await trApi.addCase(sectionId, payload);
        pushToast({ title: 'TestRail', body: 'Case created.' });
      }
      onClose();
      onSaved();
    } catch (err) {
      pushToast({ title: isEdit ? 'Update failed' : 'Create failed', body: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit case C${(existing as TrCase).id}` : 'New case'}
      width={720}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '…' : isEdit ? 'Save changes' : 'Create case'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={fieldCol}>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        {!isEdit ? (
          <label style={fieldCol}>
            Section
            <select value={sectionId ?? ''} onChange={(e) => setSectionId(Number(e.target.value) || null)}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {'— '.repeat(s.depth)}
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={fieldCol}>
            Type
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">—</option>
              {(st.meta?.caseTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldCol}>
            Priority
            <select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
              <option value="">—</option>
              {(st.meta?.priorities ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldCol}>
            Estimate
            <input value={estimate} placeholder="e.g. 30m" onChange={(e) => setEstimate(e.target.value)} />
          </label>
          <label style={fieldCol}>
            References
            <input value={refs} placeholder="JIRA-123, JIRA-456" onChange={(e) => setRefs(e.target.value)} />
          </label>
          <label style={fieldCol}>
            Test case owner
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">—</option>
              {ownerOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
              {ownerId && !ownerOptions.some(([id]) => String(id) === ownerId) ? (
                <option value={ownerId}>{userName(st, Number(ownerId))}</option>
              ) : null}
            </select>
          </label>
        </div>

        <label style={fieldCol}>
          Preconditions
          <textarea rows={2} value={preconds} onChange={(e) => setPreconds(e.target.value)} />
        </label>

        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--muted)',
              padding: '4px 0 8px',
            }}
          >
            Steps
          </div>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 8, marginBottom: 8 }}>
              <textarea
                rows={2}
                placeholder="Step — what to do"
                value={s.action}
                onChange={(e) =>
                  setSteps((prev) => prev.map((row, j) => (j === i ? { ...row, action: e.target.value } : row)))
                }
              />
              <textarea
                rows={2}
                placeholder="Expected — what to check"
                value={s.expected}
                onChange={(e) =>
                  setSteps((prev) => prev.map((row, j) => (j === i ? { ...row, expected: e.target.value } : row)))
                }
              />
              <button
                className="btn btn-icon"
                title="remove step"
                onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => setSteps((prev) => [...prev, { action: '', expected: '' }])}>
            + add step
          </button>
        </div>

        <label style={fieldCol}>
          Expected (overall, optional)
          <textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
