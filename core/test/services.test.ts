import { describe, it, expect, afterEach } from 'vitest';
import { JiraSession } from '../src/jira/session.js';
import { JiraError, type JiraFetchOptions } from '../src/jira/httpClient.js';
import {
  BASE_FIELDS,
  JiraIssueService,
  extractCurrentFieldValue,
  resetEpicNameCache,
  type JqlFieldResolver,
} from '../src/jira/issueService.js';
import { JiraWorklogService, formatWorklogStarted } from '../src/jira/worklogService.js';
import { JiraBoardService } from '../src/jira/boardService.js';
import { JiraMetadataService } from '../src/jira/metadataService.js';
import { JiraDashboardService } from '../src/jira/dashboardService.js';
import { JiraCreateIssueService } from '../src/jira/createIssueService.js';
import {
  BOARDS_CACHE_KEY,
  CachedBoardService,
  CachedMetadataService,
  type BoardServiceLike,
  type MetadataServiceLike,
} from '../src/jira/cached.js';
import { MemoryKvStore } from '../src/storage/kv.js';
import { MetadataCacheRepo } from '../src/storage/repos.js';
import type { BoardLoadResult, JiraBoard } from '../src/types.js';
import type { JiraInstanceType } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(instanceType: JiraInstanceType = 'datacenter'): JiraSession {
  const session = new JiraSession();
  session.activate(
    {
      email: 'me@example.com',
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'secret-pat',
      instanceType,
      defaultProjectKey: 'ISW',
    },
    { accountId: 'me', displayName: 'Me', emailAddress: null, avatarUrl: null, active: true },
  );
  return session;
}

interface Call {
  path: string;
  opts: JiraFetchOptions;
}

/** Records calls; the handler returns the response (or throws). */
function mockFetch(handler: (path: string, opts: JiraFetchOptions) => unknown) {
  const calls: Call[] = [];
  const fn = async (_session: JiraSession, path: string, opts: JiraFetchOptions = {}) => {
    calls.push({ path, opts });
    return handler(path, opts);
  };
  return { fn, calls };
}

function issueJson(key: string, fields: Record<string, unknown> = {}): any {
  return {
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { name: 'Open', statusCategory: { key: 'new' } },
      issuetype: { name: 'Bug' },
      created: '2026-08-01T10:00:00.000+0000',
      updated: '2026-08-10T12:00:00.000+0000',
      ...fields,
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---------------------------------------------------------------------------
// Issue service — search + field discovery
// ---------------------------------------------------------------------------

describe('JiraIssueService search', () => {
  afterEach(() => resetEpicNameCache());

  it('discovers custom fields once and appends them to the search field list', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path, opts) => {
      if (path === 'rest/api/2/field') {
        return [
          { id: 'customfield_10020', name: 'Sprint' },
          { id: 'customfield_10101', name: 'Severity' },
          { id: 'customfield_10102', name: 'Reject Reasons' },
          { id: 'priority', name: 'Priority' }, // not customfield_ → skipped
          { id: 'customfield_10103', name: 'Priority' },
        ];
      }
      return { issues: [], startAt: (opts.body as any).startAt, maxResults: 50, total: 0 };
    });
    const svc = new JiraIssueService(session, fn);

    await svc.searchIssues('project = ISW', 0, 50);
    await svc.searchIssues('project = ISW', 0, 50);

    const fieldCalls = calls.filter((c) => c.path === 'rest/api/2/field');
    expect(fieldCalls).toHaveLength(1); // cached after first discovery

    const searchCall = calls.find((c) => c.path === 'rest/api/2/search');
    const sentFields = (searchCall!.opts.body as any).fields as string[];
    for (const f of BASE_FIELDS) expect(sentFields).toContain(f);
    expect(sentFields).toContain('customfield_10020');
    expect(sentFields).toContain('customfield_10101');
    expect(sentFields).toContain('customfield_10102');
    expect(sentFields).toContain('customfield_10103');
    expect(sentFields).not.toContain('priority-again');

    svc.resetFieldCache();
    await svc.searchIssues('project = ISW', 0, 50);
    expect(calls.filter((c) => c.path === 'rest/api/2/field')).toHaveLength(2);
    svc.resetFieldCache();
  });

  it('searchAll pages by 100 and stops at the hard cap', async () => {
    const session = makeSession();
    const total = 250;
    const { fn, calls } = mockFetch((path, opts) => {
      if (path === 'rest/api/2/field') return [];
      const { startAt, maxResults } = opts.body as any;
      const count = Math.min(maxResults, total - startAt);
      return {
        issues: Array.from({ length: count }, (_, i) => issueJson(`ISW-${startAt + i + 1}`)),
        startAt,
        maxResults,
        total,
      };
    });
    const svc = new JiraIssueService(session, fn);

    const all = await svc.searchAll('project = ISW', 500);
    expect(all).toHaveLength(250);

    const searchCalls = () => calls.filter((c) => c.path === 'rest/api/2/search');
    expect(searchCalls()).toHaveLength(3);

    calls.length = 0;
    const capped = await svc.searchAll('project = ISW', 150);
    expect(searchCalls()).toHaveLength(2); // page 1 + one parallel page to reach the cap
    expect(capped.length).toBe(150); // hard cap now exact (no overshoot)
    svc.resetFieldCache();
  });
});

// ---------------------------------------------------------------------------
// Issue service — transitions payload shaping
// ---------------------------------------------------------------------------

