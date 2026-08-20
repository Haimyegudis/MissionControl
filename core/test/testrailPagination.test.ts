// TestRail pagination tests (Phase 2 — unified-deck plan T7): the getPaged
// port of C# GetPagedItemsAsync against a mocked TestRailHttp.

import { describe, expect, it, vi } from 'vitest';
import { TestRailClient } from '../src/testrail/client.js';
import type { TestRailHttp } from '../src/testrail/httpClient.js';

function makeClient(pages: unknown[]): { client: TestRailClient; getJson: ReturnType<typeof vi.fn> } {
  let call = 0;
  const getJson = vi.fn(async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;
    return structuredClone(page);
  });
  const http = { getJson, postJson: vi.fn() } as unknown as TestRailHttp;
  return { client: new TestRailClient(http), getJson };
}

function items(from: number, count: number): Array<{ id: number }> {
  return Array.from({ length: count }, (_, i) => ({ id: from + i }));
}

const readId = (e: any): number => e.id as number;

describe('TestRailClient.getPaged', () => {
  it('array form: a single short page returns without further requests', async () => {
    const { client, getJson } = makeClient([items(1, 3)]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true });
    expect(result).toEqual([1, 2, 3]);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith('get_cases/1&limit=250&offset=0');
  });

  it('array form: a full page stops immediately when paginateArrayForm is off', async () => {
    const { client, getJson } = makeClient([items(1, 250)]);
    const result = await client.getPaged('get_sections/1', 'sections', readId);
    expect(result).toHaveLength(250);
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('array form: full pages advance offset by the limit until a short page', async () => {
    const { client, getJson } = makeClient([items(1, 250), items(251, 2)]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true });
    expect(result).toHaveLength(252);
    expect(getJson).toHaveBeenNthCalledWith(1, 'get_cases/1&limit=250&offset=0');
    expect(getJson).toHaveBeenNthCalledWith(2, 'get_cases/1&limit=250&offset=250');
  });

  it('array form: a repeated first-item signature stops the loop', async () => {
    const page = items(1, 250);
    const { client, getJson } = makeClient([page, page, page]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true });
    // C# keeps the duplicate array page but stops requesting further ones.
    expect(result).toHaveLength(500);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('array form: maxItems caps the number of pages fetched', async () => {
    const { client, getJson } = makeClient([items(1, 250), items(251, 250)]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, {
      paginateArrayForm: true,
      maxItems: 200,
    });
    expect(result).toHaveLength(250);
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('wrapped form: follows _links.next across pages, advancing by page size', async () => {
    const { client, getJson } = makeClient([
      { cases: items(1, 2), _links: { next: '/api/v2/get_cases/1&offset=2' } },
      { cases: items(3, 2), _links: { next: null } },
    ]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true });
    expect(result).toEqual([1, 2, 3, 4]);
    expect(getJson).toHaveBeenNthCalledWith(1, 'get_cases/1&limit=250&offset=0');
    expect(getJson).toHaveBeenNthCalledWith(2, 'get_cases/1&limit=250&offset=2');
  });

  it('wrapped form: missing _links means the full result set was returned', async () => {
    const { client, getJson } = makeClient([{ cases: items(1, 5) }]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true });
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('wrapped form: a duplicate page is dropped and pagination stops', async () => {
    const page = { cases: items(1, 3), _links: { next: '/next' } };
    const { client, getJson } = makeClient([page, page, page]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true });
    // Server ignored the offset -> the repeated page is removed again.
    expect(result).toEqual([1, 2, 3]);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('wrapped form: maxItems stops after the page that reaches the cap', async () => {
    const { client, getJson } = makeClient([
      { cases: items(1, 3), _links: { next: '/next' } },
      { cases: items(4, 3), _links: { next: '/next' } },
      { cases: items(7, 3), _links: { next: '/next' } },
    ]);
    const result = await client.getPaged('get_cases/1', 'cases', readId, {
      paginateArrayForm: true,
      maxItems: 5,
    });
    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('wrapped form: an empty page or missing array property ends the loop', async () => {
    const empty = makeClient([{ cases: [], _links: { next: '/next' } }]);
    expect(await empty.client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true })).toEqual([]);

    const missing = makeClient([{ something_else: [1] }]);
    expect(await missing.client.getPaged('get_cases/1', 'cases', readId, { paginateArrayForm: true })).toEqual([]);
  });
});
