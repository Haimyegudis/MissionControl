// Bulk case edit — set Assigned to / Owner / Priority / Type on every
// selected case in one go. Only the fields the user picks change; the rest
// stay untouched (server sends a partial update per case).

import { useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { Modal } from '../../components/Modal';
import { UserIdPicker } from '../../components/UserIdPicker';
import { pushToast } from '../../stores/toasts';
import type { TestRailState } from '../../stores/testrail';
import { errText } from './common';

const NO_CHANGE = '';

export function BulkEditDialog({
  st,
  caseIds,
  onClose,
  onSaved,
}: {
  st: TestRailState;
  caseIds: number[];
  onClose: () => void;
  /** Called after a successful apply so the view refetches fresh cases. */
  onSaved: () => void;
}) {
  const [assignedTo, setAssignedTo] = useState(NO_CHANGE);
  const [owner, setOwner] = useState(NO_CHANGE);
  const [priority, setPriority] = useState(NO_CHANGE);
  const [type, setType] = useState(NO_CHANGE);
  const [busy, setBusy] = useState(false);

  // People + meta users (people names win) — same roster as the case editor.
  const userOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of st.meta?.users ?? []) map.set(u.id, u.name);
    for (const [id, name] of Object.entries(st.people)) map.set(Number(id), name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [st.meta, st.people]);

  const nothingPicked = !assignedTo && !owner && !priority && !type;

  const apply = async () => {
    const set: { ownerId?: number; assignedToId?: number; priorityId?: number; typeId?: number } = {};
    if (assignedTo) set.assignedToId = Number(assignedTo);
    if (owner) set.ownerId = Number(owner);
    if (priority) set.priorityId = Number(priority);
    if (type) set.typeId = Number(type);
    setBusy(true);
    try {
      const result = await trApi.bulkUpdateCases(caseIds, set);
      pushToast({
        title: 'TestRail bulk edit',
        body: result.failures.length
          ? `${result.updated} updated, ${result.failures.length} failed (first: C${result.failures[0].id} — ${result.failures[0].error})`
          : `${result.updated} case${result.updated === 1 ? '' : 's'} updated.`,
        severity: result.failures.length ? 'error' : 'success',
      });
      onClose();
      onSaved();
    } catch (err) {
      pushToast({ title: 'Bulk edit failed', body: errText(err), severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
  const userSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <div style={fieldCol}>
      {label}
      <UserIdPicker
        options={userOptions}
        value={value}
        onChange={onChange}
        placeholder="Type a name — no change when empty"
      />
    </div>
  );

  return (
    <Modal
      title={`Bulk edit ${caseIds.length} case${caseIds.length === 1 ? '' : 's'}`}
      width={460}
      closeOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || nothingPicked} onClick={() => void apply()}>
            {busy ? '…' : `Apply to ${caseIds.length}`}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Only the fields you pick change — everything else stays as-is.
        </div>
        {userSelect(assignedTo, setAssignedTo, 'Assigned to')}
        {userSelect(owner, setOwner, 'Test case owner')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={fieldCol}>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value={NO_CHANGE}>— no change —</option>
              {(st.meta?.priorities ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldCol}>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value={NO_CHANGE}>— no change —</option>
              {(st.meta?.caseTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
