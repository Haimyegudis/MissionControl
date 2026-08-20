// Tiny hash router — `#/dashboard` etc. Exposes a route store + navigate().
// TestRail routes live under `#/testrail/…` (cases, runs, run/:id, reports).

import { createStore } from './stores/store';

export type RouteId =
  | 'dashboard'
  | 'mywork'
  | 'incidents'
  | 'boards'
  | 'filters'
  | 'recent'
  | 'timelogged'
  | 'dashboards'
  | 'team'
  | 'traceability'
  | 'settings'
  | 'testrail-cases'
  | 'testrail-runs'
  | 'testrail-run'
  | 'testrail-reports'
  | 'confluence';

export const ROUTES: Array<{ id: RouteId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'mywork', label: 'Backlog' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'boards', label: 'Boards' },
  // 'filters' removed from the nav — JQL saved filters live in the top-bar
  // ⚡ dialog now (route stays reachable via #/filters).
  // 'recent' removed from the nav — the Backlog's "Updated" filter covers it
  // (route stays reachable via #/recent).
  { id: 'timelogged', label: 'Time Spent' },
  // 'dashboards' (Jira dashboards list) removed from the nav per user
  // request — the route stays reachable via #/dashboards for deep links.
  { id: 'team', label: 'Team' },
  { id: 'traceability', label: 'Traceability' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Routes the Android build can serve. Only Confluence is excluded: its host
 * is internal-only and unreachable from a phone, verified on device. Everything else is desktop
 * only for now; isRouteAvailable keeps an unported view unreachable there
 * rather than letting it render against a 404ing dispatcher.
 */
export const MOBILE_ROUTE_IDS: ReadonlySet<RouteId> = new Set<RouteId>([
  'dashboard',
  'mywork',
  'incidents',
  'boards',
  'filters',
  'recent',
  'timelogged',
  'dashboards',
  'team',
  'traceability',
  'testrail-cases',
  'testrail-runs',
  'testrail-run',
  'testrail-reports',
  'settings',
]);

export function isRouteAvailable(id: RouteId, native: boolean): boolean {
  return native ? MOBILE_ROUTE_IDS.has(id) : true;
}

export const TESTRAIL_ROUTES: Array<{ id: RouteId; label: string }> = [
  { id: 'testrail-cases', label: 'Cases' },
  { id: 'testrail-runs', label: 'Runs' },
  { id: 'testrail-reports', label: 'Reports' },
];

export const CONFLUENCE_ROUTES: Array<{ id: RouteId; label: string }> = [
  { id: 'confluence', label: 'Pages' },
];

const HASH_BY_TESTRAIL_ROUTE: Partial<Record<RouteId, string>> = {
  'testrail-cases': 'testrail/cases',
  'testrail-runs': 'testrail/runs',
  'testrail-run': 'testrail/runs',
  'testrail-reports': 'testrail/reports',
};

const VALID = new Set<string>(ROUTES.map((r) => r.id));
VALID.add('confluence');
// Routes removed from the nav stay deep-linkable.
VALID.add('filters');
VALID.add('recent');
VALID.add('dashboards');
const DEFAULT_ROUTE: RouteId = 'dashboard';

/** Run id for the `#/testrail/run/:id` route (null elsewhere). */
export const testrailRunIdStore = createStore<number | null>(null);

function parseHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?', 1)[0].toLowerCase();
  const runMatch = raw.match(/^testrail\/run\/(\d+)/);
  if (runMatch) {
    testrailRunIdStore.set(Number(runMatch[1]));
    return 'testrail-run';
  }
  if (raw.startsWith('testrail/')) {
    const sub = raw.slice('testrail/'.length).split('/', 1)[0];
    if (sub === 'runs') return 'testrail-runs';
    if (sub === 'reports') return 'testrail-reports';
    return 'testrail-cases';
  }
  if (raw === 'confluence' || raw.startsWith('confluence/')) return 'confluence';
  const first = raw.split(/[/?]/, 1)[0];
  return VALID.has(first) ? (first as RouteId) : DEFAULT_ROUTE;
}

export const routeStore = createStore<RouteId>(
  typeof window !== 'undefined' ? parseHash() : DEFAULT_ROUTE,
);

export function navigate(route: RouteId): void {
  window.location.hash = `#/${HASH_BY_TESTRAIL_ROUTE[route] ?? route}`;
}

/** Open a specific TestRail run (`#/testrail/run/:id`). */
export function navigateTestRailRun(runId: number): void {
  window.location.hash = `#/testrail/run/${runId}`;
}

/** ActivePage display name for the top bar. */
export function activePageName(route: RouteId): string {
  if (route === 'testrail-run') return 'TestRail — Run';
  if (route === 'confluence') return 'Confluence — Indigo';
  const tr = TESTRAIL_ROUTES.find((r) => r.id === route);
  if (tr) return `TestRail — ${tr.label}`;
  return ROUTES.find((r) => r.id === route)?.label ?? 'Dashboard';
}

/** Wire hashchange → routeStore. Call once on boot. */
export function initRouter(): void {
  window.addEventListener('hashchange', () => routeStore.set(parseHash()));
  if (!window.location.hash) {
    window.history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
  }
  routeStore.set(parseHash());
}
