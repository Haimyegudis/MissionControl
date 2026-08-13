// TestRail mapping tests (Phase 2 — unified-deck plan T7): snake_case JSON →
// camelCase types, custom-field mappings, write payload keys, and base URL
// normalization — mirroring TestRailClient.cs ReadCase/AddCaseAsync behavior.

import { describe, expect, it, vi } from 'vitest';
import { TestRailClient } from '../src/testrail/client.js';
import { TestRailApiError, TestRailHttp, buildApiBaseUrl } from '../src/testrail/httpClient.js';

function makeClient(getJsonImpl: (cmd: string) => unknown) {
  const getJson = vi.fn(async (cmd: string) => structuredClone(getJsonImpl(cmd)));
  const postJson = vi.fn(async () => ({}));
  const http = { getJson, postJson } as unknown as TestRailHttp;
  return { client: new TestRailClient(http), getJson, postJson };
}

const CASE_JSON = {
  id: 42,
  title: 'Login works',
  section_id: 7,
  suite_id: 3,
  priority_id: 2,
  type_id: 6,
  template_id: 1,
  created_by: 11,
  updated_by: 12,
  created_on: 1700000000,
  updated_on: 1700000500,
  refs: 'ISW-1,ISW-2',
  estimate: '5m',
  custom_preconds: 'User exists',
  custom_steps: 'Do things',
  custom_expected: 'It works',
  custom_testcaseowner: 55,
  case_assignedto_id: 66,
  custom_steps_separated: [
    { content: 'Open login page', expected: 'Page shown' },
    { content: 'Submit credentials', expected: 'Dashboard shown' },
  ],
};