describe('JiraIssueService transitions', () => {
  it('strips worklog from fields and shapes comment/assignee/timeSpent (DC)', async () => {
    const session = makeSession('datacenter');
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransitionWithData(
      'ISW-1',
      '5',
      { worklog: { timeSpent: '2h' }, customfield_1: 'x' },
      'hello there',
      'bob',
      '3h',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('rest/api/2/issue/ISW-1/transitions');
    const body = calls[0].opts.body as any;
    expect(body.transition).toEqual({ id: '5' });
    expect(body.fields.worklog).toBeUndefined();
    expect('worklog' in body.fields).toBe(false);
    expect(body.fields.customfield_1).toBe('x');
    expect(body.fields.assignee).toEqual({ name: 'bob' });
    expect(body.update.comment).toEqual([{ add: { body: 'hello there' } }]);
    expect(body.update.worklog).toEqual([{ add: { timeSpent: '3h' } }]);
  });

  it('uses ADF comment bodies on cloud', async () => {
    const session = makeSession('cloud');
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransitionWithData('ISW-1', '5', {}, 'cloud note');

    expect(calls[0].path).toBe('rest/api/3/issue/ISW-1/transitions');
    const add = (calls[0].opts.body as any).update.comment[0].add;
    expect(add.type).toBe('doc');
    expect(add.version).toBe(1);
    expect(add.content[0].content[0].text).toBe('cloud note');
  });

  it('omits update entirely when comment and timeSpent are absent', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransitionWithData('ISW-1', '5', { resolution: { name: 'Done' } });

    const body = calls[0].opts.body as any;
    expect('update' in body).toBe(false);
    expect(body.fields.resolution).toEqual({ name: 'Done' });
  });

  it('adds started to the transition worklog when worklogStarted is given', async () => {
    const session = makeSession('datacenter');
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransitionWithData('ISW-1', '5', {}, null, null, '3h', '2026-08-20T10:30:00.000Z');

    const body = calls[0].opts.body as any;
    const add = body.update.worklog[0].add;
    expect(add.timeSpent).toBe('3h');
    // Local-time render of the UTC instant; check shape + preserved minutes.
    expect(add.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
    expect(new Date('2026-08-20T10:30:00.000Z').getMinutes()).toBe(new Date(add.started).getMinutes());
  });

  it('omits started when worklogStarted is absent', async () => {
    const session = makeSession('datacenter');
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransitionWithData('ISW-1', '5', {}, null, null, '3h');

    const add = (calls[0].opts.body as any).update.worklog[0].add;
    expect(add).toEqual({ timeSpent: '3h' });
  });

  it('omits started when worklogStarted is unparseable', async () => {
    const session = makeSession('datacenter');
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransitionWithData('ISW-1', '5', {}, null, null, '3h', 'garbage');

    const add = (calls[0].opts.body as any).update.worklog[0].add;
    expect(add).toEqual({ timeSpent: '3h' });
  });

  it('performTransition posts the bare transition id', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.performTransition('ISW-1', '7');
    expect(calls[0].opts.body).toEqual({ transition: { id: '7' } });
  });

  it('getTransitionScreen reads fields for the matching transition and prefills current values', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path) => {
      if (path === 'rest/api/2/issue/ISW-1') {
        return { fields: { customfield_11000: { value: 'Development' } } };
      }
      return {
        transitions: [
          { id: '4', fields: { bogus: { name: 'Bogus' } } },
          {
            id: '5',
            fields: {
              resolution: {
                name: 'Resolution',
                required: true,
                schema: { type: 'resolution' },
                allowedValues: [{ name: 'Done' }, { value: 'Rejected' }],
              },
              customfield_11000: {
                name: 'Task Type',
                required: false,
                schema: { type: 'option' },
                allowedValues: [{ value: 'Development' }, { value: 'Support' }],
              },
            },
          },
        ],
      };
    });
    const svc = new JiraIssueService(session, fn);

    const screen = await svc.getTransitionScreen('ISW-1', '5');
    expect(calls[0].opts.query).toEqual({ expand: 'transitions.fields' });
    expect(calls[1].path).toBe('rest/api/2/issue/ISW-1');
    expect(calls[1].opts.query).toEqual({ fields: 'resolution,customfield_11000' });
    expect(screen).toEqual([
      {
        id: 'resolution',
        name: 'Resolution',
        required: true,
        schemaType: 'resolution',
        itemType: null,
        allowedValues: ['Done', 'Rejected'],
        currentValue: null,
      },
      {
        id: 'customfield_11000',
        name: 'Task Type',
        required: false,
        schemaType: 'option',
        itemType: null,
        allowedValues: ['Development', 'Support'],
        currentValue: 'Development',
      },
    ]);
  });

  it('getTransitionScreen keeps fields when the current-value fetch fails', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      if (path === 'rest/api/2/issue/ISW-1') throw new JiraError(500, 'boom');
      return {
        transitions: [
          {
            id: '5',
            fields: {
              resolution: { name: 'Resolution', schema: { type: 'resolution' }, allowedValues: [{ name: 'Done' }] },
            },
          },
        ],
      };
    });
    const svc = new JiraIssueService(session, fn);

    const screen = await svc.getTransitionScreen('ISW-1', '5');
    expect(screen).toHaveLength(1);
    expect(screen[0].currentValue).toBeNull();
  });

  it('extractCurrentFieldValue handles the common Jira value shapes', () => {
    expect(extractCurrentFieldValue(null)).toBeNull();
    expect(extractCurrentFieldValue(undefined)).toBeNull();
    expect(extractCurrentFieldValue('')).toBeNull();
    expect(extractCurrentFieldValue('plain')).toBe('plain');
    expect(extractCurrentFieldValue(4.5)).toBe('4.5');
    expect(extractCurrentFieldValue({ value: 'Development' })).toBe('Development');
    expect(extractCurrentFieldValue({ name: 'Fixed' })).toBe('Fixed');
    expect(extractCurrentFieldValue({ displayName: 'Jane Doe' })).toBe('Jane Doe');
    expect(extractCurrentFieldValue([{ value: 'A' }, { value: 'B' }])).toBe('A');
    expect(extractCurrentFieldValue({ foo: 'bar' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue service — comments, labels, details, distinct
// ---------------------------------------------------------------------------

describe('JiraIssueService comments/labels', () => {
  it('addComment is a no-op on empty and sends plain body on DC', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.addComment('ISW-1', '   ');
    expect(calls).toHaveLength(0);

    await svc.addComment('ISW-1', 'note');
    expect(calls[0].path).toBe('rest/api/2/issue/ISW-1/comment');
    expect(calls[0].opts.body).toEqual({ body: 'note' });
  });

  it('addComment sends ADF on cloud', async () => {
    const session = makeSession('cloud');
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.addComment('ISW-1', 'cloudy');
    const body = (calls[0].opts.body as any).body;
    expect(body.type).toBe('doc');
  });

  it('addLabel uses update.labels add and no-ops on empty', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => null);
    const svc = new JiraIssueService(session, fn);

    await svc.addLabel('ISW-1', '');
    expect(calls).toHaveLength(0);

    await svc.addLabel('ISW-1', 'blocked');
    expect(calls[0].opts.method).toBe('PUT');
    expect(calls[0].opts.body).toEqual({ update: { labels: [{ add: 'blocked' }] } });
  });
});

describe('JiraIssueService details + epic enrichment', () => {
  afterEach(() => resetEpicNameCache());

  it('fetches details with the right expand, enriches epic name, caches it (LRU)', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path) => {
      if (path === 'rest/api/2/issue/ISW-1') {
        return {
          ...issueJson('ISW-1', {
            customfield_10014: 'ISW-100',
            description: 'plain text',
            comment: {
              comments: [
                { author: { displayName: 'Alice' }, created: '2026-08-01T10:00:00.000+0000', body: 'first' },
              ],
            },
            worklog: {
              worklogs: [
                {
                  id: 1,
                  author: { displayName: 'Me' },
                  started: '2026-08-02T09:00:00.000+0000',
                  timeSpentSeconds: 3600,
                },
              ],
            },
          }),
          names: { customfield_10014: 'Epic Link' },
          renderedFields: { description: '<p>plain text</p>' },
          changelog: { histories: [] },
        };
      }
      if (path === 'rest/api/2/issue/ISW-100') return { fields: { summary: 'The Epic' } };
      if (path === 'rest/api/2/issue/ISW-1/transitions') {
        return { transitions: [{ id: 11, name: 'Start', to: { name: 'In Progress' } }] };
      }
      throw new Error(`unexpected path ${path}`);
    });
    const svc = new JiraIssueService(session, fn);

    const details = await svc.getIssueDetails('ISW-1');
    const detailsCall = calls.find((c) => c.path === 'rest/api/2/issue/ISW-1');
    // No changelog expand — the timeline's history loads lazily via
    // getIssueTimeline (changelog dominates details latency on old issues).
    expect(detailsCall!.opts.query).toEqual({
      fields: '*all',
      expand: 'renderedFields,names',
    });
    expect(details.issue.epicKey).toBe('ISW-100');
    expect(details.issue.epicName).toBe('The Epic');
    expect(details.descriptionHtml).toBe('<p>plain text</p>');
    expect(details.browseUrl).toBe('https://jira.example.com/browse/ISW-1');
    expect(details.transitions).toEqual([{ id: '11', name: 'Start', toStatus: 'In Progress' }]);
    expect(details.comments).toHaveLength(1);
    expect(details.worklogs).toHaveLength(1);
    expect(details.timeline.map((e) => e.kind)).toEqual(['comment', 'worklog']);

    // Second lookup hits the module LRU — no second epic GET.
    const epicCalls = () => calls.filter((c) => c.path === 'rest/api/2/issue/ISW-100');
    expect(epicCalls()).toHaveLength(1);
    await svc.getIssueDetails('ISW-1');
    expect(epicCalls()).toHaveLength(1);
  });
});

