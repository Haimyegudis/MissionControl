// Section create/rename dialog (Railbook sectionEditorModal). Deletion runs
// through the typed-name ConfirmDialog from the section actions toolbar.
// Unsaved input autosaves as a draft — an accidental close, refresh or
// timeout restores it on reopen.

import { useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { DraftBanner } from '../../components/DraftBanner';
import { Modal } from '../../components/Modal';
import { clearDraft, draftKey, loadDraft } from '../../lib/drafts';
import { useDraftAutosave } from '../../lib/useDraftAutosave';
import { pushToast } from '../../stores/toasts';
import { currentSections, type TestRailState } from '../../stores/testrail';
import type { TrSection } from '../../testrailTypes';
import { errText } from './common';

export interface SectionDialogProps {
  st: TestRailState;
  /** Section to rename; null → create. */
  existing: TrSection | null;
  /** Parent for a new subsection (create mode only). */
  parentId: number | null;
  onClose: () => void;
  /** Called after a successful save so the view refetches fresh sections. */
  onSaved: () => void;
}

interface SectionDraft {
  name: string;
  description: string;
}

export function SectionDialog({ st, existing, parentId, onClose, onSaved }: SectionDialogProps) {
  const dKey = existing
    ? draftKey('section', 'edit', existing.id)
    : draftKey('section', 'new', st.projectId ?? 0, String(st.selSuiteId ?? 0), parentId ?? 0);
  const baseline = useMemo<SectionDraft>(() => ({ name: existing?.name ?? '', description: '' }), [existing]);
  // Read once on mount; interrupted work (refresh, accidental close) restores.
  const restored = useMemo(() => loadDraft<SectionDraft>(dKey), [dKey]);

  const [name, setName] = useState(restored?.data.name ?? baseline.name);
  const [description, setDescription] = useState(restored?.data.description ?? baseline.description);
  const [banner, setBanner] = useState<number | null>(restored?.savedAt ?? null);
  const [busy, setBusy] = useState(false);

  const current: SectionDraft = { name, description };
  useDraftAutosave(dKey, current, JSON.stringify(current) === JSON.stringify(baseline));

  const discardDraft = () => {
    clearDraft(dKey);
    setBanner(null);
    setName(baseline.name);
    setDescription(baseline.description);
  };

  const save = async () => {
    if (!name.trim()) {
      pushToast({ title: 'TestRail', body: 'Name is required.' });
      return;
    }
    setBusy(true);
    try {
      if (existing) {
        await trApi.updateSection(existing.id, name.trim(), description.trim() || null);
        pushToast({ title: 'TestRail', body: 'Section renamed.' });
      } else {
        if (st.projectId == null || st.selSuiteId === 'all' || st.selSuiteId == null) {
          pushToast({ title: 'TestRail', body: 'Pick a specific suite first to create a section.' });
          return;
        }
        // parentId is authoritative: the toolbar "+ Section" passes null for a
        // top-level section; the section-actions "add subsection" passes the
        // parent. Never silently inherit the tree selection — that used to
        // nest new sections under whatever was selected, hiding them.
        await trApi.addSection(st.projectId, {
          suiteId: st.selSuiteId,
          parentId,
          name: name.trim(),
          description: description.trim() || null,
        });
        pushToast({ title: 'TestRail', body: 'Section created.' });
      }
      clearDraft(dKey);
      onClose();
      onSaved();
    } catch (err) {
      pushToast({ title: existing ? 'Rename failed' : 'Create failed', body: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Rename section' : parentId != null ? 'New subsection' : 'New section'}
      width={460}
      closeOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '…' : existing ? 'Rename' : 'Create'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {banner !== null ? <DraftBanner savedAt={banner} onDiscard={discardDraft} /> : null}
        {!existing && parentId != null ? (
          <div className="muted" style={{ fontSize: 12 }}>
            Inside section: <b>{currentSections(st).find((s) => s.id === parentId)?.name ?? `#${parentId}`}</b>
          </div>
        ) : null}
        {!existing && parentId == null ? (
          <div className="muted" style={{ fontSize: 12 }}>
            Top-level section. To add a subsection, hover a section in the tree and click +.
          </div>
        ) : null}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Name
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Description (optional)
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
