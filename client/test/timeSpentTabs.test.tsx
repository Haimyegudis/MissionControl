// Time Spent view components render (renderToString smoke) + sprint JQL.
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
    timelogged: {
      report: vi.fn(async () => ({ issues: [], total: 0, fromUtc: '', toUtc: '', dailyByIssue: [], availableSprints: [] })),
      range: vi.fn(never),
      sprint: vi.fn(never),
    },
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
  it('renders the given month with weekday headers (no internal nav)', () => {
    const html = renderToString(<CalendarTab year={2026} month={7} user="" />);
    expect(html).toContain('August 2026');
    expect(html).toContain('Sun');
    expect(html).toContain('Sat');
    expect(html).not.toContain('Previous');
    expect(html).not.toContain('Next');
  });
});

describe('EpicsTab', () => {
  it('renders the empty state without the days-back control', () => {
    const html = renderToString(<EpicsTab from="2026-08-01" to="2026-08-11" user="" />);
    expect(html).not.toContain('Days to look back');
    expect(html).toContain('No work logged in this window.');
  });
});

describe('SprintTab', () => {
  it('renders the active-sprint scaffold when no sprint is named', () => {
    const html = renderToString(<SprintTab sprintName="" user="" />);
    expect(html).toContain('Current sprint');
  });

  it('shows the given sprint name', () => {
    const html = renderToString(<SprintTab sprintName="Sprint 42" user="" />);
    expect(html).toContain('Sprint 42');
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

  it('escapes embedded backslashes before quotes', () => {
    expect(sprintJql('ISW', 'dom\\jdoe')).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = "dom\\\\jdoe" ORDER BY status',
    );
  });

  it('targets a named sprint when given', () => {
    expect(sprintJql('ISW', null, 'Sprint 42')).toBe(
      'project = ISW AND sprint = "Sprint 42" AND assignee = currentUser() ORDER BY status',
    );
  });

  it('escapes quotes in the sprint name', () => {
    expect(sprintJql('ISW', 'jdoe', 'S "X"')).toBe(
      'project = ISW AND sprint = "S \\"X\\"" AND assignee = "jdoe" ORDER BY status',
    );
  });

  it('blank sprint name falls back to openSprints()', () => {
    expect(sprintJql('ISW', null, '  ')).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = currentUser() ORDER BY status',
    );
  });
});