describe('JiraIssueService getDistinctIssueField', () => {
  const resolver: JqlFieldResolver = {
    resolveJqlField: async () => 'cf[10101]',
    resolveFieldId: async () => 'customfield_10101',
  };

  it('builds the §6 JQL, requests only the resolved field, dedupes ci and sorts ci', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((_path, opts) => {
      const body = opts.body as any;
      expect(body.jql).toBe('project = ISW AND cf[10101] is not EMPTY');
      expect(body.fields).toEqual(['customfield_10101']);
      expect(body.maxResults).toBe(200);
      expect(opts.timeoutMs).toBe(45_000);
      return {
        issues: [
          { key: 'ISW-1', fields: { customfield_10101: { value: 'beta' } } },
          { key: 'ISW-2', fields: { customfield_10101: 'Alpha' } },
          { key: 'ISW-3', fields: { customfield_10101: ['BETA', { name: 'gamma' }] } },
          { key: 'ISW-4', fields: { customfield_10101: 42 } },
        ],
        startAt: 0,
        total: 4,
      };
    });
    const svc = new JiraIssueService(session, fn);

    const values = await svc.getDistinctIssueField('ISW', 'Severity', 500, resolver);
    expect(values).toEqual(['42', 'Alpha', 'beta', 'gamma']);
    expect(calls).toHaveLength(1);
  });

  it('prefers a Jira user displayName over the login/email name', async () => {
    const session = makeSession();
    const { fn } = mockFetch(() => ({
      issues: [
        {
          key: 'ISW-1',
          fields: {
            customfield_10101: {
              name: 'jane.doe@example.com',
              displayName: 'Jane Doe',
            },
          },
        },
      ],
      total: 1,
    }));
    const svc = new JiraIssueService(session, fn);

    expect(await svc.getDistinctIssueField('ISW', 'Assignee', 200, resolver)).toEqual(['Jane Doe']);
  });
});

