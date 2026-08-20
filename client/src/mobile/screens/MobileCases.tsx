// TestRail → Cases. Browse by section, read and edit steps, add cases, and
// copy or move a selection to another suite or section.
//
// The desktop screen is a fixed-layout table with a side tree and a column
// picker. Here the section is a picker, the list is cards, and everything that
// mutates happens in a bottom sheet — one job at a time, full width, with room
// to tap.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { trApi } from '../../api/testrail';
import {
  ensureCases,
  ensureSections,
  initTestRail,
  selectProject,
  selectSuite,
  setFilters,
  trStore,
} from '../../stores/testrail';
import { useStore } from '../../stores/useStore';
import { pushToast } from '../../stores/toasts';
import { filterCases, sectionPath } from '../../lib/testrail';
import type { TrAddCasePayload, TrCase, TrSection, TrSuite } from '../../testrailTypes';
import { invalidate, useCached } from '../cache';
import { Empty, ErrorNote, Loading, Muted, Screen, Sheet, tapReset } from '../ui';

interface StepRow {
  content: string;
  expected: string;
}

/** Section → subsection → cases. TrSection carries parentId, so the tree is
 *  reconstructed rather than flattened into paths. */
interface SectionNode {
  section: TrSection;
  children: SectionNode[];
  cases: TrCase[];
}

