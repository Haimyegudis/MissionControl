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
    expect(html).toContain('Boards Search');
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

describe('TimeLoggedView (§7)', () => {
  it('renders toolbar, expanders, timesheet and sticky total', () => {
    const html = renderToString(<TimeLoggedView />);
    expect(html).toContain('Time Spent');
    expect(html).toContain('Export to Excel/PNG');
    expect(html).toContain('Export PDF');
    expect(html).toContain('Log work');
    expect(html).toContain('Logged vs Estimated chart');
    expect(html).toContain('Logging per day in sprint');
    expect(html).toContain('Activity heatmap (last 13 weeks)');
    expect(html).toContain('This week');
    expect(html).toContain('Total Work Logged:');
    // All six periods offered.
    for (const p of ['Today', 'Yesterday', 'ThisWeek', 'PreviousWeek', 'ThisMonth', 'CustomRange']) {
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

describe('SettingsView (§14)', () => {
  it('renders every card and the action bar', () => {
    const html = renderToString(<SettingsView />);
    expect(html).toContain('AI Assistant');
    expect(html).toContain('Dashboard widgets');
    expect(html).toContain('Account');
    expect(html).toContain('Connected as:');
    expect(html).toContain('Update PAT');
    expect(html).toContain('Log out');
    expect(html).toContain('Appearance');
    expect(html).toContain('Refresh');
    expect(html).toContain('Pause when minimized');
    expect(html).toContain('Notifications');
    expect(html).toContain('Mute all');
    expect(html).toContain('HP Indigo');
    expect(html).toContain('Default project key');
    expect(html).toContain('Clear cache');
    expect(html).toContain('Save');
  });
});