// ---------------------------------------------------------------------------
// Worklog service
// ---------------------------------------------------------------------------

describe('JiraWorklogService', () => {
  const worklogResponse = {
    id: 100,
    author: { displayName: 'Me' },
    started: '2026-08-11T08:00:00.000+0000',
    timeSpentSeconds: 3600,
  };

  it('formats started as yyyy-MM-ddTHH:mm:ss.fff+HHmm (offset colon stripped)', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => worklogResponse);
    const svc = new JiraWorklogService(session, fn);

    const result = await svc.addWorklog('ISW-1', 3600, '2026-08-11T08:23:45.123Z');
    const body = calls[0].opts.body as any;
    expect(body.timeSpentSeconds).toBe(3600);
    expect(body.comment).toBeNull();
    expect(body.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
    expect(body.started).not.toMatch(/[+-]\d{2}:\d{2}$/); // no colon in offset
    expect(result.timeSpent).toBe(3600);
    expect(result.issueKey).toBe('ISW-1');
  });

  it('formatWorklogStarted keeps local time and millisecond precision', () => {
    const formatted = formatWorklogStarted(new Date(2026, 4, 4, 8, 23, 45, 123));
    expect(formatted.startsWith('2026-05-04T08:23:45.123')).toBe(true);
    expect(formatted).toMatch(/[+-]\d{4}$/);
  });

  it('throws when the rounded duration is below 60 seconds, without calling Jira', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => worklogResponse);
    const svc = new JiraWorklogService(session, fn);

    await expect(svc.addWorklog('ISW-1', 59, '2026-08-11T08:00:00Z')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('applies adjustEstimate query rules', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => worklogResponse);
    const svc = new JiraWorklogService(session, fn);

    await svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', null, 'auto');
    expect(calls[0].opts.query).toEqual({});

    await svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', null, 'leave');
    expect(calls[1].opts.query).toEqual({ adjustEstimate: 'leave' });

    await svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', null, 'new', '2d');
    expect(calls[2].opts.query).toEqual({ adjustEstimate: 'new', newEstimate: '2d' });

    await svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', null, 'manual', '1h');
    expect(calls[3].opts.query).toEqual({ adjustEstimate: 'manual', reduceBy: '1h' });

    await expect(
      svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', null, 'new'),
    ).rejects.toThrow();
    await expect(
      svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', null, 'manual'),
    ).rejects.toThrow();
  });

  it('translates 401/403 into the permission message', async () => {
    const session = makeSession();
    const { fn } = mockFetch(() => {
      throw new JiraError(403, 'You do not have permission to view this Jira resource.');
    });
    const svc = new JiraWorklogService(session, fn);

    await expect(svc.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z')).rejects.toThrow(
      'You do not have permission to log work on this issue.',
    );
  });

  it('sends ADF comment on cloud and plain string on DC', async () => {
    const dc = new JiraWorklogService(makeSession('datacenter'), mockFetch(() => worklogResponse).fn);
    const { fn: cloudFn, calls: cloudCalls } = mockFetch(() => worklogResponse);
    const cloud = new JiraWorklogService(makeSession('cloud'), cloudFn);

    const { fn: dcFn, calls: dcCalls } = mockFetch(() => worklogResponse);
    const dc2 = new JiraWorklogService(makeSession('datacenter'), dcFn);
    await dc2.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', 'worked');
    expect((dcCalls[0].opts.body as any).comment).toBe('worked');

    await cloud.addWorklog('ISW-1', 3600, '2026-08-11T08:00:00Z', 'worked');
    expect((cloudCalls[0].opts.body as any).comment.type).toBe('doc');
    void dc;
  });
});

// ---------------------------------------------------------------------------
// Board service
// ---------------------------------------------------------------------------