function buildTree(sections: TrSection[], cases: TrCase[]): { roots: SectionNode[]; orphans: TrCase[] } {
  const nodes = new Map<number, SectionNode>();
  for (const section of sections) nodes.set(section.id, { section, children: [], cases: [] });

  const orphans: TrCase[] = [];
  for (const c of cases) {
    const node = c.sectionId === null ? undefined : nodes.get(c.sectionId);
    if (node) node.cases.push(c);
    else orphans.push(c);
  }

  const roots: SectionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.section.parentId === null ? undefined : nodes.get(node.section.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const order = (a: SectionNode, b: SectionNode) => a.section.displayOrder - b.section.displayOrder;
  const sortDeep = (list: SectionNode[]) => {
    list.sort(order);
    for (const n of list) sortDeep(n.children);
  };
  sortDeep(roots);
  return { roots, orphans };
}

/**
 * Every case at or below each section, computed once for the whole tree.
 *
 * This used to be a recursive walk called from each branch's render. With 1472
 * sections and 3378 cases that is a subtree traversal per section per render,
 * which is what made Cases crawl. One post-order pass builds the lot.
 */
function buildSubtreeIndex(roots: SectionNode[]): Map<number, TrCase[]> {
  const index = new Map<number, TrCase[]>();
  const visit = (node: SectionNode): TrCase[] => {
    const all = [...node.cases];
    for (const child of node.children) all.push(...visit(child));
    index.set(node.section.id, all);
    return all;
  };
  for (const root of roots) visit(root);
  return index;
}

/** Does any case in this subtree match the search? Keeps parents visible. */
function matchesDeep(node: SectionNode, needle: string): boolean {
  if (!needle) return true; // no search: every branch is shown, no walk needed
  if (node.section.name.toLowerCase().includes(needle)) return true;
  if (node.cases.some((c) => c.title.toLowerCase().includes(needle) || String(c.id).includes(needle))) return true;
  return node.children.some((child) => matchesDeep(child, needle));
}

/**
 * Read the step rows off a case.
 *
 * The contract is asymmetric and it matters: TrStep (what the API returns) is
 * {index, action, expected}, while TrAddCasePayload (what you send back) takes
 * {content, expected}. Reading `content` therefore always yielded undefined,
 * which is why cases showed a step count and an expected result with no
 * action against it.
 */
function stepsOf(c: TrCase): StepRow[] {
  if (Array.isArray(c.stepsSeparated) && c.stepsSeparated.length > 0) {
    return c.stepsSeparated.map((r) => ({ content: r.action ?? '', expected: r.expected ?? '' }));
  }
  // Older cases carry a single free-text steps field instead of rows.
  if (c.steps) return [{ content: c.steps, expected: c.expected ?? '' }];
  return [];
}

export function MobileCases() {
  const st = useStore(trStore);

  // The store starts at 'idle', not 'disconnected'. Booting only from the
  // disconnected branch meant a fresh mount never loaded anything and the
  // project list came up empty.
  useEffect(() => {
    void initTestRail();
  }, []);
  const [query, setQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const allCases = res.data?.cases ?? [];
  const sections = res.data?.sections ?? [];
  const needle = query.trim().toLowerCase();

  /** id → display name, the same resolution the desktop filter uses. */
  const nameOf = useCallback(
    (id: number | null) => {
      if (id === null) return '';
      return st.people[String(id)] ?? st.meta?.users.find((u) => u.id === id)?.name ?? '';
    },
    [st.people, st.meta],
  );

  // filterCases is the desktop's own function, so owner/assignee/title behave
  // identically on both clients rather than being reimplemented here.
  const cases = useMemo(
    () =>
      filterCases(
        allCases,
        {
          title: st.filters.titleContains,
          ownerText: st.filters.ownerText,
          assigneeText: st.filters.assigneeText,
          neverRan: false,
          coverage: null,
          sectionIds: null,
          sectionPathById: null,
        },
        nameOf,
      ),
    [allCases, st.filters, nameOf],
  );

  const activeFilters =
    (st.filters.titleContains.trim() ? 1 : 0) +
    (st.filters.ownerText.trim() ? 1 : 0) +
    (st.filters.assigneeText.trim() ? 1 : 0);

  const { roots, orphans } = useMemo(() => buildTree(sections, cases), [sections, cases]);
  const subtreeIndex = useMemo(() => buildSubtreeIndex(roots), [roots]);
  const visibleCaseIds = useMemo(() => cases.map((c) => c.id), [cases]);

  if (st.phase === 'idle' || st.phase === 'loading') {
    return (
      <Screen kicker="TestRail" title="Cases">
        <Loading what="Connecting to TestRail" />
      </Screen>
    );
  }

  if (st.phase === 'disconnected') {
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

  const project = st.projects.find((p) => p.id === st.projectId);
  const suiteLabel =
    st.selSuiteId === 'all'
      ? 'All suites'
      : (st.suites.find((x) => x.id === st.selSuiteId)?.name ?? 'Suite');
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <PickerButton label={project ? project.name : 'Project'} onClick={() => setProjectOpen(true)} />
        <PickerButton label={suiteLabel} onClick={() => setSuiteOpen(true)} />
        <PickerButton
          label={activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
          onClick={() => setFiltersOpen(true)}
        />
      </div>

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

      {/* Selection bar. Always visible so "select all" is reachable before
          anything is ticked — previously the only way in was to find and tap a
          checkbox first. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          className="btn"
          onClick={() => {
            setSelected((prev) => (prev.size >= visibleCaseIds.length ? new Set() : new Set(visibleCaseIds)));
          }}
          style={{ ...tapReset, flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13 }}
        >
          {selCount > 0 ? `Clear (${selCount})` : 'Select all'}
        </button>
        <button
          className="btn"
          disabled={selCount === 0}
          onClick={() => setTransfer('copy')}
          style={{ ...tapReset, flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13 }}
        >
          Copy…
        </button>
        <button
          className="btn"
          disabled={selCount === 0}
          onClick={() => setTransfer('move')}
          style={{ ...tapReset, flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13 }}
        >
          Move…
        </button>
      </div>

      {res.error ? <ErrorNote onRetry={reload}>{res.error}</ErrorNote> : null}
      {res.loading ? <Loading what="Loading cases" /> : null}
      {res.data && roots.length === 0 && orphans.length === 0 ? <Empty>No cases match.</Empty> : null}

      {roots
        .filter((node) => matchesDeep(node, needle))
        .map((node) => (
          <SectionBranch
            key={node.section.id}
            node={node}
            subtreeIndex={subtreeIndex}
            needle={needle}
            depth={0}
            selected={selected}
            setSelected={setSelected}
            onEdit={(c) => setEditing({ existing: c })}
            onTransfer={(mode, ids) => {
              setSelected(new Set(ids));
              setTransfer(mode);
            }}
          />
        ))}

      {orphans.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <Muted>Cases with no section</Muted>
          {orphans.map((c) => (
            <CaseCard
              key={c.id}
              tcase={c}
              selected={selected.has(c.id)}
              onToggle={() => toggleOne(setSelected, c.id)}
              onEdit={() => setEditing({ existing: c })}
              onTransfer={(mode) => {
                setSelected(new Set([c.id]));
                setTransfer(mode);
              }}
            />
          ))}
        </div>
      ) : null}

      <Sheet open={projectOpen} title="Project" onClose={() => setProjectOpen(false)}>
        {st.projects.map((p) => (
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

      <Sheet
        open={filtersOpen}
        title="Filters"
        onClose={() => setFiltersOpen(false)}
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              style={{ ...tapReset, flex: 1, minHeight: 44, justifyContent: 'center' }}
              onClick={() => setFilters({ titleContains: '', ownerText: '', assigneeText: '' })}
            >
              Clear
            </button>
            <button
              className="btn btn-primary"
              style={{ ...tapReset, flex: 2, minHeight: 44, justifyContent: 'center' }}
              onClick={() => setFiltersOpen(false)}
            >
              Done
            </button>
          </div>
        }
      >
        <Label>Title contains</Label>
        <Input
          value={st.filters.titleContains}
          onChange={(v) => setFilters({ titleContains: v })}
          placeholder="Any title"
        />
        <Label>Owner</Label>
        <Input value={st.filters.ownerText} onChange={(v) => setFilters({ ownerText: v })} placeholder="Any owner" />
        <Label>Assigned to</Label>
        <Input
          value={st.filters.assigneeText}
          onChange={(v) => setFilters({ assigneeText: v })}
          placeholder="Anyone"
        />
        <div style={{ marginTop: 12 }}>
          <Muted>
            {cases.length} of {allCases.length} cases match.
          </Muted>
        </div>
      </Sheet>

      <Sheet open={suiteOpen} title="Suite" onClose={() => setSuiteOpen(false)}>
        <button
          onClick={() => {
            selectSuite('all');
            setSuiteOpen(false);
          }}
          style={rowStyle(st.selSuiteId === 'all')}
        >
          All suites
        </button>
        {st.suites.map((su) => (
          <button
            key={su.id}
            onClick={() => {
              selectSuite(su.id);
              setSuiteOpen(false);
            }}
            style={rowStyle(su.id === st.selSuiteId)}
          >
            {su.name}
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
          sourceSections={sections}
          sourceCases={cases}
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

function toggleOne(
  setSelected: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>,
  id: number,
): void {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

/**
 * One section and everything beneath it. Collapsible, and its checkbox covers
 * the whole subtree — ticking a section selects its subsections' cases too,
 * which is what "move the section" means in practice.
 */
/** Cases drawn per section before "show all" — keeps a 3000-case suite cheap. */
const CASE_PAGE = 40;

function SectionBranch({
  node,
  subtreeIndex,
  needle,
  depth,
  selected,
  setSelected,
  onEdit,
  onTransfer,
}: {
  node: SectionNode;
  subtreeIndex: Map<number, TrCase[]>;
  needle: string;
  depth: number;
  selected: ReadonlySet<number>;
  setSelected: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>;
  onEdit: (c: TrCase) => void;
  onTransfer: (mode: 'copy' | 'move', ids: number[]) => void;
}) {
  // Collapsed by default. Expanding everything meant mounting thousands of
  // cards before the screen could paint; a search expands what it matches.
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(CASE_PAGE);
  const expanded = open || needle.length > 0;
  const subtree = subtreeIndex.get(node.section.id) ?? [];
  const allSelected = subtree.length > 0 && subtree.every((c) => selected.has(c.id));
  const shownCases = needle
    ? node.cases.filter((c) => c.title.toLowerCase().includes(needle) || String(c.id).includes(needle))
    : node.cases;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 10, marginBottom: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          background: depth === 0 ? 'var(--bg-panel-high)' : 'transparent',
          border: '1px solid var(--border-soft)',
          borderLeft: `3px solid ${depth === 0 ? 'var(--accent-cyan)' : 'var(--border-strong)'}`,
          borderRadius: 9,
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          aria-label={`Select all cases in ${node.section.name}`}
          onChange={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const c of subtree) {
                if (allSelected) next.delete(c.id);
                else next.add(c.id);
              }
              return next;
            })
          }
          style={{ flexShrink: 0 }}
        />
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            ...tapReset,
            flex: 1,
            minWidth: 0,
            minHeight: 38,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontWeight: depth === 0 ? 650 : 500,
            overflowWrap: 'anywhere',
          }}
        >
          {open ? '▼' : '▶'} {node.section.name}{' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {subtree.length}</span>
        </button>
        <button
          className="btn"
          disabled={subtree.length === 0}
          onClick={() => onTransfer('copy', subtree.map((c) => c.id))}
          style={{ ...tapReset, minHeight: 32, padding: '0 8px', fontSize: 11 }}
        >
          Copy
        </button>
        <button
          className="btn"
          disabled={subtree.length === 0}
          onClick={() => onTransfer('move', subtree.map((c) => c.id))}
          style={{ ...tapReset, minHeight: 32, padding: '0 8px', fontSize: 11 }}
        >
          Move
        </button>
      </div>

      {expanded ? (
        <div style={{ marginTop: 6, marginLeft: 8 }}>
          {node.children
            .filter((child) => matchesDeep(child, needle))
            .map((child) => (
              <SectionBranch
                key={child.section.id}
                node={child}
                subtreeIndex={subtreeIndex}
                needle={needle}
                depth={depth + 1}
                selected={selected}
                setSelected={setSelected}
                onEdit={onEdit}
                onTransfer={onTransfer}
              />
            ))}
          {shownCases.slice(0, limit).map((c) => (
            <CaseCard
              key={c.id}
              tcase={c}
              selected={selected.has(c.id)}
              onToggle={() => toggleOne(setSelected, c.id)}
              onEdit={() => onEdit(c)}
              onTransfer={(mode) => onTransfer(mode, [c.id])}
            />
          ))}
          {shownCases.length > limit ? (
            <button
              className="btn"
              onClick={() => setLimit((n) => n + CASE_PAGE * 4)}
              style={{ ...tapReset, width: '100%', minHeight: 40, justifyContent: 'center', fontSize: 12 }}
            >
              Show more · {shownCases.length - limit} left
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PickerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...tapReset,
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        textAlign: 'left',
        padding: '0 12px',
        border: '1px solid var(--border-soft)',
        borderRadius: 10,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        fontSize: 13,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label} ›
    </button>
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
  onTransfer,
}: {
  tcase: TrCase;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onTransfer: (mode: 'copy' | 'move') => void;
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
            <button
              className="btn"
              onClick={() => onTransfer('copy')}
              style={{ ...tapReset, minHeight: 34, padding: '0 12px', fontSize: 12 }}
            >
              Copy
            </button>
            <button
              className="btn"
              onClick={() => onTransfer('move')}
              style={{ ...tapReset, minHeight: 34, padding: '0 12px', fontSize: 12 }}
            >
              Move
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

/**
 * Destination picker for copy and move.
 *
 * The first version only listed sections of the suite already on screen, so
 * there was no way to send a case to another suite — let alone another
 * project. This walks the real hierarchy: project, then suite, then section,
 * each loaded on demand. Projects are the Indigo-scoped set, the same list the
 * screen's own picker shows — the account can see far more, and offering them
 * as destinations only makes the list hard to search.
 */
function TransferSheet({
  mode,
  ids,
  sourceSections,
  sourceCases,
  onClose,
  onDone,
}: {
  mode: 'copy' | 'move';
  ids: number[];
  sourceSections: TrSection[];
  sourceCases: TrCase[];
  onClose: () => void;
  onDone: () => void;
}) {
  const st = useStore(trStore);
  const [keepStructure, setKeepStructure] = useState(true);
  const [projectId, setProjectId] = useState<number | null>(st.projectId);
  const [suiteId, setSuiteId] = useState<number | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [suites, setSuites] = useState<TrSuite[] | null>(null);
  const [sections, setSections] = useState<TrSection[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Suites for the chosen project.
  useEffect(() => {
    let live = true;
    setSuites(null);
    setSuiteId(null);
    setSections(null);
    setSectionId(null);
    if (projectId === null) return;
    void trApi
      .suites(projectId)
      .then((list) => {
        if (!live) return;
        setSuites(list);
        setSuiteId(list[0]?.id ?? null);
      })
      .catch(() => live && setSuites([]));
    return () => {
      live = false;
    };
  }, [projectId]);

  // Sections for the chosen suite.
  useEffect(() => {
    let live = true;
    setSections(null);
    setSectionId(null);
    if (projectId === null || suiteId === null) return;
    void trApi
      .sections(projectId, suiteId)
      .then((list) => {
        if (!live) return;
        setSections(list);
        setSectionId(list[0]?.id ?? null);
      })
      .catch(() => live && setSections([]));
    return () => {
      live = false;
    };
  }, [projectId, suiteId]);

  /**
   * With structure on, the source sections holding the selected cases are
   * recreated under the destination — parents before children — and each case
   * lands in its own recreated section. TestRail's move_section cannot cross
   * suites or projects, so rebuilding the shape and moving the cases is the
   * only way to relocate a whole section elsewhere.
   */
  const go = async () => {
    if (sectionId === null || projectId === null) return;
    setBusy(true);
    try {
      const chosen = new Set(ids);
      const involved = new Set<number>();
      for (const c of sourceCases) {
        if (chosen.has(c.id) && c.sectionId !== null) involved.add(c.sectionId);
      }

      if (!keepStructure || involved.size <= 1) {
        if (mode === 'copy') await trApi.copyCases(sectionId, ids);
        else await trApi.moveCases(sectionId, suiteId, ids);
      } else {
        const byId = new Map(sourceSections.map((sec) => [sec.id, sec]));
        // Parents first, so a child's new parent already exists.
        const ordered = [...involved]
          .map((id) => byId.get(id))
          .filter((sec): sec is TrSection => sec !== undefined)
          .sort((a, b) => a.depth - b.depth);

        const created = new Map<number, number>();
        for (const sec of ordered) {
          const parentNew = sec.parentId !== null ? created.get(sec.parentId) : undefined;
          const made = await trApi.addSection(projectId, {
            suiteId,
            parentId: parentNew ?? sectionId,
            name: sec.name,
            description: null,
          });
          created.set(sec.id, made.id);
        }

        for (const sec of ordered) {
          const target = created.get(sec.id);
          if (target === undefined) continue;
          const batch = sourceCases.filter((c) => chosen.has(c.id) && c.sectionId === sec.id).map((c) => c.id);
          if (batch.length === 0) continue;
          if (mode === 'copy') await trApi.copyCases(target, batch);
          else await trApi.moveCases(target, suiteId, batch);
        }
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
          disabled={busy || sectionId === null}
          onClick={() => void go()}
          style={{ ...tapReset, width: '100%', minHeight: 46, justifyContent: 'center' }}
        >
          {busy ? 'Working…' : mode === 'copy' ? 'Copy here' : 'Move here'}
        </button>
      }
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 48,
          padding: '4px 2px',
          borderBottom: '1px solid var(--border-soft)',
        }}
      >
        <input type="checkbox" checked={keepStructure} onChange={(e) => setKeepStructure(e.target.checked)} />
        <span style={{ fontSize: 14 }}>
          Recreate section structure
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            Off: every case lands directly in the chosen section.
          </div>
        </span>
      </label>

      <Label>Project</Label>
      <Picker
        value={projectId}
        options={st.projects.map((p) => ({ id: p.id, label: p.name }))}
        onChange={setProjectId}
      />

      <Label>Suite</Label>
      {suites === null ? (
        <Muted>Loading suites…</Muted>
      ) : suites.length === 0 ? (
        <Muted>No suites in this project.</Muted>
      ) : (
        <Picker value={suiteId} options={suites.map((x) => ({ id: x.id, label: x.name }))} onChange={setSuiteId} />
      )}

      <Label>Section</Label>
      {sections === null ? (
        <Muted>Loading sections…</Muted>
      ) : sections.length === 0 ? (
        <Muted>No sections in this suite.</Muted>
      ) : (
        <div style={{ maxHeight: '38vh', overflowY: 'auto' }}>
          {sections.map((sec) => (
            <button key={sec.id} onClick={() => setSectionId(sec.id)} style={rowStyle(sec.id === sectionId)}>
              {'\u00a0'.repeat(Math.max(0, (sec.depth ?? 0) * 2))}
              {sec.name}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function Picker({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: Array<{ id: number; label: string }>;
  onChange: (id: number) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: '100%',
        minHeight: 44,
        borderRadius: 10,
        border: '1px solid var(--border-soft)',
        background: 'var(--input-bg)',
        color: 'var(--text-primary)',
        fontSize: 15,
        padding: '0 10px',
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
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
