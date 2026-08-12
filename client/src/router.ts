// Tiny hash router — `#/dashboard` etc. Exposes a route store + navigate().

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
  | 'settings';

export const ROUTES: Array<{ id: RouteId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'mywork', label: 'My Work' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'boards', label: 'Boards' },
  { id: 'filters', label: 'Filters' },
  { id: 'recent', label: 'Recent Updates' },
  { id: 'timelogged', label: 'Time Spent' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'team', label: 'Team' },
  { id: 'settings', label: 'Settings' },
];

const VALID = new Set<string>(ROUTES.map((r) => r.id));
const DEFAULT_ROUTE: RouteId = 'dashboard';

function parseHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0].toLowerCase();
  return VALID.has(raw) ? (raw as RouteId) : DEFAULT_ROUTE;
}

export const routeStore = createStore<RouteId>(
  typeof window !== 'undefined' ? parseHash() : DEFAULT_ROUTE,
);

export function navigate(route: RouteId): void {
  window.location.hash = `#/${route}`;
}

/** ActivePage display name for the top bar. */
export function activePageName(route: RouteId): string {
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