describe('JiraBoardService', () => {
  it('merges greenhopper + agile boards, greenhopper wins on collision, sorted ci', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      if (path === 'rest/greenhopper/1.0/rapidviews/list') {
        return {
          views: [
            { id: '1', name: 'alpha GH', sprintSupportEnabled: true, filter: { id: 5, name: 'F5' } },
            { id: 3, name: 'Zulu', sprintSupportEnabled: false, savedFilterId: 9 },
          ],
        };
      }
      if (path === 'rest/agile/1.0/board') {
        return {
          values: [
            { id: 1, name: 'Alpha Agile', type: 'scrum', location: { projectKey: 'ISW' } },
            { id: 2, name: 'Beta', type: 'kanban', filter: { id: 7, name: 'F7' } },
          ],
          isLast: true,
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraBoardService(session, fn);

    const result = await svc.getBoards();
    expect(result.fromGreenhopper).toBe(2);
    expect(result.fromAgile).toBe(2);
    expect(result.greenhopperError).toBeNull();
    expect(result.agileError).toBeNull();
    expect(result.boards.map((b) => b.name)).toEqual(['alpha GH', 'Beta', 'Zulu']);

    const board1 = result.boards.find((b) => b.id === 1)!;
    expect(board1.name).toBe('alpha GH'); // greenhopper wins
    expect(board1.type).toBe('scrum');
    expect(board1.filterId).toBe(5);
    expect(board1.filterName).toBe('F5');

    const board3 = result.boards.find((b) => b.id === 3)!;
    expect(board3.type).toBe('kanban');
    expect(board3.filterId).toBe(9); // savedFilterId fallback
  });

  it('reports error strings per source', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      if (path === 'rest/greenhopper/1.0/rapidviews/list') throw new JiraError(403, 'denied');
      if (path === 'rest/agile/1.0/board') throw new JiraError(401, 'denied');
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraBoardService(session, fn);

    const result = await svc.getBoards();
    expect(result.greenhopperError).toBe('greenhopper 403');
    expect(result.agileError).toBe('agile 401');
    expect(result.boards).toEqual([]);
  });

  it('reports "greenhopper: no views array" when the payload has no views', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      if (path === 'rest/greenhopper/1.0/rapidviews/list') return { somethingElse: [] };
      if (path === 'rest/agile/1.0/board') return { values: [], isLast: true };
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraBoardService(session, fn);

    const result = await svc.getBoards();
    expect(result.greenhopperError).toBe('greenhopper: no views array');
  });

  it('paginates agile boards by 50 until isLast/short batch', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path, opts) => {
      if (path === 'rest/greenhopper/1.0/rapidviews/list') return { views: [] };
      const startAt = Number(opts.query!.startAt);
      const count = startAt === 0 ? 50 : 10;
      return {
        values: Array.from({ length: count }, (_, i) => ({
          id: startAt + i + 100,
          name: `B${startAt + i}`,
          type: 'scrum',
        })),
        isLast: startAt !== 0,
      };
    });
    const svc = new JiraBoardService(session, fn);

    const result = await svc.getBoards();
    expect(result.fromAgile).toBe(60);
    expect(calls.filter((c) => c.path === 'rest/agile/1.0/board')).toHaveLength(2);
  });

  it('getBoardIssues returns [] on any non-2xx', async () => {
    const session = makeSession();
    const { fn } = mockFetch(() => {
      throw new JiraError(500, 'boom');
    });
    const svc = new JiraBoardService(session, fn);
    expect(await svc.getBoardIssues(7, 'project = ISW')).toEqual([]);
  });

  it('getQuickFilters walks the probe chain and scans nested quickFilters', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path) => {
      if (path.startsWith('rest/greenhopper/1.0/rapidviewconfig/quickfilters')) {
        throw new JiraError(404, 'nope');
      }
      if (path.startsWith('rest/greenhopper/1.0/rapidview/')) {
        return { config: { nested: { quickFilters: [{ id: '3', name: 'Mine', query: 'assignee = me' }] } } };
      }
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraBoardService(session, fn);

    const filters = await svc.getQuickFilters(42);
    expect(filters).toEqual([{ id: 3, name: 'Mine', query: 'assignee = me' }]);
    expect(calls[0].path).toBe('rest/greenhopper/1.0/rapidviewconfig/quickfilters?rapidViewId=42');
    expect(calls[1].path).toBe('rest/greenhopper/1.0/rapidview/42');
    expect(calls).toHaveLength(2); // stopped at first non-empty result
  });
});

// ---------------------------------------------------------------------------
// Metadata service
// ---------------------------------------------------------------------------

