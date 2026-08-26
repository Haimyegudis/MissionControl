// Time Spent tab strip + tab components render (renderToString smoke).
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
    boards: group(),
    dashboard: group(),
    dashboards: group(),
    incidents: group(),
    settings: group(),
    confluence: group(),
    filters: group(),
    teams: group(),
    pinnedBoards: group(),
    create: group(),
    misc: { attachmentProxyUrl: (url: string) => url },
    lumoAsk: vi.fn(never),
    timelogged: { report: vi.fn(async () => ({ issues: [], total: 0, fromUtc: '', toUtc: '', dailyByIssue: [], availableSprints: [] })) },
    issues: { search: vi.fn(async () => ({ items: [], total: 0 })), transitions: vi.fn(async () => []), transitionScreen: vi.fn(async () => []), performTransition: vi.fn(async () => undefined) },
    metadata: { searchableUsers: vi.fn(async () => []) },
    metadataExtra: { resolveUser: vi.fn(async () => ({ username: null })) },
  };
});

import { CalendarTab } from '../src/views/timespent/CalendarTab';
import { EpicsTab } from '../src/views/timespent/EpicsTab';
import { SprintTab } from '../src/views/timespent/SprintTab';
import { sprintJql } from '../src/lib/viewTimeSpentTabs';

describe('CalendarTab', () => {
  it('renders month title, weekday headers and nav buttons', () => {
    const html = renderToString(<CalendarTab user="" />);
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toContain('Today');
    expect(html).toContain('Sun');
    expect(html).toContain('Sat');
  });
});

describe('EpicsTab', () => {
  it('renders the days-back control and empty state', () => {
    const html = renderToString(<EpicsTab user="" />);
    expect(html).toContain('Days to look back');
    expect(html).toContain('value="30"');
  });
});

describe('SprintTab', () => {
  it('renders the empty state scaffold', () => {
    const html = renderToString(<SprintTab user="" />);
    expect(html).toContain('Current sprint');
  });
});

describe('sprintJql', () => {
  it('uses currentUser() when no resolved user is given', () => {
    expect(sprintJql('ISW', null)).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = currentUser() ORDER BY status',
    );
  });

  it('quotes a resolved user', () => {
    expect(sprintJql('ISW', 'jdoe')).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = "jdoe" ORDER BY status',
    );
  });

  it('escapes embedded double quotes to prevent JQL injection', () => {
    expect(sprintJql('ISW', 'jdoe" OR assignee = "x')).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = "jdoe\\" OR assignee = \\"x" ORDER BY status',
    );
  });
});
