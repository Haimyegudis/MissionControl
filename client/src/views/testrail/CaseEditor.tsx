// Case editor dialog (Railbook caseEditorModal): title, section (create only),
// type/priority/estimate/refs/owner, preconditions, steps editor rows and an
// overall expected. Steps serialize to the API's plain-text form.

import { useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { DraftBanner } from '../../components/DraftBanner';
import { Modal } from '../../components/Modal';
import { RichTextArea } from '../../components/RichTextArea';
import { RichToolbar, useRichTarget } from '../../components/RichToolbar';
import { clearDraft, draftKey, loadDraft } from '../../lib/drafts';
import { useDraftAutosave } from '../../lib/useDraftAutosave';
import { stepsToText } from '../../lib/testrail';
import { pushToast } from '../../stores/toasts';
import { currentSections, userName, type TestRailState } from '../../stores/testrail';
import type { TrCase } from '../../testrailTypes';
import { errText } from './common';

interface StepRow {
  action: string;
  expected: string;
}

/**
 * Everything the user can type — persisted as a draft between sessions.
 * The target section is intentionally NOT part of the draft: it always
 * follows the tree selection, so a restored draft never hijacks the
 * section/subsection the user just picked.
 */
interface CaseDraft {
  title: string;
  typeId: string;
  priorityId: string;
  estimate: string;
  refs: string;
  ownerId: string;
  preconds: string;
  expected: string;
  steps: StepRow[];
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
  // Full breadcrumb per section ("ISW-xxx / Manual") — the flat name alone is
  // ambiguous once subsections exist.
  const sectionPath = useMemo(() => {
    const byId = new Map(sections.map((s) => [s.id, s]));
    const path = new Map<number, string>();
    for (const s of sections) {
      const names: string[] = [];
      for (let cur: typeof s | undefined = s; cur; cur = cur.parentId != null ? byId.get(cur.parentId) : undefined) {
        names.unshift(cur.name);
        if (names.length > 10) break; // cycle guard
      }
      path.set(s.id, names.join(' / '));
    }
    return path;
  }, [sections]);
  const defaultSection = existing?.sectionId ?? st.selSectionId ?? sections[0]?.id ?? null;

  // Pristine values (what the form shows with no draft and no edits) — the
  // draft baseline: while the form matches this, no draft is kept.
  const baseline = useMemo<CaseDraft>(
    () => ({
      title: existing?.title ?? '',
      typeId: existing?.typeId ? String(existing.typeId) : '',
      priorityId: existing?.priorityId ? String(existing.priorityId) : '',
      estimate: existing?.estimate ?? '',
      refs: existing?.refs ?? '',
      ownerId: existing?.ownerId ? String(existing.ownerId) : '',
      preconds: existing?.preconds ?? '',
      expected: existing?.expected ?? '',
      steps: existing?.stepsSeparated.length
        ? existing.stepsSeparated.map((s) => ({ action: s.action, expected: s.expected }))
        : [{ action: '', expected: '' }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const dKey = isEdit
    ? draftKey('case', 'edit', (existing as TrCase).id)
    : draftKey('case', 'new', st.projectId ?? 0, String(st.selSuiteId ?? 0));
  // Read once on mount; interrupted work (refresh, timeout, crash) restores.
  const restored = useMemo(() => loadDraft<CaseDraft>(dKey), [dKey]);
  const init = restored?.data ?? baseline;

  const [title, setTitle] = useState(init.title);
  // Section always starts at the current tree selection — never the draft.
  const [sectionId, setSectionId] = useState<number | null>(defaultSection);
  const [typeId, setTypeId] = useState<string>(init.typeId);
  const [priorityId, setPriorityId] = useState<string>(init.priorityId);
  const [estimate, setEstimate] = useState(init.estimate);
  const [refs, setRefs] = useState(init.refs);
  const [ownerId, setOwnerId] = useState<string>(init.ownerId);
  const [preconds, setPreconds] = useState(init.preconds);
  const [expected, setExpected] = useState(init.expected);
  const [steps, setSteps] = useState<StepRow[]>(init.steps);
  const [banner, setBanner] = useState<number | null>(restored?.savedAt ?? null);
  const [busy, setBusy] = useState(false);
  const richTarget = useRichTarget();
  const focusTarget = (el: HTMLElement) => {
    richTarget.current = el;
  };

  const current: CaseDraft = { title, typeId, priorityId, estimate, refs, ownerId, preconds, expected, steps };
  useDraftAutosave(dKey, current, JSON.stringify(current) === JSON.stringify(baseline));

  const discardDraft = () => {
    clearDraft(dKey);
    setBanner(null);
    setTitle(baseline.title);
    setSectionId(defaultSection);
    setTypeId(baseline.typeId);
    setPriorityId(baseline.priorityId);
    setEstimate(baseline.estimate);
    setRefs(baseline.refs);
    setOwnerId(baseline.ownerId);
    setPreconds(baseline.preconds);
    setExpected(baseline.expected);
    setSteps(baseline.steps);
  };

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
    const filledSteps = steps.filter((s) => s.action.trim() || s.expected.trim());
    const payload = {
      title: title.trim(),
      typeId: Number(typeId) || null,
      priorityId: Number(priorityId) || null,
      estimate: estimate.trim() || null,
      refs: refs.trim() || null,
      description: null,
      preconds: preconds.trim() || null,
      steps: stepsToText(steps) || null,
      // The template displays separated steps — this is the field that counts.
      stepsSeparated: filledSteps.map((s) => ({ content: s.action, expected: s.expected })),
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
      clearDraft(dKey);
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
      closeOnBackdrop={false}
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
        {banner !== null ? <DraftBanner savedAt={banner} onDiscard={discardDraft} /> : null}
        <label style={fieldCol}>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        {!isEdit ? (
          <label style={fieldCol}>
            Section / Subsection
            <select value={sectionId ?? ''} onChange={(e) => setSectionId(Number(e.target.value) || null)}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionPath.get(s.id) ?? s.name}
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

        <RichToolbar target={richTarget} />

        <div style={fieldCol}>
          Preconditions
          <RichTextArea value={preconds} onChange={setPreconds} onFocusTarget={focusTarget} />
        </div>

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
              <RichTextArea
                placeholder="Step — what to do"
                value={s.action}
                onChange={(v) => setSteps((prev) => prev.map((row, j) => (j === i ? { ...row, action: v } : row)))}
                onFocusTarget={focusTarget}
              />
              <RichTextArea
                placeholder="Expected — what to check"
                value={s.expected}
                onChange={(v) => setSteps((prev) => prev.map((row, j) => (j === i ? { ...row, expected: v } : row)))}
                onFocusTarget={focusTarget}
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

        <div style={fieldCol}>
          Expected (overall, optional)
          <RichTextArea value={expected} onChange={setExpected} onFocusTarget={focusTarget} />
        </div>
      </div>
    </Modal>
  );
}
