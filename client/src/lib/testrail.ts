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
    list = list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        String(c.id) === idQ ||
        (c.refs ?? '').toLowerCase().includes(q) ||
        (c.steps ?? '').toLowerCase().includes(q) ||
        c.stepsSeparated.some((s) => `${s.action} ${s.expected}`.toLowerCase().includes(q)),
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
