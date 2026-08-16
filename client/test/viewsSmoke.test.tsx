// renderToString smoke tests for the B4b views (Boards, Filters, Recent
// Updates, Time Logged, Dashboards, Team + editor + member detail, Settings).
// The API client is mocked; effects do not run under react-dom/server so no
// network is touched — these assert the static contract strings render.

import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('../src/api/client', () => {
  const never = () => new Promise(() => {});
  const group = () =>
    new Proxy({}, { get: () => vi.fn(never) }) as Record<string, (...args: unknown[]) => Promise<never>>;
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    SESSION_LOST_EVENT: 'jiraweb:session-lost',
    onSessionLost: () => () => {},
    api: group(),
    auth: group(),
    issues: group(),
    boards: group(),
    dashboard: group(),
    dashboards: group(),
    timelogged: group(),
    incidents: group(),
    settings: group(),
    confluence: group(),
    filters: group(),
    teams: group(),
    pinnedBoards: group(),
    create: group(),
    metadata: group(),
    misc: { attachmentProxyUrl: (url: string) => url },
    lumoAsk: vi.fn(never),
  };
});

import { BoardsView } from '../src/views/BoardsView';
import { DashboardsView } from '../src/views/DashboardsView';
import { FiltersView } from '../src/views/FiltersView';
import { RecentUpdatesView } from '../src/views/RecentUpdatesView';
import { SettingsView } from '../src/views/SettingsView';
import { TeamView } from '../src/views/TeamView';
import { TimeLoggedView, formatPrintStamp } from '../src/views/TimeLoggedView';
import { MemberDetail } from '../src/views/team/MemberDetail';
import { TeamEditor } from '../src/views/team/TeamEditor';

describe('BoardsView (§4)', () => {
  it('renders header, toolbar and verbatim empty state', () => {
    const html = renderToString(<BoardsView />);
    expect(html).toContain('Boards');
    expect(html).toContain('Total:');
    expect(html).toContain('Reload');
    expect(html).toContain('Force refresh');
    expect(html).toContain('Drop cache and pull boards fresh from Jira');
    expect(html).toContain('No boards available. Click Reload, or check your Jira agile/board permissions.');
  });
});

describe('FiltersView (§5)', () => {
  it('renders list pane and editor', () => {
    const html = renderToString(<FiltersView />);
    expect(html).toContain('Saved Filters');
    expect(html).toContain('New filter');
    expect(html).toContain('JQL');
    expect(html).toContain('Save');
    expect(html).toContain('Run');
    expect(html).toContain('Delete');
  });
});

describe('RecentUpdatesView (§6)', () => {
  it('renders header, user picker and What changed column', () => {
    const html = renderToString(<RecentUpdatesView />);
    expect(html).toContain('Recent Updates');
    expect(html).toContain('User:');
    expect(html).toContain('What changed');
  });
});

describe('TimeLoggedView (redesigned)', () => {
  it('renders toolbar chips, hero summary, timesheet and heatmap', () => {
    const html = renderToString(<TimeLoggedView />);
    expect(html).toContain('Time Spent');
    expect(html).toContain('⬇ CSV');
    expect(html).toContain('⬇ PDF');
    expect(html).toContain('Total logged');
    expect(html).toContain('Weekly timesheet');
    expect(html).toContain('Activity — last 13 weeks');
    expect(html).toContain('This week');
    // All six periods offered as chips.
    for (const p of ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Custom…']) {
      expect(html).toContain(p);
    }
  });

  it('formatPrintStamp = yyyy-MM-dd HH:mm', () => {
    expect(formatPrintStamp(new Date(2026, 7, 9, 7, 5))).toBe('2026-08-09 07:05');
  });
});

describe('DashboardsView (§8)', () => {
  it('renders the split panes', () => {
    const html = renderToString(<DashboardsView />);
    expect(html).toContain('Dashboards');
    expect(html).toContain('Select a dashboard on the left.');
  });
});

describe('TeamView (§9)', () => {
  it('renders header controls and the verbatim empty state', () => {
    const html = renderToString(<TeamView />);
    expect(html).toContain('Team Dashboard');
    expect(html).toContain('Team:');
    expect(html).toContain('Project:');
    expect(html).toContain('New team');
    expect(html).toContain('Refresh');
    expect(html).toContain('No teams yet');
    expect(html).toContain('+ New team');
  });
});

describe('TeamEditor (§9.1)', () => {
  it('renders fields and actions', () => {
    const html = renderToString(<TeamEditor existing={null} onClose={() => {}} />);
    expect(html).toContain('New team');
    expect(html).toContain('Team name');
    expect(html).toContain('Project');
    expect(html).toContain('Load');
    expect(html).toContain('Cancel');
    expect(html).toContain('Save');
  });
});

describe('MemberDetail (§9.2)', () => {
  it('renders stats and both chart titles', () => {
    const html = renderToString(<MemberDetail member="Adir Takiar" issues={[]} onClose={() => {}} />);
    expect(html).toContain('Adir Takiar');
    expect(html).toContain('Features');
    expect(html).toContain('Logged (h)');
    expect(html).toContain('Remaining (h)');
    expect(html).toContain('Hours per day (last 7 days)');
    expect(html).toContain('Logged vs Estimated per feature (h)');
  });
});

describe('SettingsView (§14, redesign)', () => {
  it('renders the mini-nav, every section and the action bar', () => {
    const html = renderToString(<SettingsView />);
    // Sticky mini-nav anchors == section kickers.
    for (const label of ['Connections', 'Preferences', 'Notifications', 'Dashboard', 'AI Assistant', 'Reminders', 'Data']) {
      expect(html).toContain(label);
    }
    // Connections is the single home for identity/secrets — all four services.
    expect(html).toContain('Jira');
    expect(html).toContain('TestRail');
    expect(html).toContain('Confluence');
    expect(html).toContain('GitHub Copilot');
    expect(html).toContain('Personal access token');
    expect(html).toContain('Connect / Test');
    expect(html).toContain('Clear TestRail cache');
    expect(html).toContain('Log out');
    expect(html).toContain('Login to Copilot');
    // Service URLs are hardcoded — shown read-only, never as inputs.
    expect(html).toContain('hp-jira.external.hp.com');
    expect(html).toContain('hp-testrail.external.hp.com');
    expect(html).toContain('v-indigo-confluence.inr.rd.hpicorp.net:6443');
    expect(html).not.toContain('Base URL');
    // TestRail email defaults to the Jira email; override is behind a link.
    expect(html).toContain('Use a different email');
    // Surviving settings, regrouped into flat sections. The managed URLs
    // (incidentDashboardUrl, aiEndpoint) are intentionally absent from the UI.
    expect(html).toContain('Theme');
    expect(html).toContain('Railbook');
    expect(html).toContain('Pause when minimized');
    expect(html).toContain('Refresh interval');
    expect(html).toContain('Mute all');
    expect(html).toContain('Default project key');
    expect(html).not.toContain('Incident dashboard URL');
    expect(html).toContain('Dashboard widgets');
    expect(html).not.toContain('Endpoint');
    expect(html).toContain('Model');
    expect(html).toContain('Log-work reminder');
    expect(html).toContain('Clear cache');
    expect(html).toContain('Save');
  });
});
