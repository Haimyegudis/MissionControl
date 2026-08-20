// TestRail client state (Phase 3 — unified-deck plan T13). Hand-rolled store
// following stores/session.ts conventions: one observable state object,
// module-level async actions, localStorage persistence for UI preferences.

import { trApi } from '../api/testrail';
import { isNativeApp } from '../native/platform';
import type {
  TrCase,
  TrMeta,
  TrPlanRun,
  TrProject,
  TrRun,
  TrSection,
  TrSessionStatus,
  TrSuite,
} from '../testrailTypes';
import { createStore } from './store';
import { pushToast } from './toasts';

export type TrPhase = 'idle' | 'loading' | 'connected' | 'disconnected';
export type SuiteSel = number | 'all';

export interface CoverageInfo {
  covered: ReadonlySet<number>;
  runsAnalyzed: number;
  totalRuns: number;
}

export interface TrFilters {
  titleContains: string;
  ownerText: string;
  assigneeText: string;
  showNeverRan: boolean;
}

export interface TrColumnConfig {
  visible: string[];
  widths: Record<string, number>;
}

export interface TestRailState {
  phase: TrPhase;
  session: TrSessionStatus | null;
  meta: TrMeta | null;
  people: Record<string, string>;
  /** Every project visible to the account (transfer targets). */
  allProjects: TrProject[];
  /** Indigo-scoped working set (falls back to all when nothing matches). */
  projects: TrProject[];
  projectId: number | null;
  suites: TrSuite[];
  sections: Record<number, TrSection[] | undefined>;
  cases: Record<number, TrCase[] | undefined>;
  runs: TrRun[];
  runsLoaded: boolean;
  planRuns: TrPlanRun[] | null;
  selSuiteId: SuiteSel | null;
  selSectionId: number | null;
  caseSel: ReadonlySet<number>;
  collapsedSecs: ReadonlySet<number>;
  filters: TrFilters;
  /** suiteId → never-ran analysis result. */
  coverage: Record<number, CoverageInfo | undefined>;
  cols: TrColumnConfig;
  treeHidden: boolean;
  /** Case the palette asked to open once the Case Library has its data. */
  openCaseId: number | null;
}

// Column defaults mirror Railbook's CASE_COLS visibility.
export const DEFAULT_VISIBLE_COLS = ['id', 'title', 'priority', 'owner', 'assigned', 'refs', 'updated'];

const LS_FILTERS = 'deck.tr.filters';
const LS_COLS = 'deck.tr.cols';
const LS_COLW = 'deck.tr.colw';
const LS_TREE = 'deck.tr.treehidden';
const LS_PROJECT = 'deck.tr.project';
const LS_SUITE = 'deck.tr.suite';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const trStore = createStore<TestRailState>({
  phase: 'idle',
  session: null,
  meta: null,
  people: {},
  allProjects: [],
  projects: [],
  projectId: null,
  suites: [],
  sections: {},
  cases: {},
  runs: [],
  runsLoaded: false,
  planRuns: null,
  selSuiteId: null,
  selSectionId: null,
  caseSel: new Set(),
  collapsedSecs: new Set(),
  // Filters survive navigation and reloads (coverage stays session-local).
  filters: {
    ...{ titleContains: '', ownerText: '', assigneeText: '', showNeverRan: false },
    ...readJson<Partial<TrFilters>>(LS_FILTERS, {}),
    showNeverRan: false,
  },
  coverage: {},
  cols: {
    visible: readJson<string[]>(LS_COLS, DEFAULT_VISIBLE_COLS),
    widths: readJson<Record<string, number>>(LS_COLW, {}),
  },
  treeHidden: typeof localStorage !== 'undefined' && localStorage.getItem(LS_TREE) === '1',
  openCaseId: null,
});

function patch(partial: Partial<TestRailState>): void {
  trStore.set((prev) => ({ ...prev, ...partial }));
}

// ---------------------------------------------------------------------------
// boot / session
// ---------------------------------------------------------------------------

/** Indigo-only scope: name match plus Ramon (603), an Indigo-series project
 *  without "Indigo" in its name. Falls back to all when nothing matches. */
export function filterIndigoProjects(projects: TrProject[]): TrProject[] {
  const indigo = projects.filter((p) => /indigo/i.test(p.name) || p.id === 603);
  return indigo.length ? indigo : projects;
}

let initPromise: Promise<void> | null = null;

