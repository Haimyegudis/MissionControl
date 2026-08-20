// TestRail → Cases. Browse by section, read and edit steps, add cases, and
// copy or move a selection to another suite or section.
//
// The desktop screen is a fixed-layout table with a side tree and a column
// picker. Here the section is a picker, the list is cards, and everything that
// mutates happens in a bottom sheet — one job at a time, full width, with room
// to tap.

import { useCallback, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import { ensureCases, ensureSections, initTestRail, selectProject, trStore } from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import { pushToast } from '../../stores/toasts';
import { sectionPath } from '../../lib/testrail';
import type { TrAddCasePayload, TrCase, TrSection, TrSuite } from '../../testrailTypes';
import { invalidate, useCached } from '../cache';
import { BarButton, Empty, ErrorNote, Loading, Muted, Screen, Sheet, tapReset } from '../ui';

interface StepRow {
  content: string;
  expected: string;
}

function stepsOf(c: TrCase): StepRow[] {
  const rows = (c as unknown as { stepsSeparated?: StepRow[] | null }).stepsSeparated;
  if (Array.isArray(rows) && rows.length > 0) return rows.map((r) => ({ content: r.content ?? '', expected: r.expected ?? '' }));
  // Older cases carry a single free-text steps field instead of rows.
  if (c.steps) return [{ content: c.steps, expected: c.expected ?? '' }];
  return [];
}

export function MobileCases() {
  const st = useStore(trStore);
  const [query, setQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [editing, setEditing] = useState<{ existing: TrCase | null } | null>(null);
  const [transfer, setTransfer] = useState<'copy' | 'move' | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());

  const suiteKey = st.selSuiteId === null ? 'none' : String(st.selSuiteId);
  const key = `cases:${st.projectId ?? 'none'}:${suiteKey}`;

  const res = useCached<{ cases: TrCase[]; sections: TrSection[] }>(
    key,
    async () => {
      if (st.selSuiteId === null) return { cases: [], sections: [] };
      const [sectionLists, caseLists] = await Promise.all([
        ensureSections(st.selSuiteId),
        ensureCases(st.selSuiteId),
      ]);
      return { cases: caseLists.flat(), sections: sectionLists.flat() };
    },
    { ttlMs: 5 * 60_000, enabled: st.phase === 'connected' },
  );

  const reload = useCallback(() => {
    invalidate('cases:');
    res.refresh();
  }, [res]);

  const cases = res.data?.cases ?? [];
  const sections = res.data?.sections ?? [];
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const shown = needle
      ? cases.filter((c) => c.title.toLowerCase().includes(needle) || String(c.id).includes(needle))
      : cases;
    const map = new Map<number, TrCase[]>();
    for (const c of shown) {
      const id = c.sectionId ?? 0;
      const list = map.get(id);
      if (list) list.push(c);
      else map.set(id, [c]);
    }
    return [...map.entries()].map(([sectionId, items]) => ({ sectionId, items }));
  }, [cases, needle]);

  if (st.phase === 'disconnected') {
    void initTestRail();
    return (
      <Screen kicker="TestRail" title="Cases">
        <Empty>
          Not connected to TestRail.
          <br />
          Open More → Settings to add your API key.
        </Empty>
      </Screen>
    );
  }

  const project = st.allProjects.find((p) => p.id === st.projectId);
  const selCount = selected.size;

  return (
    <Screen
      kicker="TestRail"
      title="Cases"
      action={
        <>
          <button
            className="btn btn-primary"
            onClick={() => setEditing({ existing: null })}
            style={{ ...tapReset, minHeight: 40, padding: '0 12px' }}
          >
            + Case
          </button>
          <button className="btn" onClick={reload} disabled={res.refreshing} style={{ ...tapReset, minHeight: 40 }}>
            {res.refreshing ? '…' : '↻'}
          </button>
        </>
      }
    >
      <button
        onClick={() => setProjectOpen(true)}
        style={{
          ...tapReset,
          width: '100%',
          minHeight: 44,
          textAlign: 'left',
          padding: '0 12px',
          border: '1px solid var(--border-soft)',
          borderRadius: 10,
          background: 'var(--bg-panel)',
          color: 'var(--text-primary)',
          fontSize: 13.5,
          marginBottom: 8,
        }}
      >
        {project ? project.name : 'Choose a project'} ›
      </button>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search cases…"
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 12px',
          borderRadius: 10,
          border: '1px solid var(--border-soft)',
          background: 'var(--input-bg)',
          color: 'var(--text-primary)',
          fontSize: 15,
          marginBottom: 10,
        }}
      />

      {selCount > 0 ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <BarButton onClick={() => setTransfer('copy')} badge={selCount}>
            Copy to…
          </BarButton>
          <BarButton onClick={() => setTransfer('move')} badge={selCount}>
            Move to…
          </BarButton>
        </div>
      ) : null}

      {res.error ? <ErrorNote onRetry={reload}>{res.error}</ErrorNote> : null}
      {res.loading ? <Loading what="Loading cases" /> : null}
      {res.data && groups.length === 0 ? <Empty>No cases match.</Empty> : null}

      {groups.map(({ sectionId, items }) => (
        <section key={sectionId} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              padding: '6px 4px',
              borderBottom: '1px solid var(--border-soft)',
              marginBottom: 8,
              overflowWrap: 'anywhere',
            }}
          >
            {sectionPath(sectionId, sections, st.suites, st.selSuiteId === 'all')} · {items.length}
          </div>
          {items.slice(0, 200).map((c) => (
            <CaseCard
              key={c.id}
              tcase={c}
              selected={selected.has(c.id)}
              onToggle={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
              onEdit={() => setEditing({ existing: c })}
            />
          ))}
        </section>
      ))}

      <Sheet open={projectOpen} title="Project" onClose={() => setProjectOpen(false)}>
        {st.allProjects.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              void selectProject(p.id);
              setProjectOpen(false);
            }}
            style={rowStyle(p.id === st.projectId)}
          >
            {p.name}
          </button>
        ))}
      </Sheet>

      {editing ? (
        <CaseEditorSheet
          existing={editing.existing}
          sections={sections}
          suites={st.suites}
          allSuites={st.selSuiteId === 'all'}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}

      {transfer ? (
        <TransferSheet
          mode={transfer}
          ids={[...selected]}
          sections={sections}
          suites={st.suites}
          allSuites={st.selSuiteId === 'all'}
          onClose={() => setTransfer(null)}
          onDone={() => {
            setTransfer(null);
            setSelected(new Set());
            reload();
          }}
        />
      ) : null}
    </Screen>
  );
}

