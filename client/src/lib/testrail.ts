// Pure TestRail view logic (Phase 3 — unified-deck plan T14). Ports of the
// Railbook SPA helpers (C:\APPS\TestRailWeb\wwwroot\js\app.js) kept free of
// DOM access so they run under vitest.

import type { TrCase, TrSection, TrSuite } from '../testrailTypes';

// ---------------------------------------------------------------------------
// rich text — TestRail fields carry raw HTML; flatten to readable plain text
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function richText(s: string | null | undefined): string {
  if (!s) return '';
  const t = String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

/** Full breadcrumb "parent / child"; in all-suites mode prefixed with ⟨suite⟩. */
export function sectionPath(
  sectionId: number,
  sections: TrSection[],
  suites: TrSuite[] = [],
  allMode = false,
): string {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const first = byId.get(sectionId);
  const parts: string[] = [];
  let cur = first;
  let guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift(cur.name);
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  if (allMode && first?.suiteId != null) {
    const suite = suites.find((su) => su.id === first.suiteId);
    if (suite) parts.unshift(`⟨${suite.name}⟩`);
  }
  return parts.join(' / ') || `section ${sectionId}`;
}

/** The section plus every (transitive) subsection id. */
export function sectionDescendants(sectionId: number, sections: TrSection[]): Set<number> {
  const out = new Set<number>([sectionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of sections) {
      if (s.parentId != null && out.has(s.parentId) && !out.has(s.id)) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Rows of the collapsible section tree: sections in displayOrder, keeping only
 * those whose every ancestor is in `expanded` (top-level rows always show).
 */
export function visibleSections(sections: TrSection[], expanded: ReadonlySet<number>): TrSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const out: TrSection[] = [];
  for (const s of [...sections].sort((a, b) => a.displayOrder - b.displayOrder)) {
    let cur = s.parentId != null ? byId.get(s.parentId) : undefined;
    let guard = 0;
    let show = true;
    while (cur && guard++ < 20) {
      if (!expanded.has(cur.id)) {
        show = false;
        break;
      }
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    }
    if (show) out.push(s);
  }
  return out;
}

/** Ids of sections that have at least one subsection. */
export function sectionHasChildren(sections: TrSection[]): Set<number> {
  const out = new Set<number>();
  for (const s of sections) if (s.parentId != null) out.add(s.parentId);
  return out;
}

/** Direct + descendant case count per section (deepest levels roll upward). */
export function subtreeCaseCounts(
  sections: TrSection[],
  direct: ReadonlyMap<number, number>,
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const s of [...sections].sort((a, b) => b.depth - a.depth)) {
    const total = (direct.get(s.id) ?? 0) + (totals.get(s.id) ?? 0);
    totals.set(s.id, total);
    if (s.parentId != null) totals.set(s.parentId, (totals.get(s.parentId) ?? 0) + total);
  }
  return totals;
}

export interface CasesTableRow<TCase> {
  section: TrSection;
  /** Cases painted directly under this header (empty when collapsed or for
   *  ancestor-only headers). */
  cases: TCase[];
  /** Cases directly in this section before collapse hiding. */
  directCount: number;
  /** Direct + descendant case count (of the filtered set). */
  subtreeCount: number;
  /** This section's own collapse-toggle state. */
  collapsed: boolean;
}

/**
 * Nested header plan for the cases table: each leaf group is preceded by
 * header rows for any ancestors not already emitted, so the table reads
 * section → subsection → cases. A collapsed section keeps its own row but
 * hides everything beneath it.
 */
export function casesTableRows<TCase>(
  groups: Array<{ sectionId: number; cases: TCase[] }>,
  sections: TrSection[],
  collapsed: ReadonlySet<number>,
): Array<CasesTableRow<TCase>> {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const chainOf = (id: number): TrSection[] => {
    const out: TrSection[] = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 20) {
      out.unshift(cur);
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };

  const subtree = new Map<number, number>();
  const chains = new Map<number, TrSection[]>();
  for (const g of groups) {
    const chain = chainOf(g.sectionId);
    chains.set(g.sectionId, chain);
    for (const s of chain) subtree.set(s.id, (subtree.get(s.id) ?? 0) + g.cases.length);
  }

  const rows: Array<CasesTableRow<TCase>> = [];
  let prev: TrSection[] = [];
  for (const g of groups) {
    const chain = chains.get(g.sectionId) as TrSection[];
    if (chain.length === 0) {
      // Case rows whose section the suite does not know — keep them visible.
      rows.push({
        section: {
          id: g.sectionId,
          suiteId: null,
          parentId: null,
          name: `Section ${g.sectionId}`,
          depth: 0,
          displayOrder: Number.MAX_SAFE_INTEGER,
        },
        cases: collapsed.has(g.sectionId) ? [] : g.cases,
        directCount: g.cases.length,
        subtreeCount: g.cases.length,
        collapsed: collapsed.has(g.sectionId),
      });
      prev = [];
      continue;
    }

    let firstNew = 0;
    while (
      firstNew < chain.length - 1 &&
      firstNew < prev.length &&
      prev[firstNew].id === chain[firstNew].id
    ) {
      firstNew++;
    }
    prev = chain;

    // A collapsed ancestor hides every deeper row (including this group).
    const hiddenFrom = chain.findIndex((s, i) => i < chain.length - 1 && collapsed.has(s.id));

    for (let i = firstNew; i < chain.length; i++) {
      if (hiddenFrom !== -1 && i > hiddenFrom) break;
      const s = chain[i];
      const isLeaf = i === chain.length - 1;
      rows.push({
        section: s,
        cases: isLeaf && !collapsed.has(s.id) ? g.cases : [],
        directCount: isLeaf ? g.cases.length : 0,
        subtreeCount: subtree.get(s.id) ?? 0,
        collapsed: collapsed.has(s.id),
      });
    }
  }
  return rows;
}

export interface SectionGroup {
  sectionId: number;
  cases: TrCase[];
}

/**
 * Group cases by section, ordered by the sections' displayOrder; cases whose
 * section is unknown (or null → 0) are appended after the known sections.
 */
export function groupCasesBySection(cases: TrCase[], sections: TrSection[]): SectionGroup[] {
  const secOrder = [...sections].sort((a, b) => a.displayOrder - b.displayOrder).map((s) => s.id);
  const bySec = new Map<number, TrCase[]>();
  for (const c of cases) {
    const key = c.sectionId ?? 0;
    const list = bySec.get(key);
    if (list) list.push(c);
    else bySec.set(key, [c]);
  }
  const orderedIds = [
    ...secOrder.filter((id) => bySec.has(id)),
    ...[...bySec.keys()].filter((id) => !secOrder.includes(id)),
  ];
  return orderedIds.map((id) => ({ sectionId: id, cases: bySec.get(id) as TrCase[] }));
}

// ---------------------------------------------------------------------------
// filtering
// ---------------------------------------------------------------------------

export interface CaseFilterSpec {
  /** Title/id/refs/steps substring ("C123" or "123" match the id exactly). */
  title?: string;
  /** Substring over the resolved owner display name. */
  ownerText?: string;
  /** Substring over the resolved assignee display name. */
  assigneeText?: string;
  /** Keep only cases NOT present in `coverage` (never-ran analysis). */
  neverRan?: boolean;
  /** Covered case ids from the never-ran analysis. */
  coverage?: ReadonlySet<number> | null;
  /** Restrict to these section ids (typically a section + its descendants). */
  sectionIds?: ReadonlySet<number> | null;
  /**
   * Lower-cased full section path per section id ("isw-7554 ... / manual").
   * When given, the title query also matches cases whose section path
   * contains it — searching a section name surfaces the whole section.
   */
  sectionPathById?: ReadonlyMap<number, string> | null;
}

export function filterCases(
  cases: TrCase[],
  spec: CaseFilterSpec,
  peopleName: (id: number | null) => string,
): TrCase[] {
  let list = cases;
  if (spec.sectionIds) {
    const ids = spec.sectionIds;
    list = list.filter((c) => c.sectionId != null && ids.has(c.sectionId));
  }
  const ownerQ = (spec.ownerText ?? '').trim().toLowerCase();
  if (ownerQ) {
    list = list.filter((c) => peopleName(c.ownerId).toLowerCase().includes(ownerQ));
  }
  const assigneeQ = (spec.assigneeText ?? '').trim().toLowerCase();
  if (assigneeQ) {
    list = list.filter((c) => peopleName(c.assignedToId).toLowerCase().includes(assigneeQ));
  }
  if (spec.neverRan && spec.coverage) {
    const covered = spec.coverage;
    list = list.filter((c) => !covered.has(c.id));
  }
  const q = (spec.title ?? '').trim().toLowerCase();
  if (q) {
    const idQ = q.replace(/^c/i, '');
    const paths = spec.sectionPathById;
    list = list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        String(c.id) === idQ ||
        (c.refs ?? '').toLowerCase().includes(q) ||
        (c.steps ?? '').toLowerCase().includes(q) ||
        c.stepsSeparated.some((s) => `${s.action} ${s.expected}`.toLowerCase().includes(q)) ||
        (paths != null && c.sectionId != null && (paths.get(c.sectionId) ?? '').includes(q)),
    );
  }
  return list;
}

// ---------------------------------------------------------------------------
// run creation — dynamic case filtering
// ---------------------------------------------------------------------------

export interface RunCaseFilter {
  /** Selected section ids; descendants are included automatically. */
  sectionIds?: number[];
  priorityId?: number | null;
  ownerId?: number | null;
  titleContains?: string;
}

/**
 * Resolve a dynamic run filter to the matching cases. TestRail's add_run
 * snapshots explicit case_ids at creation time, so the caller sends these ids
 * with include_all=false — future cases are NOT auto-added.
 */
export function resolveRunCaseFilter(cases: TrCase[], sections: TrSection[], filter: RunCaseFilter): TrCase[] {
  let list = cases;
  if (filter.sectionIds && filter.sectionIds.length > 0) {
    const ids = new Set<number>();
    for (const sid of filter.sectionIds) {
      for (const d of sectionDescendants(sid, sections)) ids.add(d);
    }
    list = list.filter((c) => c.sectionId != null && ids.has(c.sectionId));
  }
  if (filter.priorityId != null) list = list.filter((c) => c.priorityId === filter.priorityId);
  if (filter.ownerId != null) list = list.filter((c) => c.ownerId === filter.ownerId);
  const q = (filter.titleContains ?? '').trim().toLowerCase();
  if (q) list = list.filter((c) => c.title.toLowerCase().includes(q));
  return list;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export interface CaseCsvNames {
  priority: (id: number | null) => string;
  type: (id: number | null) => string;
}

/** CRLF-joined CSV matching the Railbook export columns (no trailing newline). */
export function csvForCases(cases: TrCase[], sections: TrSection[], names: CaseCsvNames): string {
  const byId = new Map(sections.map((s) => [s.id, s.name]));
  const secName = (id: number | null) => (id != null ? (byId.get(id) ?? '') : '');
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['ID', 'Title', 'Section', 'Priority', 'Type', 'Refs', 'Estimate'].join(','),
    ...cases.map((c) =>
      [
        `C${c.id}`,
        q(c.title),
        q(secName(c.sectionId)),
        q(names.priority(c.priorityId)),
        q(names.type(c.typeId)),
        q(c.refs),
        q(c.estimate),
      ].join(','),
    ),
  ];
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// steps serialization (case editor → API text form)
// ---------------------------------------------------------------------------

/**
 * The API's AddCasePayload carries steps as a plain text field; steps_separated
 * survive round-trips only when the template supports them — send text form:
 * "1. …\n   Expected: …".
 */
export function stepsToText(steps: Array<{ action: string; expected: string }>): string {
  return steps
    .filter((s) => s.action.trim() || s.expected.trim())
    .map((s, i) => `${i + 1}. ${s.action.trim()}${s.expected.trim() ? `\n   Expected: ${s.expected.trim()}` : ''}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// run aggregates
// ---------------------------------------------------------------------------

export interface RunCounts {
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  retestCount: number;
  untestedCount: number;
}

export function aggregateCounts(runs: RunCounts[]): RunCounts {
  return runs.reduce(
    (a, r) => ({
      passedCount: a.passedCount + r.passedCount,
      failedCount: a.failedCount + r.failedCount,
      blockedCount: a.blockedCount + r.blockedCount,
      retestCount: a.retestCount + r.retestCount,
      untestedCount: a.untestedCount + r.untestedCount,
    }),
    { passedCount: 0, failedCount: 0, blockedCount: 0, retestCount: 0, untestedCount: 0 },
  );
}

export function totalCount(r: RunCounts): number {
  return r.passedCount + r.failedCount + r.blockedCount + r.retestCount + r.untestedCount;
}

/** "82%" or "—" when the run has no tests. */
export function passPct(r: RunCounts): string {
  const total = totalCount(r);
  if (!total) return '—';
  return `${Math.round((r.passedCount / total) * 100)}%`;
}

export function fmtUnixDate(unix: number | null | undefined): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// stale-while-revalidate throttle
// ---------------------------------------------------------------------------

/** Minimum gap between background revalidations of one suite's cases/sections. */
export const SWR_REVALIDATE_MS = 60_000;

/** True when a suite-keyed cache entry is old enough to revalidate in the
 *  background (or has never been fetched this session). */
export function swrDue(lastAt: number | undefined, now: number, interval = SWR_REVALIDATE_MS): boolean {
  return lastAt === undefined || now - lastAt >= interval;
}

// ---------------------------------------------------------------------------
// never-ran coverage
// ---------------------------------------------------------------------------

/** TestRail system status: the test exists in a run but was never executed. */
export const UNTESTED_STATUS_ID = 3;

/** Case ids that actually ran. An include_all run auto-adds every new case as
 *  Untested, so mere run membership must not count as coverage. */
export function ranCaseIds(tests: Array<{ caseId: number; statusId: number }>): number[] {
  return tests.filter((t) => t.statusId !== UNTESTED_STATUS_ID).map((t) => t.caseId);
}

/** True when any case points at a section id absent from the section list —
 *  the case list outran the section list (fresh upload mid-view). */
export function hasUnknownSection(
  cases: Array<{ sectionId: number | null }>,
  sections: Array<{ id: number }>,
): boolean {
  const known = new Set(sections.map((s) => s.id));
  return cases.some((c) => c.sectionId != null && !known.has(c.sectionId));
}
