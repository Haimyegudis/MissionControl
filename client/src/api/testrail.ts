// Typed fetch client for /api/testrail/* (Phase 3 — unified-deck plan T12).
// Mirrors api/client.ts style, but errors carry the TestRail routes' shape
// ({ error, statusCode, body } → TrApiError). A 401 here means "TestRail not
// connected", not a lost Jira session, so no session-lost event is emitted.

import type {
  TrAddCasePayload,
  TrCase,
  TrMeta,
  TrPlanRun,
  TrPrefetchProgress,
  TrProject,
  TrResult,
  TrRun,
  TrSection,
  TrSessionStatus,
  TrSuite,
  TrTest,
  TrUser,
} from '../testrailTypes';

export class TrApiError extends Error {
  readonly status: number;
  /** TestRail's own HTTP status when the server relayed a 502. */
  readonly trStatus: number | null;
  readonly body: string | null;

  constructor(status: number, message: string, trStatus: number | null = null, body: string | null = null) {
    super(message);
    this.name = 'TrApiError';
    this.status = status;
    this.trStatus = trStatus;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data: unknown = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        /* non-JSON body */
      }
    }
  }

  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; statusCode?: number | null; body?: string | null };
    throw new TrApiError(
      res.status,
      typeof err.error === 'string' && err.error ? err.error : `Request failed (${res.status})`,
      err.statusCode ?? null,
      err.body ?? null,
    );
  }

  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

const fresh = (flag?: boolean) => (flag ? '?fresh=1' : '');
const freshAmp = (flag?: boolean) => (flag ? '&fresh=1' : '');

export const trApi = {
  // ---- session ----
  session: () => get<TrSessionStatus>('/api/testrail/session'),
  connect: (body: { baseUrl: string; email: string; apiKey: string }) =>
    post<{ connected: boolean; user: TrUser }>('/api/testrail/session', body),
  disconnect: () => del<void>('/api/testrail/session'),

  // ---- reference data ----
  meta: (projectId?: number | null, force?: boolean) =>
    get<TrMeta>(`/api/testrail/meta?projectId=${projectId ?? ''}${freshAmp(force)}`),
  projects: (force?: boolean) => get<TrProject[]>(`/api/testrail/projects${fresh(force)}`),

  // ---- suites / sections / cases ----
  suites: (projectId: number, force?: boolean) =>
    get<TrSuite[]>(`/api/testrail/projects/${projectId}/suites${fresh(force)}`),
  sections: (projectId: number, suiteId: number, force?: boolean) =>
    get<TrSection[]>(`/api/testrail/projects/${projectId}/sections?suiteId=${suiteId}${freshAmp(force)}`),
  cases: (projectId: number, suiteId: number, force?: boolean) =>
    get<TrCase[]>(`/api/testrail/projects/${projectId}/cases?suiteId=${suiteId}${freshAmp(force)}`),
  addSection: (
    projectId: number,
    body: { suiteId: number | null; parentId: number | null; name: string; description: string | null },
  ) => post<TrSection>(`/api/testrail/projects/${projectId}/sections`, body),
  updateSection: (sectionId: number, name: string, description: string | null) =>
    put<TrSection>(`/api/testrail/sections/${sectionId}`, { name, description }),
  deleteSection: (sectionId: number) => del<void>(`/api/testrail/sections/${sectionId}`),
  casesByRef: (ref: string, projectIds: number[]) =>
    get<
      Array<{
        id: number;
        title: string;
        refs: string | null;
        suiteId: number;
        suiteName: string;
        projectId: number;
        projectName: string;
      }>
    >(`/api/testrail/cases-by-ref?ref=${encodeURIComponent(ref)}&projects=${projectIds.join(',')}`),
  addCase: (sectionId: number, payload: TrAddCasePayload) =>
    post<TrCase>(`/api/testrail/sections/${sectionId}/cases`, payload),
  updateCase: (caseId: number, payload: TrAddCasePayload) =>
    put<TrCase>(`/api/testrail/cases/${caseId}`, payload),
  deleteCase: (caseId: number) => del<void>(`/api/testrail/cases/${caseId}`),
  bulkUpdateCases: (
    caseIds: number[],
    set: { ownerId?: number; assignedToId?: number; priorityId?: number; typeId?: number },
  ) =>
    put<{ updated: number; failures: Array<{ id: number; error: string }> }>('/api/testrail/cases/bulk', {
      caseIds,
      set,
    }),
  copyCases: (targetSectionId: number, caseIds: number[]) =>
    post<void>('/api/testrail/cases/copy', { targetSectionId, caseIds }),
  moveCases: (targetSectionId: number, targetSuiteId: number | null, caseIds: number[]) =>
    post<void>('/api/testrail/cases/move', { targetSectionId, targetSuiteId, caseIds }),

  // ---- runs / tests / results ----
  runs: (projectId: number, force?: boolean) =>
    get<TrRun[]>(`/api/testrail/projects/${projectId}/runs${fresh(force)}`),
  planRuns: (projectId: number, force?: boolean) =>
    get<TrPlanRun[]>(`/api/testrail/projects/${projectId}/planruns${fresh(force)}`),
  addRun: (
    projectId: number,
    body: {
      suiteId: number | null;
      name: string;
      description: string | null;
      refs: string | null;
      assignedToId: number | null;
      /** true → TestRail include_all (future suite cases auto-included); caseIds omitted. */
      includeAll: boolean;
      caseIds?: number[];
    },
  ) => post<TrRun>(`/api/testrail/projects/${projectId}/runs`, body),
  updateRun: (runId: number, body: { name: string | null; description: string | null; refs: string | null }) =>
    put<TrRun>(`/api/testrail/runs/${runId}`, body),
  closeRun: (runId: number) => post<void>(`/api/testrail/runs/${runId}/close`),
  deleteRun: (runId: number) => del<void>(`/api/testrail/runs/${runId}`),
  tests: (runId: number, force?: boolean) => get<TrTest[]>(`/api/testrail/runs/${runId}/tests${fresh(force)}`),
  runResults: (runId: number, force?: boolean) =>
    get<TrResult[]>(`/api/testrail/runs/${runId}/results${fresh(force)}`),
  testResults: (testId: number) => get<TrResult[]>(`/api/testrail/tests/${testId}/results`),
  addResult: (
    testId: number,
    body: { statusId: number; comment?: string | null; defects?: string | null; elapsed?: string | null; version?: string | null },
  ) => post<void>(`/api/testrail/tests/${testId}/results`, body),

  // ---- cache / prefetch ----
  prefetch: (projectIds: number[]) =>
    post<{ started: boolean; active?: boolean }>('/api/testrail/prefetch', { projectIds }),
  prefetchStatus: () => get<TrPrefetchProgress>('/api/testrail/prefetch/status'),
  clearCache: () => del<void>('/api/testrail/cache'),

  // ---- people ----
  people: () => get<Record<string, string>>('/api/testrail/people'),
  setPeople: (people: Record<string, string>) => put<void>('/api/testrail/people', people),
};
