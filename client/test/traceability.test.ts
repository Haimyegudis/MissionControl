import { describe, expect, it, vi } from 'vitest';
import { confluencePageIds, confluenceReferences, documentIssueLinks, resolveEpicHierarchy } from '../src/lib/traceability';
import type { JiraIssueDetails } from '../src/types';

function details(key: string, issueType: string, parentKey: string | null, epicKey: string | null): JiraIssueDetails {
  return {
    issue: {
      originalOrder: 0, isStarred: false, key, summary: key, issueType, status: 'Open', statusCategory: 'new',
      priority: 'S3', assignee: null, reporter: null, projectKey: 'ISW', sprint: null, created: '', updated: '',
      timeSpent: null, remainingEstimate: null, originalEstimate: null, epicKey, epicName: null, allSprints: [],
      workLoggedForPeriod: null, labels: [], components: [], fixVersions: [], boardNames: [], boardIds: [],
      isBlocked: false, isCritical: false, recentlyChanged: false, rejectReasons: null, changeSummary: null, severity: null,
    },
    description: '', descriptionHtml: null, comments: [], worklogs: [], transitions: [], allFields: [], browseUrl: null,
    parentKey, parentSummary: null, parentFieldLabel: null, timeline: [],
  };
}

describe('resolveEpicHierarchy', () => {
  it('resolves a QA task through its parent story to the epic', async () => {
    const rows = new Map([
      ['ISW-10', details('ISW-10', 'QA Task', 'ISW-20', 'ISW-99')],
      ['ISW-20', details('ISW-20', 'Story', null, 'ISW-30')],
      ['ISW-30', details('ISW-30', 'Epic', null, null)],
      ['ISW-99', details('ISW-99', 'Epic', null, null)],
    ]);
    const load = vi.fn(async (key: string) => rows.get(key)!);
    const result = await resolveEpicHierarchy('ISW-10', load);
    expect(result.parent?.issue.key).toBe('ISW-20');
    expect(result.epic.issue.key).toBe('ISW-30');
    expect(result.chain.map((item) => item.issue.key)).toEqual(['ISW-10', 'ISW-20', 'ISW-30']);
    expect(load).not.toHaveBeenCalledWith('ISW-99');
  });

  it('accepts an epic directly', async () => {
    const epic = details('ISW-30', 'Epic', null, null);
    const result = await resolveEpicHierarchy('ISW-30', async () => epic);
    expect(result.parent).toBeNull();
    expect(result.epic).toBe(epic);
  });
});

describe('documentIssueLinks', () => {
  it('selects SWR, DR, and integration records from an epic link set', () => {
    const links = [
      { key: 'ISW-1', summary: 'Software Requirements', issueType: 'Story', relationship: 'relates to' },
      { key: 'ISW-2', summary: 'Design package', issueType: 'DR', relationship: 'implements' },
      { key: 'ISW-3', summary: 'Integration plan', issueType: 'Task', relationship: 'tests' },
      { key: 'ISW-4', summary: 'Unrelated defect', issueType: 'Bug', relationship: 'relates to' },
    ];
    expect(documentIssueLinks(links).map((link) => link.key)).toEqual(['ISW-1', 'ISW-2', 'ISW-3']);
  });
});

describe('confluencePageIds', () => {
  it('reads direct pages from Jira document custom fields', () => {
    const epic = details('ISW-30', 'Epic', null, null);
    epic.allFields = [
      { key: 'Link to DR', value: '[Link 1|https://docs.example/pages/viewpage.action?pageId=621544608] ' },
      { key: 'Link to Integration Form', value: 'https://docs.example/pages/621544609/Form' },
      { key: 'Link to UX', value: 'https://docs.example/pages/viewpage.action?pageId=621544610' },
      { key: 'Link to Integration Form', value: 'https://docs.example/display/SWSE/Integration+Report' },
      { key: 'Unrelated', value: 'https://docs.example/pages/999/Ignore' },
    ];
    expect(confluencePageIds(epic)).toEqual(['621544608', '621544609', '621544610']);
    expect(confluenceReferences(epic)).toContainEqual({ spaceKey: 'SWSE', title: 'Integration Report' });
  });
});
