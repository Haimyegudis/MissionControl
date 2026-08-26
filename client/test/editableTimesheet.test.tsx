// Editable timesheet render (renderToString smoke). Interaction is covered
// indirectly via Task 1's lib tests (buildEditableRows/parseCellInput).
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
    timelogged: group(),
    metadata: group(),
    metadataExtra: group(),
    issues: {
      addWorklog: vi.fn(never),
      details: vi.fn(never),
    },
  };
});

import { EditableTimesheet } from '../src/views/timespent/EditableTimesheet';
import type { JiraIssue, TimeLoggedReport } from '../src/types';

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key: 'ISW-1',
    summary: 'Fix the thing',
    issueType: 'Task',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    assignee: 'jdoe',
    ...overrides,
  } as JiraIssue;
}

const days = ['2026-08-23', '2026-08-24', '2026-08-25'];

const report: TimeLoggedReport = {
  issues: [makeIssue()],
  total: 7200,
  fromUtc: '2026-08-23T00:00:00Z',
  toUtc: '2026-08-26T00:00:00Z',
  dailyByIssue: [{ day: '2026-08-23', issueKey: 'ISW-1', issueSummary: 'Fix the thing', timeSpent: 7200 }],
  availableSprints: [],
};

describe('EditableTimesheet', () => {
  it('self mode renders editable inputs and the add-issue row', () => {
    const html = renderToString(
      <EditableTimesheet days={days} report={report} sprintIssues={[]} user="" onLogged={() => {}} />,
    );
    expect(html).toContain('<input');
    expect(html).toContain('ISW-1');
    // add-issue row placeholder / affordance
    expect(html).toMatch(/add.*issue/i);
  });

  it('foreign-user mode renders no inputs', () => {
    const html = renderToString(
      <EditableTimesheet days={days} report={report} sprintIssues={[]} user="asmith" onLogged={() => {}} />,
    );
    expect(html).not.toContain('<input');
    expect(html).toContain('ISW-1');
  });

  it('includes a sprint-only empty row for an unlogged sprint issue', () => {
    const sprintOnly = makeIssue({ key: 'ISW-2', summary: 'Not logged yet' });
    const html = renderToString(
      <EditableTimesheet days={days} report={report} sprintIssues={[sprintOnly]} user="" onLogged={() => {}} />,
    );
    expect(html).toContain('ISW-2');
    expect(html).toContain('Not logged yet');
  });
});
