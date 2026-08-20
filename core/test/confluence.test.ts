import { describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../src/types.js';
import { ConfluenceService, isIndigoSpace } from '../src/confluence/service.js';

const credentials: Credentials = {
  email: '', jiraBaseUrl: '', jiraPat: '', instanceType: 'datacenter', defaultProjectKey: 'ISW',
  testRailBaseUrl: '', testRailEmail: '', testRailApiKey: '',
  confluenceBaseUrl: 'https://confluence.example.com', confluencePat: 'secret',
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('Confluence Indigo boundary', () => {
  it('recognizes Indigo spaces and excludes unrelated spaces', () => {
    expect(isIndigoSpace({ id: 1, key: 'INDIGO', name: 'Docs', type: 'global', status: 'current', description: '', labels: [] })).toBe(true);
    expect(isIndigoSpace({ id: 2, key: 'X', name: 'HP Indigo Engineering', type: 'global', status: 'current', description: '', labels: [] })).toBe(true);
    expect(isIndigoSpace({ id: 3, key: 'HR', name: 'People', type: 'global', status: 'current', description: '', labels: [] })).toBe(false);
    expect(isIndigoSpace({ id: 4, key: 'REQ', name: 'Software Requirements', type: 'global', status: 'current', description: '', labels: [] })).toBe(true);
    expect(isIndigoSpace({ id: 5, key: 'PSWA', name: 'Press SW Apps', type: 'global', status: 'current', description: '', labels: [] })).toBe(true);
    expect(isIndigoSpace({ id: 6, key: 'UEK', name: 'UX Engineering Knowledge', type: 'global', status: 'current', description: '', labels: [] })).toBe(true);
    expect(isIndigoSpace({ id: 7, key: 'SWSE', name: 'Software System Engineering', type: 'global', status: 'current', description: '', labels: [] })).toBe(true);
  });

  it('returns only Indigo spaces from the upstream catalog', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('status=current')) return response({ results: [
        { id: 1, key: 'IND', name: 'Indigo Product', type: 'global', status: 'current', description: { plain: { value: '' } }, metadata: { labels: { results: [] } } },
        { id: 2, key: 'HR', name: 'People', type: 'global', status: 'current', description: { plain: { value: '' } }, metadata: { labels: { results: [] } } },
      ] });
      return response({ results: [] });
    }) as unknown as typeof fetch;
    const service = new ConfluenceService({ load: () => credentials }, fetchFn);
    await expect(service.spaces()).resolves.toMatchObject([{ key: 'IND' }]);
  });

  it('always injects the allowed Indigo space list into CQL', async () => {
    let cql = '';
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/rest/api/space')) return response({ results: url.searchParams.get('status') === 'current' ? [
        { id: 1, key: 'IND', name: 'Indigo', type: 'global', status: 'current', description: { plain: { value: '' } }, metadata: { labels: { results: [] } } },
      ] : [] });
      cql = url.searchParams.get('cql') ?? '';
      return response({ results: [] });
    }) as unknown as typeof fetch;
    const service = new ConfluenceService({ load: () => credentials }, fetchFn);
    await service.search({ query: 'press workflow', title: 'setup', creator: 'jsmith' });
    expect(cql).toContain('type=page');
    expect(cql).toContain('space in ("IND")');
    expect(cql).toContain('text~"press workflow"');
    expect(cql).toContain('creator="jsmith"');
  });

  it('rejects direct page access outside Indigo', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/rest/api/content/99?')) return response({ id: '99', title: 'Private', status: 'current', space: { key: 'HR' }, version: { number: 1 }, body: { storage: { value: '<p>x</p>' }, view: { value: '<p>x</p>' } } });
      if (url.includes('status=current')) return response({ results: [{ id: 1, key: 'IND', name: 'Indigo', type: 'global', status: 'current', description: { plain: { value: '' } }, metadata: { labels: { results: [] } } }] });
      return response({ results: [] });
    }) as unknown as typeof fetch;
    const service = new ConfluenceService({ load: () => credentials }, fetchFn);
    await expect(service.requirePage('99')).rejects.toMatchObject({ status: 403 });
  });
});