function rowStyle(active: boolean) {
  return {
    ...tapReset,
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    minHeight: 48,
    padding: '10px 2px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid var(--border-soft)',
    color: active ? 'var(--accent-cyan)' : 'var(--text-primary)',
    fontWeight: active ? 650 : 450,
    fontSize: 14,
  };
}

/* ------------------------------------------------------------- case card --- */

function CaseCard({
  tcase,
  selected,
  onToggle,
  onEdit,
}: {
  tcase: TrCase;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = stepsOf(tcase);

  return (
    <div
      style={{
        border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-soft)'}`,
        borderRadius: 12,
        background: 'var(--bg-panel)',
        padding: '10px 12px',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select case C${tcase.id}`}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7 }}>C{tcase.id}</div>
          <div style={{ fontSize: 14, lineHeight: 1.35, overflowWrap: 'anywhere', marginTop: 2 }}>{tcase.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
            {tcase.refs ? <Muted>{tcase.refs}</Muted> : null}
            <button
              className="btn"
              onClick={() => setOpen((v) => !v)}
              style={{ ...tapReset, minHeight: 34, padding: '0 12px', fontSize: 12 }}
            >
              {open ? 'Hide steps' : `Steps${steps.length ? ` (${steps.length})` : ''}`}
            </button>
            <button
              className="btn"
              onClick={onEdit}
              style={{ ...tapReset, minHeight: 34, padding: '0 12px', fontSize: 12 }}
            >
              Edit
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
          {tcase.preconds ? (
            <div style={{ marginBottom: 8 }}>
              <Muted>Preconditions</Muted>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{tcase.preconds}</div>
            </div>
          ) : null}
          {steps.length === 0 ? (
            <Muted>No steps recorded.</Muted>
          ) : (
            steps.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      background: 'var(--bg-panel-high)',
                      border: '1px solid var(--border-soft)',
                      fontSize: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1 }}>
                    {s.content}
                  </div>
                </div>
                {s.expected ? (
                  <div style={{ marginLeft: 30, marginTop: 4, fontSize: 12.5, color: 'var(--accent-green)', whiteSpace: 'pre-wrap' }}>
                    ✓ {s.expected}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- case editor --- */

function CaseEditorSheet({
  existing,
  sections,
  suites,
  allSuites,
  onClose,
  onSaved,
}: {
  existing: TrCase | null;
  sections: TrSection[];
  suites: TrSuite[];
  allSuites: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [refs, setRefs] = useState(existing?.refs ?? '');
  const [preconds, setPreconds] = useState(existing?.preconds ?? '');
  const [steps, setSteps] = useState<StepRow[]>(existing ? stepsOf(existing) : [{ content: '', expected: '' }]);
  const [sectionId, setSectionId] = useState<number | null>(existing?.sectionId ?? sections[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      pushToast({ title: 'Case', body: 'A title is required.', severity: 'error' });
      return;
    }
    const rows = steps.filter((s) => s.content.trim() || s.expected.trim());
    const payload: TrAddCasePayload = {
      title: title.trim(),
      typeId: existing?.typeId ?? null,
      priorityId: existing?.priorityId ?? null,
      estimate: existing?.estimate ?? null,
      refs: refs.trim() || null,
      description: null,
      preconds: preconds.trim() || null,
      steps: null,
      stepsSeparated: rows.length > 0 ? rows : null,
      expected: null,
      ownerId: null,
    };
    setBusy(true);
    try {
      if (existing) await trApi.updateCase(existing.id, payload);
      else {
        if (sectionId === null) {
          pushToast({ title: 'Case', body: 'Choose a section first.', severity: 'error' });
          return;
        }
        await trApi.addCase(sectionId, payload);
      }
      pushToast({ title: 'Case', body: existing ? 'Saved.' : 'Created.' });
      onSaved();
    } catch (e) {
      pushToast({ title: 'Case', body: e instanceof Error ? e.message : String(e), severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      title={existing ? `Edit C${existing.id}` : 'New case'}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void save()}
          style={{ ...tapReset, width: '100%', minHeight: 46, justifyContent: 'center' }}
        >
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create case'}
        </button>
      }
    >
      <Label>Title</Label>
      <Input value={title} onChange={setTitle} placeholder="What does this case verify?" />

      {existing ? null : (
        <>
          <Label>Section</Label>
          <select
            value={sectionId ?? ''}
            onChange={(e) => setSectionId(Number(e.target.value))}
            style={{
              width: '100%',
              minHeight: 44,
              borderRadius: 10,
              border: '1px solid var(--border-soft)',
              background: 'var(--input-bg)',
              color: 'var(--text-primary)',
              fontSize: 15,
              padding: '0 10px',
              marginBottom: 10,
            }}
          >
            {sections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sectionPath(sec.id, sections, suites, allSuites)}
              </option>
            ))}
          </select>
        </>
      )}

      <Label>References</Label>
      <Input value={refs} onChange={setRefs} placeholder="ISW-1234" />

      <Label>Preconditions</Label>
      <Area value={preconds} onChange={setPreconds} />

      <Label>Steps</Label>
      {steps.map((s, i) => (
        <div
          key={i}
          style={{ border: '1px solid var(--border-soft)', borderRadius: 10, padding: 10, marginBottom: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>Step {i + 1}</span>
            <button
              className="btn"
              onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
              style={{ ...tapReset, marginLeft: 'auto', minHeight: 34, padding: '0 10px', fontSize: 12, color: 'var(--accent-red)' }}
            >
              Remove
            </button>
          </div>
          <Area
            value={s.content}
            placeholder="Action"
            onChange={(v) => setSteps((prev) => prev.map((row, j) => (j === i ? { ...row, content: v } : row)))}
          />
          <Area
            value={s.expected}
            placeholder="Expected result"
            onChange={(v) => setSteps((prev) => prev.map((row, j) => (j === i ? { ...row, expected: v } : row)))}
          />
        </div>
      ))}
      <button
        className="btn"
        onClick={() => setSteps((prev) => [...prev, { content: '', expected: '' }])}
        style={{ ...tapReset, width: '100%', minHeight: 44, justifyContent: 'center', marginBottom: 8 }}
      >
        + Add step
      </button>
    </Sheet>
  );
}

/* -------------------------------------------------------------- transfer --- */

function TransferSheet({
  mode,
  ids,
  sections,
  suites,
  allSuites,
  onClose,
  onDone,
}: {
  mode: 'copy' | 'move';
  ids: number[];
  sections: TrSection[];
  suites: TrSuite[];
  allSuites: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<number | null>(sections[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (target === null) return;
    setBusy(true);
    try {
      if (mode === 'copy') await trApi.copyCases(target, ids);
      else {
        const suiteId = sections.find((s) => s.id === target)?.suiteId ?? null;
        await trApi.moveCases(target, suiteId, ids);
      }
      pushToast({ title: 'TestRail', body: `${ids.length} case(s) ${mode === 'copy' ? 'copied' : 'moved'}.` });
      onDone();
    } catch (e) {
      pushToast({ title: 'TestRail', body: e instanceof Error ? e.message : String(e), severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      title={`${mode === 'copy' ? 'Copy' : 'Move'} ${ids.length} case(s)`}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={busy || target === null}
          onClick={() => void go()}
          style={{ ...tapReset, width: '100%', minHeight: 46, justifyContent: 'center' }}
        >
          {busy ? 'Working…' : mode === 'copy' ? 'Copy here' : 'Move here'}
        </button>
      }
    >
      <Muted>Destination section — a section in another suite moves the cases across suites.</Muted>
      <div style={{ marginTop: 8 }}>
        {sections.map((sec) => (
          <button key={sec.id} onClick={() => setTarget(sec.id)} style={rowStyle(sec.id === target)}>
            {sectionPath(sec.id, sections, suites, allSuites)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- atoms --- */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', margin: '10px 0 4px' }}>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        minHeight: 44,
        padding: '0 12px',
        borderRadius: 10,
        border: '1px solid var(--border-soft)',
        background: 'var(--input-bg)',
        color: 'var(--text-primary)',
        fontSize: 15,
      }}
    />
  );
}

function Area({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      style={{
        width: '100%',
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--border-soft)',
        background: 'var(--input-bg)',
        color: 'var(--text-primary)',
        fontSize: 15,
        marginBottom: 6,
        resize: 'vertical',
      }}
    />
  );
}