describe('TestRail case mapping', () => {
  it('maps a full case incl. custom_testcaseowner→ownerId and case_assignedto_id→assignedToId', async () => {
    const { client } = makeClient(() => [CASE_JSON]);
    const [mapped] = await client.getCases(1, 3, null);
    expect(mapped).toEqual({
      id: 42,
      title: 'Login works',
      sectionId: 7,
      suiteId: 3,
      priorityId: 2,
      typeId: 6,
      templateId: 1,
      createdBy: 11,
      updatedBy: 12,
      createdOn: 1700000000,
      updatedOn: 1700000500,
      refs: 'ISW-1,ISW-2',
      estimate: '5m',
      preconds: 'User exists',
      steps: 'Do things',
      expected: 'It works',
      ownerId: 55,
      assignedToId: 66,
      stepsSeparated: [
        { index: 1, action: 'Open login page', expected: 'Page shown' },
        { index: 2, action: 'Submit credentials', expected: 'Dashboard shown' },
      ],
    });
  });

  it('falls back to custom_test_case_owner when custom_testcaseowner is absent', async () => {
    const json = { ...CASE_JSON } as Record<string, unknown>;
    delete json.custom_testcaseowner;
    json.custom_test_case_owner = 77;
    const { client } = makeClient(() => [json]);
    const [mapped] = await client.getCases(1);
    expect(mapped.ownerId).toBe(77);
  });

  it('missing optional fields map to null and empty stepsSeparated', async () => {
    const { client } = makeClient(() => [{ id: 1, title: 'Bare' }]);
    const [mapped] = await client.getCases(1);
    expect(mapped.ownerId).toBeNull();
    expect(mapped.assignedToId).toBeNull();
    expect(mapped.preconds).toBeNull();
    expect(mapped.stepsSeparated).toEqual([]);
  });

  it('getCases builds the command from suiteId and sectionId', async () => {
    const { client, getJson } = makeClient(() => []);
    await client.getCases(9, 234516, 5);
    expect(getJson).toHaveBeenCalledWith('get_cases/9&suite_id=234516&section_id=5&limit=250&offset=0');
    await client.getCases(9);
    expect(getJson).toHaveBeenCalledWith('get_cases/9&limit=250&offset=0');
  });

  it('getUsers scopes to a project via get_users&project_id', async () => {
    const { client, getJson } = makeClient(() => []);
    await client.getUsers(12);
    expect(getJson).toHaveBeenCalledWith('get_users&project_id=12&limit=250&offset=0');
    await client.getUsers();
    expect(getJson).toHaveBeenCalledWith('get_users&limit=250&offset=0');
  });

  it('runs map assignedto_id→assignedToId; tests default status_id to 3 and get runId stamped', async () => {
    const { client } = makeClient((cmd) =>
      cmd.startsWith('get_runs/')
        ? [{ id: 1, project_id: 4, assignedto_id: 9, passed_count: 2 }]
        : [{ id: 10, case_id: 42, title: 'T' }],
    );
    const [run] = await client.getRuns(4);
    expect(run.assignedToId).toBe(9);
    expect(run.passedCount).toBe(2);

    const [test] = await client.getTests(123);
    expect(test.statusId).toBe(3);
    expect(test.runId).toBe(123); // stamped because get_tests omits run_id
  });

  it('addCase/updateCase write payloads use custom_* keys incl. custom_testcaseowner', async () => {
    const { client, postJson } = makeClient(() => []);
    await client.addCase(7, {
      title: 'New case',
      typeId: 6,
      priorityId: 2,
      estimate: '3m',
      refs: 'ISW-9',
      description: 'Desc',
      preconds: 'Pre',
      steps: 'Steps',
      expected: 'Exp',
      ownerId: 55,
    });
    expect(postJson).toHaveBeenCalledWith('add_case/7', {
      title: 'New case',
      type_id: 6,
      priority_id: 2,
      estimate: '3m',
      refs: 'ISW-9',
      custom_description: 'Desc',
      custom_preconds: 'Pre',
      custom_steps: 'Steps',
      custom_expected: 'Exp',
      custom_testcaseowner: 55,
    });

    await client.updateCase(42, { title: 'Renamed' });
    expect(postJson).toHaveBeenCalledWith('update_case/42', { title: 'Renamed' });
  });

  it('addRun always sends include_all=false with the explicit case ids', async () => {
    const { client, postJson } = makeClient(() => []);
    await client.addRun(4, { suiteId: 3, name: 'Nightly', description: null, caseIds: [1, 2], refs: null });
    expect(postJson).toHaveBeenCalledWith('add_run/4', {
      suite_id: 3,
      name: 'Nightly',
      description: null,
      include_all: false,
      case_ids: [1, 2],
      refs: null,
    });
  });

  it('moveCasesToSection includes suite_id only when a target suite is given', async () => {
    const { client, postJson } = makeClient(() => []);
    await client.moveCasesToSection(9, null, [1]);
    expect(postJson).toHaveBeenCalledWith('move_cases_to_section/9', { case_ids: [1] });
    await client.moveCasesToSection(9, 33, [1]);
    expect(postJson).toHaveBeenCalledWith('move_cases_to_section/9', { suite_id: 33, case_ids: [1] });
  });
});

describe('buildApiBaseUrl', () => {
  it('appends index.php?/api/v2/ to a bare host', () => {
    expect(buildApiBaseUrl('https://example.testrail.io')).toBe(
      'https://example.testrail.io/index.php?/api/v2/',
    );
  });

  it('keeps an application path, trimming trailing slashes', () => {
    expect(buildApiBaseUrl('https://host.example.com/testrail/')).toBe(
      'https://host.example.com/testrail/index.php?/api/v2/',
    );
  });

  it('strips everything from /index.php onwards (case-insensitive)', () => {
    expect(buildApiBaseUrl('https://host.example.com/testrail/INDEX.PHP?/api/v2/')).toBe(
      'https://host.example.com/testrail/index.php?/api/v2/',
    );
    expect(buildApiBaseUrl('https://host.example.com/index.php?/api/v2/')).toBe(
      'https://host.example.com/index.php?/api/v2/',
    );
  });

  it('preserves a non-default port and rejects invalid URLs', () => {
    expect(buildApiBaseUrl('http://host.example.com:8080/')).toBe(
      'http://host.example.com:8080/index.php?/api/v2/',
    );
    expect(() => buildApiBaseUrl('not a url')).toThrow(TestRailApiError);
  });
});
