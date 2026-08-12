import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapIssue,
  mapUser,
  mapWorklog,
  normalizeJiraDate,
  tryFindSprint,
  extractAllSprints,
  extractAllFields,
  extractParent,
  tryReadIssueRef,
  buildTimeline,
  adfParagraph,
  setSeverityFieldId,
  setRejectReasonsFieldId,
  setPriorityFieldId,
  setSprintFieldId,
  resetFieldIds,
} from '../src/jira/mapper.js';
import type { JiraComment, JiraWorklog } from '../src/types.js';

beforeEach(() => {
  resetFieldIds();
});

// ---------------------------------------------------------------------------
// Fixture: DC-shaped issue with greenhopper sprint strings, parent, customs
// ---------------------------------------------------------------------------

const ghClosed =
  'com.atlassian.greenhopper.service.sprint.Sprint@1f4c[id=41,rapidViewId=7,state=CLOSED,name=Sprint 41,startDate=2026-03-01T08:00:00.000+0200,endDate=2026-03-14T18:00:00.000+0200,completeDate=2026-03-14T18:00:00.000+0200,sequence=41]';
const ghActive =
  'com.atlassian.greenhopper.service.sprint.Sprint@2a9b[id=42,rapidViewId=7,state=ACTIVE,name=Sprint 42,startDate=2026-03-15T08:00:00.000+0200,endDate=2026-03-28T18:00:00.000+0200,completeDate=<null>,sequence=42]';

function dcIssue(): any {
  return {
    key: 'ISW-1234',
    fields: {
      summary: 'Fix the flux capacitor',
      issuetype: { name: 'Bug' },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Critical' },
      assignee: { displayName: 'Jane Doe' },
      reporter: { displayName: 'John Roe' },
      project: { key: 'ISW' },
      created: '2026-05-04T08:23:45.123+0000',
      updated: '2026-06-01T10:00:00.000+0300',
      timespent: 3600,
      timeestimate: 7200,
      timeoriginalestimate: 14400,
      labels: ['blocked', 'regression'],
      components: [{ name: 'Engine' }],
      fixVersions: [{ name: '1.2.0' }],
      customfield_10005: [ghClosed, ghActive],
      parent: {
        key: 'ISW-1000',
        fields: { issuetype: { name: 'Epic' }, summary: 'Big Epic' },
      },
      'Severity': { value: 'S3' },
      'Reject Reasons': 'Not reproducible',
    },
  };
}

// ---------------------------------------------------------------------------
// mapIssue
// ---------------------------------------------------------------------------