/** Idempotent boot: session → people/projects/meta → project scaffold. */
export function initTestRail(force = false): Promise<void> {
  const phase = trStore.get().phase;
  if (!force && (phase === 'connected' || phase === 'loading')) return initPromise ?? Promise.resolve();
  initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  patch({ phase: 'loading' });
  let session: TrSessionStatus;
  try {
    session = await trApi.session();
  } catch {
    patch({ phase: 'disconnected', session: null });
    return;
  }
  if (!session.connected) {
    patch({ phase: 'disconnected', session });
    return;
  }
  await afterConnect(session);
}

async function afterConnect(session: TrSessionStatus): Promise<void> {
  try {
    const [people, allProjects] = await Promise.all([
      trApi.people().catch(() => ({}) as Record<string, string>),
      trApi.projects(),
    ]);
    if (session.user && !people[String(session.user.id)]) {
      people[String(session.user.id)] = session.user.name;
      void trApi.setPeople(people).catch(() => {});
    }
    // The desktop imports %APPDATA%\TestRailWeb\people.json once; the phone
    // carries the same map, embedded at build time, because TestRail will not
    // list users for a non-admin account. Server-side names still win.
    const seed = typeof __MC_PEOPLE__ === 'object' ? __MC_PEOPLE__ : {};
    for (const [id, personName] of Object.entries(seed)) {
      if (!people[id]) people[id] = personName;
    }

    const projects = filterIndigoProjects(allProjects);
    const remembered = Number(localStorage.getItem(LS_PROJECT));
    const start = projects.find((p) => p.id === remembered) ?? projects[0] ?? null;
    patch({ phase: 'connected', session, people, allProjects, projects });
    if (!start) {
      pushToast({ title: 'TestRail', body: 'No TestRail projects visible for this account.' });
      return;
    }
    await selectProject(start.id);
    // Warm the cache in the background (best-effort, like Railbook).
    //
    // On a phone this is scoped to the project actually being opened. Warming
    // every Indigo project pulled suites, sections, runs and cases for all of
    // them, which grew the on-device cache past 20MB — so it stopped being
    // written at all and every launch refetched from the network.
    const warm = isNativeApp() ? [start.id] : projects.map((p) => p.id);
    void trApi.prefetch(warm).catch(() => {});
  } catch (err) {
    patch({ phase: 'disconnected' });
    pushToast({ title: 'TestRail load failed', body: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Fill in display names for user ids we have never seen.
 *
 * get_users is admin-only on this TestRail and returns an empty list, so the
 * people map only ever contained the signed-in user. The ids are on the cases,
 * so unknown ones are fetched individually, merged into the store for every
 * screen at once, and persisted so the cost is paid once per device.
 */
export async function resolvePeople(ids: Iterable<number>): Promise<void> {
  const known = trStore.get().people;
  const missing = [...new Set(ids)].filter((id) => Number.isFinite(id) && !known[String(id)]);
  if (missing.length === 0) return;

  const pairs = await Promise.all(
    missing.slice(0, 80).map((id) =>
      trApi
        .user(id)
        .then((u) => [String(id), u.name] as const)
        // A deactivated or invisible user still deserves a label, otherwise the
        // filter list silently omits whoever owns those cases.
        .catch(() => [String(id), `User ${id}`] as const),
    ),
  );

  const merged = { ...trStore.get().people, ...Object.fromEntries(pairs) };
  patch({ people: merged });
  void trApi.setPeople(merged).catch(() => undefined);
}

export async function connectTestRail(baseUrl: string, email: string, apiKey: string): Promise<void> {
  await trApi.connect({ baseUrl, email, apiKey });
  const session = await trApi.session();
  patch({ phase: 'loading' });
  await afterConnect(session);
}

export async function disconnectTestRail(): Promise<void> {
  try {
    await trApi.disconnect();
  } finally {
    patch({
      phase: 'disconnected',
      session: null,
      meta: null,
      allProjects: [],
      projects: [],
      projectId: null,
      suites: [],
      sections: {},
      cases: {},
      runs: [],
      runsLoaded: false,
      planRuns: null,
      selSuiteId: null,
      selSectionId: null,
      caseSel: new Set(),
      coverage: {},
    });
  }
}

// ---------------------------------------------------------------------------
// project / suite / section selection
// ---------------------------------------------------------------------------

export async function selectProject(projectId: number): Promise<void> {
  localStorage.setItem(LS_PROJECT, String(projectId));
  const [meta, suites] = await Promise.all([
    trApi.meta(projectId).catch(() => null),
    trApi.suites(projectId),
  ]);
  const rememberedSuite = localStorage.getItem(`${LS_SUITE}.${projectId}`);
  let selSuiteId: SuiteSel | null =
    rememberedSuite === 'all'
      ? 'all'
      : (suites.find((s) => s.id === Number(rememberedSuite))?.id ?? suites[0]?.id ?? null);
  if (selSuiteId == null && suites.length) selSuiteId = suites[0].id;
  patch({
    projectId,
    meta,
    suites,
    sections: {},
    cases: {},
    runs: [],
    runsLoaded: false,
    planRuns: null,
    selSuiteId,
    selSectionId: null,
    caseSel: new Set(),
    collapsedSecs: new Set(),
    coverage: {},
    filters: { ...trStore.get().filters, showNeverRan: false },
  });
}

export function selectSuite(sel: SuiteSel): void {
  const st = trStore.get();
  if (st.projectId != null) localStorage.setItem(`${LS_SUITE}.${st.projectId}`, String(sel));
  patch({ selSuiteId: sel, selSectionId: null, caseSel: new Set() });
}

export function selectSection(sectionId: number | null): void {
  patch({ selSectionId: sectionId, caseSel: new Set() });
}

// ---------------------------------------------------------------------------
// data loaders (suite-keyed, in-flight deduped)
// ---------------------------------------------------------------------------

function suiteIdsOf(sel: SuiteSel): number[] {
  return sel === 'all' ? trStore.get().suites.map((s) => s.id) : [sel];
}

const sectionLoads = new Map<string, Promise<TrSection[]>>();

export function ensureSections(sel: SuiteSel, force = false): Promise<TrSection[][]> {
  return Promise.all(
    suiteIdsOf(sel).map((suiteId) => {
      const st = trStore.get();
      if (!force && st.sections[suiteId]) return Promise.resolve(st.sections[suiteId] as TrSection[]);
      const key = `${st.projectId}:${suiteId}:${force ? 1 : 0}`;
      let load = sectionLoads.get(key);
      if (!load) {
        const pid = st.projectId as number;
        load = trApi
          .sections(pid, suiteId, force)
          .then((list) => {
            trStore.set((prev) => ({ ...prev, sections: { ...prev.sections, [suiteId]: list } }));
            return list;
          })
          .finally(() => sectionLoads.delete(key));
        sectionLoads.set(key, load);
      }
      return load;
    }),
  );
}

const caseLoads = new Map<string, Promise<TrCase[]>>();

export function ensureCases(sel: SuiteSel, force = false): Promise<TrCase[][]> {
  return Promise.all(
    suiteIdsOf(sel).map((suiteId) => {
      const st = trStore.get();
      if (!force && st.cases[suiteId]) return Promise.resolve(st.cases[suiteId] as TrCase[]);
      const key = `${st.projectId}:${suiteId}:${force ? 1 : 0}`;
      let load = caseLoads.get(key);
      if (!load) {
        const pid = st.projectId as number;
        load = trApi
          .cases(pid, suiteId, force)
          .then((list) => {
            trStore.set((prev) => ({ ...prev, cases: { ...prev.cases, [suiteId]: list } }));
            return list;
          })
          .finally(() => caseLoads.delete(key));
        caseLoads.set(key, load);
      }
      return load;
    }),
  );
}

export async function loadRuns(force = false): Promise<TrRun[]> {
  const st = trStore.get();
  if (!force && st.runsLoaded) return st.runs;
  if (st.projectId == null) return [];
  const runs = await trApi.runs(st.projectId, force);
  patch({ runs, runsLoaded: true });
  return runs;
}

export async function loadPlanRuns(): Promise<TrPlanRun[]> {
  const st = trStore.get();
  if (st.planRuns) return st.planRuns;
  if (st.projectId == null) return [];
  const planRuns = await trApi.planRuns(st.projectId).catch(() => [] as TrPlanRun[]);
  patch({ planRuns });
  return planRuns;
}

/** Standalone runs + runs living inside test plans for a suite, newest first. */
export async function suiteRunPool(suiteId: number): Promise<Array<TrRun | TrPlanRun>> {
  const [runs, planRuns] = await Promise.all([loadRuns(), loadPlanRuns()]);
  return [...runs.filter((r) => r.suiteId === suiteId), ...planRuns.filter((r) => r.suiteId === suiteId)].sort(
    (a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0),
  );
}

// ---------------------------------------------------------------------------
// selection / filters / columns / tree
// ---------------------------------------------------------------------------

export function setCaseSelection(mutate: (next: Set<number>) => void): void {
  trStore.set((prev) => {
    const next = new Set(prev.caseSel);
    mutate(next);
    return { ...prev, caseSel: next };
  });
}

export function clearCaseSelection(): void {
  patch({ caseSel: new Set() });
}

export function toggleCollapsedSection(sectionId: number): void {
  trStore.set((prev) => {
    const next = new Set(prev.collapsedSecs);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    return { ...prev, collapsedSecs: next };
  });
}

export function setFilters(partial: Partial<TrFilters>): void {
  trStore.set((prev) => {
    const filters = { ...prev.filters, ...partial };
    try {
      const { showNeverRan: _skip, ...persisted } = filters;
      localStorage.setItem(LS_FILTERS, JSON.stringify(persisted));
    } catch {
      /* best-effort */
    }
    return { ...prev, filters };
  });
}

export function setVisibleCols(visible: string[]): void {
  localStorage.setItem(LS_COLS, JSON.stringify(visible));
  trStore.set((prev) => ({ ...prev, cols: { ...prev.cols, visible } }));
}

export function setColWidth(key: string, width: number): void {
  trStore.set((prev) => {
    const widths = { ...prev.cols.widths, [key]: width };
    localStorage.setItem(LS_COLW, JSON.stringify(widths));
    return { ...prev, cols: { ...prev.cols, widths } };
  });
}

export function toggleTreeHidden(): void {
  trStore.set((prev) => {
    const treeHidden = !prev.treeHidden;
    localStorage.setItem(LS_TREE, treeHidden ? '1' : '');
    return { ...prev, treeHidden };
  });
}

// ---------------------------------------------------------------------------
// never-ran coverage analysis
// ---------------------------------------------------------------------------

/**
 * Which cases of the suite were ever included in any run (standalone + plan
 * runs). Concurrency 6, one retry per run; partial failures are reported
 * honestly instead of silently understating coverage.
 */
export async function analyzeCoverage(
  suiteId: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const allRuns = await suiteRunPool(suiteId);
  if (!allRuns.length) {
    trStore.set((prev) => ({
      ...prev,
      coverage: { ...prev.coverage, [suiteId]: { covered: new Set(), runsAnalyzed: 0, totalRuns: 0 } },
      filters: { ...prev.filters, showNeverRan: true },
    }));
    return;
  }
  const covered = new Set<number>();
  let done = 0;
  let failed = 0;
  const queue = [...allRuns];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const r = queue.pop();
        if (!r) return;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            (await trApi.tests(r.id)).forEach((t) => covered.add(t.caseId));
            ok = true;
          } catch {
            /* retry once */
          }
        }
        if (!ok) failed++;
        done++;
        onProgress?.(done, allRuns.length);
      }
    }),
  );
  trStore.set((prev) => ({
    ...prev,
    coverage: {
      ...prev.coverage,
      [suiteId]: { covered, runsAnalyzed: allRuns.length - failed, totalRuns: allRuns.length },
    },
    filters: { ...prev.filters, showNeverRan: true },
  }));
  // Persist: the scan is expensive and used to evaporate on project switch.
  try {
    localStorage.setItem(
      `deck.tr.coverage.${suiteId}`,
      JSON.stringify({ covered: [...covered], runsAnalyzed: allRuns.length - failed, totalRuns: allRuns.length, at: Date.now() }),
    );
  } catch {
    /* best-effort */
  }
  if (failed) {
    pushToast({
      title: 'Coverage partial',
      body: `${failed} of ${allRuns.length} runs could not be read; "never ran" may be overstated.`,
    });
  } else {
    pushToast({ title: 'Coverage complete', body: `All ${allRuns.length} runs of this suite analyzed.` });
  }
}

