// TestRail plan-run tests (Phase 2 — unified-deck plan T7): get_plans paging
// → per-plan get_plan/{id} → entries[].runs[] flattening, per TestRailClient.cs
// GetPlanRunsAsync.

import { describe, expect, it, vi } from 'vitest';
import { TestRailClient } from '../src/testrail/client.js';
import type { TestRailHttp } from '../src/testrail/httpClient.js';

function makeClient(responses: Record<string, unknown>) {
  const getJson = vi.fn(async (cmd: string) => {
    if (!(cmd in responses)) throw new Error(`Unexpected command: ${cmd}`);
    return structuredClone(responses[cmd]);
  });
  const http = { getJson, postJson: vi.fn() } as unknown as TestRailHttp;
  return { client: new TestRailClient(http), getJson };
}

describe('TestRailClient.getPlanRuns', () => {
  it('flattens entries[].runs[] across all plans, stamping the planId', async () => {
    const { client, getJson } = makeClient({
      'get_plans/7&limit=250&offset=0': { plans: [{ id: 11 }, { id: 12 }], _links: { next: null } },
      'get_plan/11': {
        entries: [
          {
            runs: [
              { id: 101, suite_id: 5, name: 'Plan run A', is_completed: false, created_on: 1700000001 },
              { id: 102, suite_id: 5, name: 'Plan run B', is_completed: true, created_on: 1700000002 },
            ],
          },
          { runs: [] },
        ],
      },
      'get_plan/12': {
        entries: [{ runs: [{ id: 201, name: 'Other plan run' }] }],
      },
    });

    const runs = await client.getPlanRuns(7);
    expect(runs).toEqual([
      { id: 101, suiteId: 5, name: 'Plan run A', planId: 11, isCompleted: false, createdOn: 1700000001 },
      { id: 102, suiteId: 5, name: 'Plan run B', planId: 11, isCompleted: true, createdOn: 1700000002 },
      { id: 201, suiteId: null, name: 'Other plan run', planId: 12, isCompleted: false, createdOn: null },
    ]);
    expect(getJson).toHaveBeenCalledWith('get_plans/7&limit=250&offset=0');
    expect(getJson).toHaveBeenCalledWith('get_plan/11');
    expect(getJson).toHaveBeenCalledWith('get_plan/12');
  });

  it('skips plans without an entries array and ignores non-positive plan ids', async () => {
    const { client, getJson } = makeClient({
      'get_plans/7&limit=250&offset=0': { plans: [{ id: 11 }, { id: 0 }, {}], _links: { next: null } },
      'get_plan/11': { name: 'No entries here' },
    });

    expect(await client.getPlanRuns(7)).toEqual([]);
    expect(getJson).toHaveBeenCalledTimes(2); // get_plans + get_plan/11 only
  });

  it('handles the bare-array form of get_plans', async () => {
    const { client } = makeClient({
      'get_plans/7&limit=250&offset=0': [{ id: 21 }],
      'get_plan/21': { entries: [{ runs: [{ id: 301, name: 'R', is_completed: false }] }] },
    });

    const runs = await client.getPlanRuns(7);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: 301, planId: 21 });
  });
});