describe('JiraMetadataService', () => {
  it('distinct + sorts simple lists; versions/components ci-sorted and [] on failure', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      if (path === 'rest/api/2/project') return [{ key: 'ZZZ' }, { key: 'ISW' }, { key: 'ISW' }];
      if (path === 'rest/api/2/project/ISW/versions') return [{ name: 'beta' }, { name: 'Alpha' }];
      if (path === 'rest/api/2/project/BAD/versions') throw new JiraError(404, 'no');
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraMetadataService(session, fn);

    expect(await svc.getProjects()).toEqual(['ISW', 'ZZZ']);
    expect(await svc.getVersions('ISW')).toEqual(['Alpha', 'beta']);
    expect(await svc.getVersions('BAD')).toEqual([]);
  });

  it('assignable users: username=., page 50, stops on short batch, ci sort', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((_path, opts) => {
      const startAt = Number(opts.query!.startAt);
      expect(opts.query!.username).toBe('.');
      expect(opts.query!.project).toBe('ISW');
      expect(opts.timeoutMs).toBe(10_000);
      if (startAt === 0) {
        return Array.from({ length: 50 }, (_, i) => ({ displayName: `User ${String(i).padStart(2, '0')}` }));
      }
      return [{ displayName: 'aaron' }];
    });
    const svc = new JiraMetadataService(session, fn);

    const users = await svc.getAssignableUsers('ISW');
    expect(calls).toHaveLength(2);
    expect(users).toHaveLength(51);
    expect(users[0]).toBe('aaron'); // ci sort
  });

  it('field suggestions add predicateName=project when a default project is set', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => ({ results: [{ value: 'S1' }, { value: 'S1' }, { value: 'S2' }] }));
    const svc = new JiraMetadataService(session, fn);

    const values = await svc.getFieldSuggestions('Severity', 'S');
    expect(values).toEqual(['S1', 'S2']);
    expect(calls[0].opts.query).toEqual({
      fieldName: 'Severity',
      fieldValue: 'S',
      predicateName: 'project',
      predicateValue: 'ISW',
    });
  });

  it('lists visible system and custom field names for JQL autocomplete', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      expect(path).toBe('rest/api/2/field');
      return [
        { id: 'status', name: 'Status' },
        { id: 'customfield_10001', name: 'Epic Link' },
        { id: 'customfield_10002', name: 'Epic Link' },
      ];
    });
    const svc = new JiraMetadataService(session, fn);

    expect(await svc.getFields()).toEqual(['Epic Link', 'Status']);
  });

  it('resolveJqlField: cf[NNNN] for custom fields, id for system, quoted for unknown, alias table', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path) => {
      if (path === 'rest/api/2/field') {
        return [
          { id: 'customfield_10101', name: 'Severity' },
          { id: 'status', name: 'Status' },
          { id: 'labels', name: 'Labels' },
        ];
      }
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraMetadataService(session, fn);

    expect(await svc.resolveJqlField('Severity')).toBe('cf[10101]');
    expect(await svc.resolveJqlField('Status')).toBe('status');
    expect(await svc.resolveJqlField('No Such Field')).toBe('"No Such Field"');
    // normalized match (punctuation stripped)
    expect(await svc.resolveJqlField('severity!')).toBe('cf[10101]');
    // alias table
    expect(await svc.resolveJqlField('Defect Status')).toBe('status');
    expect(await svc.resolveJqlField('Priority & Severity')).toBe('cf[10101]');
    expect(await svc.resolveJqlField('Bugs Mapping')).toBe('labels');
    // field map loaded once
    expect(calls.filter((c) => c.path === 'rest/api/2/field')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Dashboard service
// ---------------------------------------------------------------------------

describe('JiraDashboardService', () => {
  it('pages dashboards by 50 until total reached', async () => {
    const session = makeSession();
    const total = 60;
    const { fn, calls } = mockFetch((path, opts) => {
      if (path !== 'rest/api/2/dashboard') throw new Error(`unexpected ${path}`);
      const startAt = Number(opts.query!.startAt);
      const count = Math.min(50, total - startAt);
      return {
        dashboards: Array.from({ length: count }, (_, i) => ({
          id: startAt + i + 1,
          name: `Dash ${startAt + i + 1}`,
          owner: { displayName: 'Owner' },
          view: 'https://x/view',
          isFavourite: (startAt + i) % 2 === 0,
        })),
        total,
      };
    });
    const svc = new JiraDashboardService(session, fn);

    const dashboards = await svc.getDashboards();
    expect(dashboards).toHaveLength(60);
    // favourites page + page 1 + page 2 (parallel, deduped by id)
    expect(calls).toHaveLength(3);
    expect(dashboards[0]).toEqual({
      id: '1',
      name: 'Dash 1',
      owner: 'Owner',
      viewUrl: 'https://x/view',
      isFavourite: true,
    });
  });

  it('details keep raw JSON gadget ids and skip gadget failures', async () => {
    const session = makeSession();
    const { fn } = mockFetch((path) => {
      if (path === 'rest/api/2/dashboard/77') return { id: 77, name: 'Ops' };
      if (path === 'rest/api/2/dashboard/77/gadget') {
        return { gadgets: [{ id: 5, title: 'Filter Results', moduleKey: 'mk' }, { id: 'g-2', title: 'Chart', moduleKey: '' }] };
      }
      if (path === 'rest/api/2/dashboard/88') return { id: 88, name: 'NoGadgets' };
      if (path === 'rest/api/2/dashboard/88/gadget') throw new JiraError(404, 'no');
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraDashboardService(session, fn);

    const details = await svc.getDashboardDetails('77');
    expect(details.summary.id).toBe('77');
    expect(details.gadgets).toEqual([
      { id: '5', title: 'Filter Results', moduleKey: 'mk', supported: false },
      { id: '"g-2"', title: 'Chart', moduleKey: '', supported: false },
    ]);

    const noGadgets = await svc.getDashboardDetails('88');
    expect(noGadgets.gadgets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Create issue service
// ---------------------------------------------------------------------------

describe('JiraCreateIssueService', () => {
  it('falls back to path B when path A yields zero fields', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path, opts) => {
      if (path === 'rest/api/2/issue/createmeta') return { projects: [] };
      if (path === 'rest/api/2/issuetype') return [{ id: 10001, name: 'Bug' }];
      if (path === 'rest/api/2/issue/createmeta/ISW/issuetypes/10001') {
        expect(opts.query).toEqual({ startAt: 0, maxResults: 50 });
        return {
          values: [
            {
              fieldId: 'summary',
              name: 'Summary',
              required: true,
              schema: { type: 'string' },
              allowedValues: ['literal', { value: 'v' }, { name: 'n' }, { displayName: 'd' }],
            },
          ],
          isLast: true,
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraCreateIssueService(session, fn);

    const meta = await svc.getCreateMeta('ISW', 'Bug');
    expect(meta.projectKey).toBe('ISW');
    expect(meta.issueType).toBe('Bug');
    expect(meta.fields).toEqual([
      {
        fieldId: 'summary',
        displayName: 'Summary',
        required: true,
        schemaType: 'string',
        allowedValues: ['literal', 'v', 'n', 'd'],
      },
    ]);
    expect(calls[0].opts.query).toEqual({
      projectKeys: 'ISW',
      issuetypeNames: 'Bug',
      expand: 'projects.issuetypes.fields',
    });
  });

  it('uses path A fields when present, without touching path B', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch((path) => {
      if (path === 'rest/api/2/issue/createmeta') {
        return {
          projects: [
            { issuetypes: [{ fields: { summary: { name: 'Summary', required: true, schema: { type: 'string' } } } }] },
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const svc = new JiraCreateIssueService(session, fn);

    const meta = await svc.getCreateMeta('ISW', 'Bug');
    expect(meta.fields).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('createIssue merges project/issuetype into fields and returns the key', async () => {
    const session = makeSession();
    const { fn, calls } = mockFetch(() => ({ key: 'ISW-999' }));
    const svc = new JiraCreateIssueService(session, fn);

    const key = await svc.createIssue('ISW', 'Bug', { summary: 'New bug' });
    expect(key).toBe('ISW-999');
    expect(calls[0].path).toBe('rest/api/2/issue');
    expect(calls[0].opts.body).toEqual({
      fields: { summary: 'New bug', project: { key: 'ISW' }, issuetype: { name: 'Bug' } },
    });
  });

  it('createIssue wraps rejections with the "Jira rejected the issue" message', async () => {
    const session = makeSession();
    const { fn } = mockFetch(() => {
      throw new JiraError(400, 'summary: Summary is required');
    });
    const svc = new JiraCreateIssueService(session, fn);

    await expect(svc.createIssue('ISW', 'Bug', {})).rejects.toThrow(
      /^Jira rejected the issue: 400/,
    );
  });
});

// ---------------------------------------------------------------------------
// Cached decorators
// ---------------------------------------------------------------------------

function makeBoard(id: number, name: string): JiraBoard {
  return { id, name, type: 'scrum', projectKey: null, projectName: null, filterId: null, filterName: null };
}

function boardResult(boards: JiraBoard[]): BoardLoadResult {
  return { boards, fromGreenhopper: boards.length, fromAgile: 0, greenhopperError: null, agileError: null };
}

class FakeBoardService implements BoardServiceLike {
  callCount = 0;
  result: BoardLoadResult = boardResult([makeBoard(1, 'Alpha')]);

  async getBoards(): Promise<BoardLoadResult> {
    this.callCount++;
    return this.result;
  }
  async getActiveSprints(): Promise<never[]> {
    return [];
  }
  async getBoardIssues(): Promise<never[]> {
    return [];
  }
  async getQuickFilters(): Promise<never[]> {
    return [];
  }
}

describe('CachedBoardService', () => {
  function setup() {
    const kv = new MemoryKvStore();
    const repo = new MetadataCacheRepo(kv);
    const inner = new FakeBoardService();
    const svc = new CachedBoardService(inner, repo);
    return { kv, repo, inner, svc };
  }

  /** Age every cached entry, the analogue of UPDATE ... SET UpdatedUtc. */
  function backdate(kv: MemoryKvStore, ms: number): void {
    for (const [key, record] of kv.snapshot('metadataCache')) {
      kv.set('metadataCache', key, record.json, Date.now() - ms);
    }
  }

  it('uses the exact cache key meta:default:boards', async () => {
    const { repo, svc } = setup();
    expect(BOARDS_CACHE_KEY).toBe('meta:default:boards');
    await svc.getBoards();
    expect(repo.get('meta:default:boards')).not.toBeNull();
  });

  it('fresh miss fetches from inner and stores non-empty results', async () => {
    const { repo, inner, svc } = setup();
    const result = await svc.getBoards();
    expect(inner.callCount).toBe(1);
    expect(result.boards.map((b) => b.name)).toEqual(['Alpha']);
    const entry = repo.get(BOARDS_CACHE_KEY)!;
    expect(entry).not.toBeNull();
    // PascalCase blob per storage convention
    expect(JSON.parse(entry.json)[0].Name).toBe('Alpha');
  });

  it('hit within TTL returns immediately with "served from cache" and no refetch', async () => {
    const { inner, svc } = setup();
    await svc.getBoards();
    const cached = await svc.getBoards();
    await tick();
    expect(inner.callCount).toBe(1); // no refetch
    expect(cached.boards.map((b) => b.name)).toEqual(['Alpha']);
    expect(cached.fromGreenhopper).toBe(1);
    expect(cached.fromAgile).toBe(0);
    expect(cached.greenhopperError).toBe('served from cache');
    expect(cached.agileError).toBeNull();
  });

  it('stale hit returns immediately and queues a background refetch+store', async () => {
    const { kv, repo, inner, svc } = setup();
    await svc.getBoards();
    backdate(kv, 31 * 24 * 60 * 60 * 1000); // older than 30 d TTL

    inner.result = boardResult([makeBoard(2, 'Fresh')]);
    const cached = await svc.getBoards();
    expect(cached.boards.map((b) => b.name)).toEqual(['Alpha']); // immediate stale value
    expect(cached.greenhopperError).toBe('served from cache (refresh queued)');

    await tick();
    expect(inner.callCount).toBe(2); // background refetch happened
    const entry = repo.get(BOARDS_CACHE_KEY)!;
    expect(JSON.parse(entry.json)[0].Name).toBe('Fresh');
  });

  it('does not store an empty fresh result', async () => {
    const { repo, inner, svc } = setup();
    inner.result = boardResult([]);
    await svc.getBoards();
    expect(repo.get(BOARDS_CACHE_KEY)).toBeNull();
  });
});

class FakeMetadataService implements MetadataServiceLike {
  projectsCalls = 0;
  suggestionCalls: Array<{ field: string; query: string | null | undefined }> = [];

  async getProjects(): Promise<string[]> {
    this.projectsCalls++;
    return ['ISW', 'ZZZ'];
  }
  async getIssueTypes(): Promise<string[]> {
    return ['Bug'];
  }
  async getStatuses(): Promise<string[]> {
    return ['Open'];
  }
  async getPriorities(): Promise<string[]> {
    return ['High'];
  }
  async getResolutions(): Promise<string[]> {
    return ['Done'];
  }
  async getFields(): Promise<string[]> {
    return ['Status', 'Epic Link'];
  }
  async getVersions(): Promise<string[]> {
    return [];
  }
  async getComponents(): Promise<string[]> {
    return ['Core'];
  }
  async getAssignableUsers(): Promise<string[]> {
    return ['Me'];
  }
  async getFieldSuggestions(field: string, query?: string | null): Promise<string[]> {
    this.suggestionCalls.push({ field, query });
    return ['S1'];
  }
  async resolveFieldId(): Promise<string | null> {
    return null;
  }
  async resolveJqlField(name: string): Promise<string> {
    return `"${name}"`;
  }
}

describe('CachedMetadataService', () => {
  function setup() {
    const kv = new MemoryKvStore();
    const repo = new MetadataCacheRepo(kv);
    const inner = new FakeMetadataService();
    const svc = new CachedMetadataService(inner, repo);
    return { kv, repo, inner, svc };
  }

  it('stores under meta:v10:default:{suffix} and serves hits without refetch', async () => {
    const { repo, inner, svc } = setup();
    expect(await svc.getProjects()).toEqual(['ISW', 'ZZZ']);
    expect(repo.get('meta:v10:default:projects')).not.toBeNull();

    await svc.getProjects();
    await tick();
    expect(inner.projectsCalls).toBe(1); // second call served from cache

    await svc.getComponents('ISW');
    expect(repo.get('meta:v10:default:components:ISW')).not.toBeNull();
    await svc.getAssignableUsers('ISW');
    expect(repo.get('meta:v10:default:users:ISW')).not.toBeNull();
    await svc.getFields();
    expect(repo.get('meta:v10:default:fields')).not.toBeNull();
  });

  it('stale hit returns immediately then refreshes in the background', async () => {
    const { kv, repo, inner, svc } = setup();
    await svc.getProjects();
    for (const [key, record] of kv.snapshot('metadataCache')) {
      kv.set('metadataCache', key, record.json, Date.now() - 15 * 24 * 60 * 60 * 1000); // > 14 d
    }

    const stale = await svc.getProjects();
    expect(stale).toEqual(['ISW', 'ZZZ']); // immediate
    await tick();
    expect(inner.projectsCalls).toBe(2); // background refetch
    expect(repo.get('meta:v10:default:projects')).not.toBeNull();
  });

  it('does not store empty fresh results', async () => {
    const { repo, svc } = setup();
    expect(await svc.getVersions('ISW')).toEqual([]);
    expect(repo.get('meta:v10:default:versions:ISW')).toBeNull();
  });

  it('skips the cache for typed suggestion queries, caches blank-query suggestions', async () => {
    const { repo, inner, svc } = setup();

    await svc.getFieldSuggestions('Severity', 'S3');
    await svc.getFieldSuggestions('Severity', 'S3');
    expect(inner.suggestionCalls).toHaveLength(2); // pass-through every time
    expect(repo.get('meta:v10:default:sugg:severity')).toBeNull();

    await svc.getFieldSuggestions('Severity');
    expect(repo.get('meta:v10:default:sugg:severity')).not.toBeNull();
    await svc.getFieldSuggestions('Severity');
    expect(inner.suggestionCalls).toHaveLength(3); // cached second time
  });

  it('getDistinct caches under the v2 display-name-aware key', async () => {
    const { repo, svc } = setup();
    let loads = 0;
    const loader = async () => {
      loads++;
      return ['A', 'B'];
    };
    expect(await svc.getDistinct('ISW', 'Severity', loader)).toEqual(['A', 'B']);
    expect(repo.get('meta:v10:default:distinct:v2:ISW:severity')).not.toBeNull();
    expect(await svc.getDistinct('ISW', 'Severity', loader)).toEqual(['A', 'B']);
    expect(loads).toBe(1);
  });

  it('resolutions and resolveJqlField pass through uncached', async () => {
    const { repo, svc } = setup();
    expect(await svc.getResolutions()).toEqual(['Done']);
    expect(await svc.resolveJqlField('Foo')).toBe('"Foo"');
    expect(repo.get('meta:v10:default:resolutions')).toBeNull();
  });
});