/** Restore a persisted coverage scan (≤7 days old) into the store. */
export function restoreCoverage(suiteId: number): boolean {
  try {
    const raw = localStorage.getItem(`deck.tr.coverage.${suiteId}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { covered: number[]; runsAnalyzed: number; totalRuns: number; at: number };
    if (!Array.isArray(parsed.covered) || Date.now() - parsed.at > 7 * 86_400_000) return false;
    trStore.set((prev) => ({
      ...prev,
      coverage: {
        ...prev.coverage,
        [suiteId]: { covered: new Set(parsed.covered), runsAnalyzed: parsed.runsAnalyzed, totalRuns: parsed.totalRuns },
      },
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearCoverage(suiteId: number): void {
  trStore.set((prev) => {
    const coverage = { ...prev.coverage };
    delete coverage[suiteId];
    return { ...prev, coverage, filters: { ...prev.filters, showNeverRan: false } };
  });
}

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

export function savePeople(people: Record<string, string>): void {
  patch({ people });
  void trApi.setPeople(people).catch(() => {});
}

// ---------------------------------------------------------------------------
// palette → case drawer wiring
// ---------------------------------------------------------------------------

/** Select the case's suite and ask the Case Library to open its drawer. */
export function openCase(caseId: number, suiteId: number): void {
  const st = trStore.get();
  if (st.selSuiteId !== suiteId && st.selSuiteId !== 'all') selectSuite(suiteId);
  patch({ openCaseId: caseId });
}

export function consumeOpenCase(): void {
  if (trStore.get().openCaseId != null) patch({ openCaseId: null });
}

// ---------------------------------------------------------------------------
// derived helpers (name lookups mirroring Railbook)
// ---------------------------------------------------------------------------

export function userName(st: TestRailState, id: number | null | undefined): string {
  if (!id) return '—';
  return st.people[String(id)] ?? st.meta?.users.find((u) => u.id === id)?.name ?? `user ${id}`;
}

export function priorityName(st: TestRailState, id: number | null | undefined): string {
  if (!id) return '—';
  const p = st.meta?.priorities.find((x) => x.id === id);
  return p ? (p.shortName || p.name) : `P${id}`;
}

export function typeName(st: TestRailState, id: number | null | undefined): string {
  if (!id) return '—';
  return st.meta?.caseTypes.find((x) => x.id === id)?.name ?? `type ${id}`;
}

export function statusLabel(st: TestRailState, id: number): string {
  return st.meta?.statuses.find((x) => x.id === id)?.label ?? `status ${id}`;
}

// "All suites" flattens allocate a fresh array per call, which used to
// invalidate every downstream useMemo on every render. Identity-cached on
// the source maps instead.
let sectionsFlatCache: { src: TestRailState['sections']; value: TrSection[] } | null = null;
let casesFlatCache: { suites: TrSuite[]; src: TestRailState['cases']; value: TrCase[] } | null = null;

export function currentSections(st: TestRailState): TrSection[] {
  if (st.selSuiteId === 'all') {
    if (!sectionsFlatCache || sectionsFlatCache.src !== st.sections) {
      sectionsFlatCache = { src: st.sections, value: Object.values(st.sections).flatMap((s) => s ?? []) };
    }
    return sectionsFlatCache.value;
  }
  if (st.selSuiteId == null) return EMPTY_SECTIONS;
  return st.sections[st.selSuiteId] ?? EMPTY_SECTIONS;
}

export function currentCases(st: TestRailState): TrCase[] {
  if (st.selSuiteId === 'all') {
    if (!casesFlatCache || casesFlatCache.src !== st.cases || casesFlatCache.suites !== st.suites) {
      casesFlatCache = { suites: st.suites, src: st.cases, value: st.suites.flatMap((su) => st.cases[su.id] ?? []) };
    }
    return casesFlatCache.value;
  }
  if (st.selSuiteId == null) return EMPTY_CASES;
  return st.cases[st.selSuiteId] ?? EMPTY_CASES;
}

const EMPTY_SECTIONS: TrSection[] = [];
const EMPTY_CASES: TrCase[] = [];

export function casesLoaded(st: TestRailState): boolean {
  if (st.selSuiteId === 'all') return st.suites.every((su) => st.cases[su.id]);
  if (st.selSuiteId == null) return false;
  return Boolean(st.cases[st.selSuiteId]);
}

/** All loaded cases across suites (palette search, transfer checklists). */
export function allLoadedCases(st: TestRailState): Array<{ suiteId: number; c: TrCase }> {
  const out: Array<{ suiteId: number; c: TrCase }> = [];
  for (const [suiteId, list] of Object.entries(st.cases)) {
    for (const c of list ?? []) out.push({ suiteId: Number(suiteId), c });
  }
  return out;
}
