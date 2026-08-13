// Copy/Move transfer dialog (Railbook transferModal): target project → suite →
// filterable section list, an included-cases checklist (untick to exclude),
// cross-project move blocked with an explanatory message.

import { useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { Modal } from '../../components/Modal';
import { pushToast } from '../../stores/toasts';
import { ensureCases, type TestRailState } from '../../stores/testrail';
import type { TrSection, TrSuite } from '../../testrailTypes';
import { errText } from './common';

export interface TransferDialogProps {
  st: TestRailState;
  mode: 'copy' | 'move';
  caseIds: number[];
  onClose: () => void;
  /** Called after a successful transfer (source already refreshed). */
  onDone: () => void;
}

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

export function TransferDialog({ st, mode, caseIds, onClose, onDone }: TransferDialogProps) {
  const [projectId, setProjectId] = useState<number>(st.projectId ?? st.allProjects[0]?.id ?? 0);
  const [suites, setSuites] = useState<TrSuite[] | null>(null);
  const [suiteId, setSuiteId] = useState<number | null>(null);
  const [sections, setSections] = useState<TrSection[] | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [included, setIncluded] = useState<ReadonlySet<number>>(new Set(caseIds));
  const [busy, setBusy] = useState(false);

  const allCases = useMemo(() => Object.values(st.cases).flatMap((l) => l ?? []), [st.cases]);
  const titleOf = (id: number) => allCases.find((c) => c.id === id)?.title ?? '';

  // Load target suites when the project changes.
  useEffect(() => {
    let cancelled = false;
    setSuites(null);
    setSections(null);
    void trApi
      .suites(projectId)
      .then((list) => {
        if (cancelled) return;
        setSuites(list);
        const preferred =
          projectId === st.projectId && typeof st.selSuiteId === 'number'
            ? (list.find((s) => s.id === st.selSuiteId)?.id ?? list[0]?.id ?? null)
            : (list[0]?.id ?? null);
        setSuiteId(preferred);
      })
      .catch((err) => {
        if (!cancelled) pushToast({ title: 'Suites failed', body: errText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load target sections when the suite changes.
  useEffect(() => {
    if (suiteId == null) {
      setSections([]);
      return;
    }
    let cancelled = false;
    setSections(null);
    void trApi
      .sections(projectId, suiteId)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => a.displayOrder - b.displayOrder);
        setSections(sorted);
        setSectionId(sorted[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) pushToast({ title: 'Sections failed', body: errText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, suiteId]);

  const shownSections = useMemo(() => {
    if (!sections) return [];
    const q = search.trim().toLowerCase();
    return q ? sections.filter((s) => s.name.toLowerCase().includes(q)) : sections;
  }, [sections, search]);

  // Keep the selection on a visible section.
  useEffect(() => {
    if (shownSections.length && !shownSections.some((s) => s.id === sectionId)) {
      setSectionId(shownSections[0].id);
    }
  }, [shownSections, sectionId]);

  const go = async () => {
    const chosen = caseIds.filter((id) => included.has(id));
    if (sectionId == null) {
      pushToast({ title: 'TestRail', body: 'Pick a target section.' });
      return;
    }
    if (!chosen.length) {
      pushToast({ title: 'TestRail', body: 'No cases ticked.' });
      return;
    }
    if (mode === 'move' && projectId !== st.projectId) {
      pushToast({ title: 'TestRail', body: 'TestRail cannot move across projects — use Copy instead.' });
      return;
    }
    setBusy(true);
    try {
      if (mode === 'copy') {
        await trApi.copyCases(sectionId, chosen);
        pushToast({ title: 'TestRail', body: `${chosen.length} cases copied.` });
      } else {
        await trApi.moveCases(sectionId, suiteId !== st.selSuiteId ? suiteId : null, chosen);
        pushToast({ title: 'TestRail', body: `${chosen.length} cases moved.` });
      }
      onClose();
      // Refresh source suite; same-project cross-suite targets too. For a
      // cross-project copy, refresh that project's server cache best-effort.
      if (st.selSuiteId != null) await ensureCases(st.selSuiteId, true);
      if (projectId === st.projectId && suiteId != null && suiteId !== st.selSuiteId) {
        await ensureCases(suiteId, true);
      }
      if (projectId !== st.projectId && suiteId != null) {
        void trApi.cases(projectId, suiteId, true).catch(() => {});
      }
      onDone();
    } catch (err) {
      pushToast({ title: mode === 'copy' ? 'Copy failed' : 'Move failed', body: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${mode === 'copy' ? 'Copy' : 'Move'} ${caseIds.length} case${caseIds.length === 1 ? '' : 's'}`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void go()}>
            {busy ? '…' : mode === 'copy' ? 'Copy cases' : 'Move cases'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={fieldCol}>
          Target project
          <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
            {st.allProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldCol}>
          Target suite
          <select
            value={suiteId ?? ''}
            onChange={(e) => setSuiteId(Number(e.target.value) || null)}
            disabled={suites === null}
          >
            {suites === null ? (
              <option>loading…</option>
            ) : suites.length === 0 ? (
              <option value="">(no suites)</option>
            ) : (
              suites.map((su) => (
                <option key={su.id} value={su.id}>
                  {su.name}
                </option>
              ))
            )}
          </select>
        </label>

        <label style={fieldCol}>
          Find section
          <input
            placeholder="Type to filter sections…"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label style={fieldCol}>
          Target section
          <select
            size={8}
            value={sectionId ?? ''}
            onChange={(e) => setSectionId(Number(e.target.value) || null)}
            style={{ fontFamily: 'inherit' }}
          >
            {sections === null ? (
              <option>loading…</option>
            ) : shownSections.length === 0 ? (
              <option value="">(no matching section)</option>
            ) : (
              shownSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {'— '.repeat(s.depth)}
                  {s.name}
                </option>
              ))
            )}
          </select>
        </label>

        {mode === 'move' ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Note: TestRail only supports moving cases between suites of the <b>same project</b>. For a different
            project use Copy.
          </p>
        ) : null}

        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            Cases included ({caseIds.filter((id) => included.has(id)).length}/{caseIds.length}) — untick to exclude
          </summary>
          <div
            style={{
              maxHeight: 200,
              overflow: 'auto',
              marginTop: 8,
              border: '1px solid var(--border-soft)',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            {caseIds.map((id) => (
              <label
                key={id}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, padding: '2px 0' }}
              >
                <input
                  type="checkbox"
                  checked={included.has(id)}
                  onChange={(e) => {
                    setIncluded((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(id);
                      else next.delete(id);
                      return next;
                    });
                  }}
                />
                <span className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                  C{id}
                </span>
                <span>{titleOf(id)}</span>
              </label>
            ))}
          </div>
        </details>
      </div>
    </Modal>
  );
}