describe('mapIssue', () => {
  it('maps core fields from a DC-shaped issue', () => {
    const issue = mapIssue(dcIssue());
    expect(issue.key).toBe('ISW-1234');
    expect(issue.summary).toBe('Fix the flux capacitor');
    expect(issue.issueType).toBe('Bug');
    expect(issue.status).toBe('In Progress');
    expect(issue.statusCategory).toBe('indeterminate');
    expect(issue.priority).toBe('Critical');
    expect(issue.assignee).toBe('Jane Doe');
    expect(issue.reporter).toBe('John Roe');
    expect(issue.projectKey).toBe('ISW');
    expect(issue.timeSpent).toBe(3600);
    expect(issue.remainingEstimate).toBe(7200);
    expect(issue.originalEstimate).toBe(14400);
    expect(issue.labels).toEqual(['blocked', 'regression']);
    expect(issue.components).toEqual(['Engine']);
    expect(issue.fixVersions).toEqual(['1.2.0']);
    expect(issue.boardNames).toEqual([]);
    expect(issue.boardIds).toEqual([]);
  });

  it('normalizes created/updated date offsets', () => {
    const issue = mapIssue(dcIssue());
    expect(issue.created).toBe('2026-05-04T08:23:45.123+00:00');
    expect(issue.updated).toBe('2026-06-01T10:00:00.000+03:00');
  });

  it('resolves the active greenhopper sprint string and all sprints', () => {
    const issue = mapIssue(dcIssue());
    expect(issue.sprint).toBe('Sprint 42');
    expect(issue.allSprints).toHaveLength(2);
    const names = issue.allSprints.map((s) => s.name);
    expect(names).toContain('Sprint 41');
    expect(names).toContain('Sprint 42');
    const active = issue.allSprints.find((s) => s.name === 'Sprint 42')!;
    expect(active.state.toLowerCase()).toBe('active');
    expect(active.startDate).toBe('2026-03-15T08:00:00.000+02:00');
    expect(active.endDate).toBe('2026-03-28T18:00:00.000+02:00');
  });

  it('sets isBlocked from labels and isCritical from priority', () => {
    const issue = mapIssue(dcIssue());
    expect(issue.isBlocked).toBe(true);
    expect(issue.isCritical).toBe(true);
  });

  it('isBlocked from status name, isCritical for Highest, false otherwise', () => {
    const el = dcIssue();
    el.fields.labels = [];
    el.fields.status.name = 'Blocked';
    el.fields.priority.name = 'Highest';
    let issue = mapIssue(el);
    expect(issue.isBlocked).toBe(true);
    expect(issue.isCritical).toBe(true);

    el.fields.status.name = 'Open';
    el.fields.priority.name = 'Medium';
    issue = mapIssue(el);
    expect(issue.isBlocked).toBe(false);
    expect(issue.isCritical).toBe(false);
  });

  it('reads Severity and Reject Reasons from direct label keys', () => {
    const issue = mapIssue(dcIssue());
    expect(issue.severity).toBe('S3');
    expect(issue.rejectReasons).toBe('Not reproducible');
  });

  it('falls back to discovered field ids for severity/rejectReasons/priority', () => {
    const el = dcIssue();
    delete el.fields['Severity'];
    delete el.fields['Reject Reasons'];
    delete el.fields.priority;
    el.fields.customfield_20001 = { value: 'S4' };
    el.fields.customfield_20002 = ['Duplicate', 'Won’t fix'];
    el.fields.customfield_20003 = { value: 'P2' };
    setSeverityFieldId('customfield_20001');
    setRejectReasonsFieldId('customfield_20002');
    setPriorityFieldId('customfield_20003');
    const issue = mapIssue(el);
    expect(issue.severity).toBe('S4');
    expect(issue.rejectReasons).toBe('Duplicate, Won’t fix');
    expect(issue.priority).toBe('P2');
  });

  it('setSprintFieldId is accepted and resettable', () => {
    expect(() => setSprintFieldId('customfield_10005')).not.toThrow();
    expect(() => resetFieldIds()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Epic resolution precedence
// ---------------------------------------------------------------------------

describe('epic resolution precedence', () => {
  it('(1) fields.epic wins over parent and custom fields', () => {
    const el = dcIssue();
    el.fields.epic = { key: 'ISW-500', name: 'Epic Field Name' };
    el.fields.customfield_10014 = 'ISW-99';
    const issue = mapIssue(el);
    expect(issue.epicKey).toBe('ISW-500');
    expect(issue.epicName).toBe('Epic Field Name');
  });

  it('(2) parent used only when parent issuetype is Epic (or missing)', () => {
    const el = dcIssue();
    const issue = mapIssue(el);
    expect(issue.epicKey).toBe('ISW-1000');
    expect(issue.epicName).toBe('Big Epic');

    const noType = dcIssue();
    delete noType.fields.parent.fields.issuetype;
    expect(mapIssue(noType).epicKey).toBe('ISW-1000');
  });

  it('(2) parent of a non-Epic issuetype is skipped, custom field fallback used', () => {
    const el = dcIssue();
    el.fields.parent.fields.issuetype.name = 'Story';
    el.fields.customfield_10014 = 'ISW-99';
    const issue = mapIssue(el);
    expect(issue.epicKey).toBe('ISW-99');
  });

  it('(3) custom field probe order: customfield_10014 before customfield_10008', () => {
    const el = dcIssue();
    delete el.fields.parent;
    el.fields.customfield_10008 = 'ISW-88';
    el.fields.customfield_10014 = 'ISW-14';
    expect(mapIssue(el).epicKey).toBe('ISW-14');

    delete el.fields.customfield_10014;
    expect(mapIssue(el).epicKey).toBe('ISW-88');
  });

  it('(3) non-key-shaped custom field strings are ignored', () => {
    const el = dcIssue();
    delete el.fields.parent;
    el.fields.customfield_10014 = 'not-a-key';
    expect(mapIssue(el).epicKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeJiraDate
// ---------------------------------------------------------------------------

describe('normalizeJiraDate', () => {
  it('inserts colon into ±HHmm offsets', () => {
    expect(normalizeJiraDate('2026-05-04T08:23:45.123+0000')).toBe('2026-05-04T08:23:45.123+00:00');
    expect(normalizeJiraDate('2026-05-04T08:23:45.123-0530')).toBe('2026-05-04T08:23:45.123-05:30');
    expect(normalizeJiraDate('2026-05-04T08:23:45.123+0300')).toBe('2026-05-04T08:23:45.123+03:00');
  });

  it('leaves already-normalized and Z dates alone', () => {
    expect(normalizeJiraDate('2026-05-04T08:23:45.123+03:00')).toBe('2026-05-04T08:23:45.123+03:00');
    expect(normalizeJiraDate('2026-05-04T08:23:45Z')).toBe('2026-05-04T08:23:45Z');
  });

  it('returns null for null/undefined/empty', () => {
    expect(normalizeJiraDate(null)).toBeNull();
    expect(normalizeJiraDate(undefined)).toBeNull();
    expect(normalizeJiraDate('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sprint extraction
// ---------------------------------------------------------------------------

describe('sprint extraction', () => {
  it('tryFindSprint reads top-level fields.sprint object first', () => {
    const sprint = tryFindSprint({ sprint: { name: 'Top Sprint', state: 'active' } });
    expect(sprint?.name).toBe('Top Sprint');
  });

  it('tryFindSprint prefers active object element over non-active', () => {
    const sprint = tryFindSprint({
      customfield_10005: [
        { name: 'Old', state: 'closed', boardId: 7 },
        { name: 'Now', state: 'ACTIVE', boardId: 7 },
      ],
    });
    expect(sprint?.name).toBe('Now');
  });

  it('tryFindSprint falls back to first non-active when nothing active', () => {
    const sprint = tryFindSprint({
      customfield_10005: [{ name: 'Old', state: 'closed', boardId: 7 }],
    });
    expect(sprint?.name).toBe('Old');
  });

  it('tryFindSprint ignores object elements without sprint-ish properties', () => {
    const sprint = tryFindSprint({ customfield_10999: [{ name: 'NotASprint' }] });
    expect(sprint).toBeNull();
  });

  it('tryFindSprint parses greenhopper strings and prefers ACTIVE', () => {
    const sprint = tryFindSprint({ customfield_10005: [ghClosed, ghActive] });
    expect(sprint?.name).toBe('Sprint 42');
  });

  it('tryFindSprint ignores strings not containing "Sprint"', () => {
    expect(tryFindSprint({ customfield_10005: ['nothing to see, name=X, state=ACTIVE'] })).toBeNull();
  });

  it('extractAllSprints dedupes by name (ci) across forms', () => {
    const sprints = extractAllSprints({
      customfield_10005: [ghActive, ghClosed],
      customfield_10006: [{ name: 'sprint 42', state: 'active', boardId: 7 }],
    });
    expect(sprints).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// extractAllFields
// ---------------------------------------------------------------------------

describe('extractAllFields', () => {
  it('skips well-known fields, hides labels, formats values, drops beans, sorts', () => {
    const fields = {
      summary: 'skipped',
      status: { name: 'skipped' },
      parent: { key: 'skipped' },
      customfield_10050: 'dev panel',
      customfield_10051: 'ISW-1',
      customfield_10052: 5,
      customfield_10053: ghActive,
      customfield_10054: { value: 'High' },
      customfield_10055: [{ name: 'Alpha' }, { name: 'Beta' }],
      customfield_10056: '',
      customfield_10057: null,
      customfield_10058: true,
      customfield_10059: 'plain text',
    };
    const names = {
      customfield_10050: 'Development',
      customfield_10051: 'Epic Link',
      customfield_10052: 'Story Points',
      customfield_10053: 'Sprint',
      customfield_10054: 'Risk',
      customfield_10055: 'Teams',
      customfield_10056: 'Empty',
      customfield_10057: 'Nothing',
      customfield_10058: 'Flag',
      customfield_10059: 'Zebra Note',
    };
    const all = extractAllFields(fields, names);
    const keys = all.map((f) => f.key);
    expect(keys).not.toContain('summary');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('parent');
    expect(keys).not.toContain('Development'); // hidden substring
    expect(keys).not.toContain('Epic Link'); // hidden exact
    expect(keys).not.toContain('Sprint'); // java bean value dropped
    expect(keys).not.toContain('Empty');
    expect(keys).not.toContain('Nothing');
    expect(all.find((f) => f.key === 'Story Points')?.value).toBe('5');
    expect(all.find((f) => f.key === 'Risk')?.value).toBe('High');
    expect(all.find((f) => f.key === 'Teams')?.value).toBe('Alpha, Beta');
    expect(all.find((f) => f.key === 'Flag')?.value).toBe('true');
    // sorted by label ci
    expect(keys).toEqual([...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect(keys[keys.length - 1]).toBe('Zebra Note');
  });

  it('hides "Tasks Checklist" / "To Do List Proxy" / "Validation List" substrings', () => {
    const fields = {
      customfield_1: 'x',
      customfield_2: 'x',
      customfield_3: 'x',
    };
    const names = {
      customfield_1: 'My Tasks Checklist Field',
      customfield_2: 'To Do List Proxy',
      customfield_3: 'The Validation List Thing',
    };
    expect(extractAllFields(fields, names)).toEqual([]);
  });

  it('uses the field id as label when names has no entry', () => {
    const all = extractAllFields({ customfield_9: 'val' }, {});
    expect(all).toEqual([{ key: 'customfield_9', value: 'val' }]);
  });

  it('drops bracket-@-equals java bean strings', () => {
    const all = extractAllFields({ customfield_9: '[bean@12ab, x=1]' }, { customfield_9: 'Bean' });
    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractParent
// ---------------------------------------------------------------------------

describe('extractParent', () => {
  it('(1) uses fields.parent.key with label "Parent"', () => {
    const parent = extractParent(
      { parent: { key: 'ISW-1', fields: { summary: 'The parent' } } },
      {},
    );
    expect(parent).toEqual({ parentKey: 'ISW-1', parentSummary: 'The parent', parentFieldLabel: 'Parent' });
  });

  it('(2) uses a custom field whose label contains "parent"', () => {
    const parent = extractParent(
      { customfield_777: { key: 'ISW-2' } },
      { customfield_777: 'IM: Parent Issue' },
    );
    expect(parent.parentKey).toBe('ISW-2');
    expect(parent.parentFieldLabel).toBe('IM: Parent Issue');
  });

  it('(3) uses issuelinks with a parent-ish type', () => {
    const parent = extractParent(
      {
        issuelinks: [
          {
            type: { name: 'Parent/Child', inward: 'is child of', outward: 'is parent of' },
            inwardIssue: { key: 'ISW-3', fields: { summary: 'Linked parent' } },
          },
        ],
      },
      {},
    );
    expect(parent.parentKey).toBe('ISW-3');
    expect(parent.parentSummary).toBe('Linked parent');
    expect(parent.parentFieldLabel).toBe('is child of');
  });

  it('(3) falls back to outwardIssue when no inwardIssue', () => {
    const parent = extractParent(
      {
        issuelinks: [
          {
            type: { name: 'Parent/Child', inward: 'is child of', outward: 'is parent of' },
            outwardIssue: { key: 'ISW-4' },
          },
        ],
      },
      {},
    );
    expect(parent.parentKey).toBe('ISW-4');
    expect(parent.parentFieldLabel).toBe('is parent of');
  });

  it('(4) uses key-shaped strings in customfield_10006/10008/10014, then epic labels', () => {
    const p1 = extractParent({ customfield_10006: 'ISW-6' }, {});
    expect(p1.parentKey).toBe('ISW-6');

    const p2 = extractParent({ customfield_555: 'ISW-55' }, { customfield_555: 'Epic Link Custom' });
    expect(p2.parentKey).toBe('ISW-55');
  });

  it('returns nulls when nothing matches', () => {
    expect(extractParent({}, {})).toEqual({ parentKey: null, parentSummary: null, parentFieldLabel: null });
  });

  it('tryReadIssueRef handles objects, strings, wrapped values, arrays', () => {
    expect(tryReadIssueRef({ key: 'ISW-9' })).toBe('ISW-9');
    expect(tryReadIssueRef('ISW-10')).toBe('ISW-10');
    expect(tryReadIssueRef('nope')).toBeNull();
    expect(tryReadIssueRef({ value: 'ISW-11' })).toBe('ISW-11');
    expect(tryReadIssueRef(['nope', { key: 'ISW-12' }])).toBe('ISW-12');
    expect(tryReadIssueRef(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildTimeline
// ---------------------------------------------------------------------------

describe('buildTimeline', () => {
  it('merges changes, comments, worklogs sorted ascending by time', () => {
    const histories = [
      {
        created: '2026-05-03T10:00:00.000+0000',
        author: { displayName: 'Changer' },
        items: [{ field: 'status', fromString: 'Open', toString: 'In Progress' }],
      },
    ];
    const comments: JiraComment[] = [
      { author: 'Commenter', created: '2026-05-02T09:00:00.000+00:00', body: 'first!' },
    ];
    const worklogs: JiraWorklog[] = [
      {
        id: '1',
        issueKey: 'ISW-1',
        author: 'Logger',
        authorAccountId: null,
        started: '2026-05-04T08:00:00.000+00:00',
        timeSpent: 5400,
        comment: 'dug in',
      },
    ];
    const timeline = buildTimeline({ histories, comments, worklogs });
    expect(timeline.map((e) => e.kind)).toEqual(['comment', 'change', 'worklog']);
    expect(timeline[0].author).toBe('Commenter');
    expect(timeline[0].summary).toBe('first!');
    expect(timeline[1].summary).toBe('status: Open → In Progress');
    expect(timeline[2].summary).toBe('+1.5h — dug in');
  });

  it('uses em-dash for missing change values', () => {
    const timeline = buildTimeline({
      histories: [
        {
          created: '2026-05-03T10:00:00.000+0000',
          author: { displayName: 'C' },
          items: [{ field: 'labels', fromString: null, toString: 'blocked' }],
        },
      ],
    });
    expect(timeline[0].summary).toBe('labels: — → blocked');
  });

  it('truncates comments at 280 chars with ellipsis', () => {
    const body = 'a'.repeat(300);
    const timeline = buildTimeline({
      comments: [{ author: 'X', created: '2026-05-01T00:00:00.000+00:00', body }],
    });
    expect(timeline[0].summary).toBe('a'.repeat(280) + '…');
  });

  it('formats worklog hours with up to two decimals, no trailing zeros', () => {
    const wl = (seconds: number): JiraWorklog => ({
      id: '1',
      issueKey: 'ISW-1',
      author: 'L',
      authorAccountId: null,
      started: '2026-05-01T00:00:00.000+00:00',
      timeSpent: seconds,
      comment: null,
    });
    expect(buildTimeline({ worklogs: [wl(7200)] })[0].summary).toBe('+2h');
    expect(buildTimeline({ worklogs: [wl(4500)] })[0].summary).toBe('+1.25h');
    expect(buildTimeline({ worklogs: [wl(1200)] })[0].summary).toBe('+0.33h');
  });
});

// ---------------------------------------------------------------------------
// mapUser / mapWorklog / adfParagraph
// ---------------------------------------------------------------------------

describe('mapUser', () => {
  it('maps a Cloud user via accountId', () => {
    const user = mapUser({
      accountId: 'abc123',
      displayName: 'Cloudy',
      emailAddress: 'c@x.com',
      avatarUrls: { '48x48': 'http://a/48.png' },
      active: true,
    });
    expect(user).toEqual({
      accountId: 'abc123',
      displayName: 'Cloudy',
      emailAddress: 'c@x.com',
      avatarUrl: 'http://a/48.png',
      active: true,
    });
  });

  it('maps a DC user via key/name fallback', () => {
    expect(mapUser({ key: 'jdoe', displayName: 'J Doe' }).accountId).toBe('jdoe');
    expect(mapUser({ name: 'jdoe2', displayName: 'J Doe' }).accountId).toBe('jdoe2');
  });
});

describe('mapWorklog', () => {
  it('maps a DC worklog with normalized started date', () => {
    const wl = mapWorklog('ISW-1', {
      id: 1001,
      author: { displayName: 'J Doe', accountId: 'abc' },
      started: '2026-05-04T08:23:45.123+0300',
      timeSpentSeconds: 3600,
      comment: 'did stuff',
    });
    expect(wl).toEqual({
      id: '1001',
      issueKey: 'ISW-1',
      author: 'J Doe',
      authorAccountId: 'abc',
      started: '2026-05-04T08:23:45.123+03:00',
      timeSpent: 3600,
      comment: 'did stuff',
    });
  });

  it('extracts text from an ADF comment body (Cloud)', () => {
    const wl = mapWorklog('ISW-1', {
      id: 2,
      author: { displayName: 'C' },
      started: '2026-05-04T08:00:00.000+0000',
      timeSpentSeconds: 60,
      comment: adfParagraph('cloud note'),
    });
    expect(wl.comment).toBe('cloud note');
  });
});

describe('adfParagraph', () => {
  it('builds the ADF doc shape', () => {
    expect(adfParagraph('hello')).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
  });
});
