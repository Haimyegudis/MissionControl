// Smoke tests for the three heavy views (Task B4a) via react-dom/server with
// the API module mocked — no network, no jsdom.

import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('../src/api/client', () => {
  const pending = () => new Promise<never>(() => {});
  const fn = () => vi.fn(pending);
  return {
    ApiError: class ApiError extends Error {
      status = 0;
    },
    SESSION_LOST_EVENT: 'jiraweb:session-lost',
    onSessionLost: vi.fn(() => () => {}),
    api: { get: fn(), post: fn(), put: fn(), del: fn() },
    auth: { test: fn(), login: fn(), logout: fn(), status: fn() },
    issues: {
      search: fn(),
      details: fn(),
      transitions: fn(),
      transitionScreen: fn(),
      performTransition: fn(),
      addComment: fn(),
      addLabel: fn(),
      worklogs: fn(),
      addWorklog: fn(),
    },
    boards: { list: fn(), sprints: fn(), issues: fn(), quickFilters: fn() },
    dashboard: { snapshot: fn() },
    dashboards: { list: fn(), details: fn() },
    timelogged: { report: fn(), sprint: fn(), range: fn() },
    incidents: { search: fn(), filterOptions: fn() },
    settings: { get: fn(), put: fn(), clearIssueCache: fn(), hardRefresh: fn() },
    filters: { list: fn(), save: fn(), remove: fn() },
    teams: { list: fn(), save: fn(), remove: fn() },
    pinnedBoards: { list: fn(), add: fn(), remove: fn() },
    create: { meta: fn(), issue: fn(), getDefaults: fn(), putDefaults: fn(), deleteDefaults: fn() },
    metadata: { kind: fn(), users: fn(), versions: fn(), components: fn(), distinct: fn(), suggestions: fn() },
    misc: { attachmentProxyUrl: (url: string) => url },
    lumoAsk: fn(),
  };
});

import { DashboardView } from '../src/views/DashboardView';
import { IncidentsView } from '../src/views/IncidentsView';
import { MyWorkView, mergeSavedQueries } from '../src/views/MyWorkView';

describe('DashboardView (§1)', () => {
  it('renders KPI row, sprint card header/subtitle and view toggle', () => {
    const html = renderToString(<DashboardView />);
    expect(html).toContain('My Current Sprint');
    expect(html).toContain(
      'Active-sprint issues assigned to you. Drag cards in Kanban to change status.',
    );
    // Default settings enable all six widgets in canonical order.
    expect(html).toContain('My Open Issues');
    expect(html).toContain('My Critical');
    expect(html).toContain('On Hold');
    expect(html).toContain('Updated Today');
    expect(html).toContain('Logged Today');
    expect(html).toContain('Logged This Week');
    expect(html).toContain('Kanban');
    expect(html).toContain('Table');
    // Kanban is the default mode — the five fixed columns are visible.
    expect(html).toContain('To Do');
    expect(html).toContain('In Progress');
    expect(html).toContain('In Review');
  });
});

describe('MyWorkView (§2)', () => {
  it('renders toolbar, saved queries and column-filter buttons (table default)', () => {
    const html = renderToString(<MyWorkView />);
    expect(html).toContain('Backlog');
    expect(html).toContain('Search by key or summary...');
    expect(html).toContain('Kanban');
    expect(html).toContain('SAVED QUERIES:');
    // SSR inserts `<!-- -->` between adjacent text nodes.
    expect(html).toMatch(/Type(<!-- -->)? ▾/);
    expect(html).toMatch(/Status(<!-- -->)? ▾/);
    expect(html).toMatch(/Priority(<!-- -->)? ▾/);
    expect(html).toMatch(/Assignee(<!-- -->)? ▾/);
    expect(html).toContain('Save query');
    expect(html).toContain('Export');
    expect(html).toContain('Import');
  });

  it('board prop swaps the title to the board name', () => {
    const html = renderToString(
      <MyWorkView board={{ boardId: 5, filterId: 9, name: 'Indigo Board' }} />,
    );
    expect(html).toContain('Indigo Board');
  });

  it('mergeSavedQueries merges by name (imported wins) and caps at 25', () => {
    const existing = [
      { name: 'A', jql: 'old-a' },
      { name: 'B', jql: 'b' },
    ];
    const merged = mergeSavedQueries(existing, [
      { name: 'a', jql: 'new-a' },
      { name: 'C', jql: 'c' },
    ]);
    expect(merged).toEqual([
      { name: 'a', jql: 'new-a' },
      { name: 'B', jql: 'b' },
      { name: 'C', jql: 'c' },
    ]);

    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Q${i}`, jql: `j${i}` }));
    expect(mergeSavedQueries([], many)).toHaveLength(25);
  });
});

describe('IncidentsView (§3)', () => {
  it('renders header verbatim, pills, expander and the three sections', () => {
    const html = renderToString(<IncidentsView />);
    expect(html).toContain('Indigo SW Incidents');
    expect(html).toContain('Active filters:');
    expect(html).toContain('Open in Jira');
    expect(html).toContain('Clear All');
    expect(html).toContain('Filters');
    expect(html).toContain('SW Incident / Incidents &amp; RCs');
    expect(html).toContain('SW Incident / Verification Incidents');
    expect(html).toContain('SW Incident / Rejected Incidents');
    // Colored header bars per §3.
    expect(html).toContain('#1B5BAA');
    expect(html).toContain('#B8323A');
  });
});
