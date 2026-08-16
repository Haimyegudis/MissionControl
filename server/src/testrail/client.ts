import type { TestRailHttp } from './httpClient.js';
import type {
  TrAddCasePayload,
  TrCase,
  TrCaseType,
  TrPlanRun,
  TrPriority,
  TrProject,
  TrResult,
  TrRun,
  TrSection,
  TrStatus,
  TrStep,
  TrSuite,
  TrTest,
  TrUser,
} from './types.js';

/**
 * TestRail API client (Phase 2 — unified-deck plan T7).
 * Faithful port of C:\APPS\TestRailWeb\TestRail\TestRailClient.cs:
 * dup-guard pagination, snake_case→camelCase mapping incl.
 * custom_testcaseowner→ownerId and case_assignedto_id→assignedToId,
 * and get_plans→get_plan plan-run flattening.
 */

/** Narrow structural interface so routes/tests can mock the client. */
export interface TestRailClientLike {
  getProjects(): Promise<TrProject[]>;
  getSuites(projectId: number): Promise<TrSuite[]>;
  getSections(projectId: number, suiteId?: number | null): Promise<TrSection[]>;
  getCases(projectId: number, suiteId?: number | null, sectionId?: number | null): Promise<TrCase[]>;
  getCurrentUser(): Promise<TrUser>;
  getUsers(projectId?: number | null): Promise<TrUser[]>;
  getStatuses(): Promise<TrStatus[]>;
  getCaseTypes(): Promise<TrCaseType[]>;
  getPriorities(): Promise<TrPriority[]>;
  getRuns(projectId: number): Promise<TrRun[]>;
  getPlanRuns(projectId: number): Promise<TrPlanRun[]>;
  getTests(runId: number): Promise<TrTest[]>;
  getResultsForTest(testId: number): Promise<TrResult[]>;
  getResultsForRun(runId: number): Promise<TrResult[]>;
  addResultExtended(testId: number, result: AddResultRequest): Promise<void>;
  addRun(projectId: number, request: AddRunRequest): Promise<TrRun>;
  updateRun(runId: number, request: UpdateRunRequest): Promise<TrRun>;
  closeRun(runId: number): Promise<void>;
  deleteRun(runId: number): Promise<void>;
  addSection(projectId: number, request: AddSectionRequest): Promise<TrSection>;
  updateSection(sectionId: number, name: string, description?: string | null): Promise<TrSection>;
  deleteSection(sectionId: number): Promise<void>;
  moveSection(sectionId: number, parentId?: number | null, afterId?: number | null): Promise<void>;
  addCase(sectionId: number, payload: TrAddCasePayload): Promise<TrCase>;
  updateCase(caseId: number, payload: TrAddCasePayload): Promise<TrCase>;
  deleteCase(caseId: number): Promise<void>;
  copyCasesToSection(targetSectionId: number, caseIds: number[]): Promise<void>;
  moveCasesToSection(targetSectionId: number, targetSuiteId: number | null, caseIds: number[]): Promise<void>;
  getRaw(cmd: string): Promise<unknown>;
}

export interface AddResultRequest {
  statusId: number;
  comment?: string | null;
  defects?: string | null;
  elapsed?: string | null;
  version?: string | null;
}

export interface AddRunRequest {
  suiteId?: number | null;
  name: string;
  description?: string | null;
  refs?: string | null;
  /** TestRail assignedto_id — the run's assignee. */
  assignedToId?: number | null;
  /** true → include_all (case_ids omitted; future suite cases auto-included). */
  includeAll?: boolean;
  /** Explicit case snapshot; required unless includeAll is true. */
  caseIds?: number[];
}

export interface UpdateRunRequest {
  name?: string | null;
  description?: string | null;
  refs?: string | null;
}

export interface AddSectionRequest {
  suiteId?: number | null;
  parentId?: number | null;
  name: string;
  description?: string | null;
}

export interface GetPagedOptions {
  /** Also loop `&limit/&offset` when the server answers with a bare array. */
  paginateArrayForm?: boolean;
  /** Stop once at least this many items accumulated. */
  maxItems?: number;
}

export class TestRailClient implements TestRailClientLike {
  constructor(private readonly http: TestRailHttp) {}

  // -------------------------------------------------------------------------
  // Pagination — EXACT port of C# GetPagedItemsAsync
  // -------------------------------------------------------------------------

  /**
   * Page through `{baseCommand}&limit=250&offset=N`. Handles both response
   * shapes (bare array and `{arrayProperty:[…], _links:{next}}`) with the C#
   * duplicate-first-item-signature guards: a repeated wrapped page is dropped
   * and pagination stops; a repeated array page stops without re-adding.
   */
  async getPaged<T>(
    baseCommand: string,
    arrayProperty: string,
    read: (element: any) => T,
    opts: GetPagedOptions = {},
  ): Promise<T[]> {
    const limit = 250;
    let offset = 0;
    const allItems: T[] = [];
    let previousPageFirstSignature: string | null = null;
    let previousWrappedFirstSignature: string | null = null;

    for (;;) {
      const command = `${baseCommand}&limit=${limit}&offset=${offset}`;
      const root = await this.http.getJson(command);

      if (Array.isArray(root)) {
        let pageCount = 0;
        let firstItemSignature: string | null = null;
        for (const item of root) {
          if (firstItemSignature === null) firstItemSignature = JSON.stringify(item);
          allItems.push(read(item));
          pageCount++;
        }

        if (!opts.paginateArrayForm || pageCount < limit) return allItems;
        if (opts.maxItems !== undefined && allItems.length >= opts.maxItems) return allItems;
        if (firstItemSignature !== null && firstItemSignature === previousPageFirstSignature) {
          return allItems;
        }
        previousPageFirstSignature = firstItemSignature;
        offset += limit;
        continue;
      }

      const array = root !== null && typeof root === 'object' ? root[arrayProperty] : undefined;
      if (!Array.isArray(array)) return allItems;

      let wrappedCount = 0;
      let wrappedFirstSignature: string | null = null;
      const startIndex = allItems.length;
      for (const item of array) {
        if (wrappedFirstSignature === null) wrappedFirstSignature = JSON.stringify(item);
        allItems.push(read(item));
        wrappedCount++;
      }

      if (wrappedCount === 0) return allItems;

      // Server returned same first item as previous page -> pagination not
      // honored, stop and drop the duplicate page.
      if (wrappedFirstSignature !== null && wrappedFirstSignature === previousWrappedFirstSignature) {
        allItems.splice(startIndex, wrappedCount);
        return allItems;
      }
      previousWrappedFirstSignature = wrappedFirstSignature;

      if (opts.maxItems !== undefined && allItems.length >= opts.maxItems) return allItems;

      const links = root._links;
      if (links !== null && typeof links === 'object' && !Array.isArray(links)) {
        if (hasNoNextPage(links)) return allItems;
      } else {
        // No pagination metadata -> assume server returned the full result set.
        return allItems;
      }

      offset += wrappedCount;
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  getProjects(): Promise<TrProject[]> {
    return this.getPaged('get_projects&is_completed=0', 'projects', readProject);
  }

  async getSuites(projectId: number): Promise<TrSuite[]> {
    const root = await this.http.getJson(`get_suites/${projectId}`);
    return readPagedOrArray(root, 'suites', readSuite);
  }

  getSections(projectId: number, suiteId?: number | null): Promise<TrSection[]> {
    const command =
      suiteId === null || suiteId === undefined
        ? `get_sections/${projectId}`
        : `get_sections/${projectId}&suite_id=${suiteId}`;
    return this.getPaged(command, 'sections', readSection);
  }

  getCases(projectId: number, suiteId?: number | null, sectionId?: number | null): Promise<TrCase[]> {
    const parameters: string[] = [];
    if (suiteId !== null && suiteId !== undefined) parameters.push(`suite_id=${suiteId}`);
    if (sectionId !== null && sectionId !== undefined) parameters.push(`section_id=${sectionId}`);
    const command =
      parameters.length === 0
        ? `get_cases/${projectId}`
        : `get_cases/${projectId}&${parameters.join('&')}`;
    return this.getPaged(command, 'cases', readCase, { paginateArrayForm: true });
  }

  async getCurrentUser(): Promise<TrUser> {
    return readUser(await this.http.getJson('get_current_user'));
  }

  getUsers(projectId?: number | null): Promise<TrUser[]> {
    // Non-admin accounts may only list users scoped to a project (TestRail 6.6+).
    const command =
      projectId === null || projectId === undefined ? 'get_users' : `get_users&project_id=${projectId}`;
    return this.getPaged(command, 'users', readUser, { paginateArrayForm: true });
  }

  async getStatuses(): Promise<TrStatus[]> {
    return readPagedOrArray(await this.http.getJson('get_statuses'), 'statuses', readStatus);
  }

  async getCaseTypes(): Promise<TrCaseType[]> {
    return readPagedOrArray(await this.http.getJson('get_case_types'), 'case_types', readCaseType);
  }

  async getPriorities(): Promise<TrPriority[]> {
    return readPagedOrArray(await this.http.getJson('get_priorities'), 'priorities', readPriority);
  }

  getRuns(projectId: number): Promise<TrRun[]> {
    return this.getPaged(`get_runs/${projectId}`, 'runs', readRun, { paginateArrayForm: true });
  }

  /** Runs living inside test plans are invisible to get_runs; walk the plans. */
  async getPlanRuns(projectId: number): Promise<TrPlanRun[]> {
    const planIds = await this.getPaged(
      `get_plans/${projectId}`,
      'plans',
      (e) => getInt(e, 'id') ?? 0,
      { paginateArrayForm: true },
    );
    const result: TrPlanRun[] = [];
    for (const planId of planIds.filter((id) => id > 0)) {
      const doc = await this.http.getJson(`get_plan/${planId}`);
      const entries = doc !== null && typeof doc === 'object' ? doc.entries : undefined;
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        const runs = entry !== null && typeof entry === 'object' ? entry.runs : undefined;
        if (!Array.isArray(runs)) continue;

        for (const run of runs) {
          result.push({
            id: getInt(run, 'id') ?? 0,
            suiteId: getInt(run, 'suite_id'),
            name: getString(run, 'name') ?? 'Unnamed run',
            planId,
            isCompleted: getBool(run, 'is_completed') ?? false,
            createdOn: getLong(run, 'created_on'),
          });
        }
      }
    }
    return result;
  }

  async getTests(runId: number): Promise<TrTest[]> {
    const raw = await this.getPaged(`get_tests/${runId}`, 'tests', readTest, { paginateArrayForm: true });
    // TestRail get_tests does not include run_id on each test; stamp it so callers can resolve.
    return raw.map((t) => (t.runId === 0 ? { ...t, runId } : t));
  }

  getResultsForTest(testId: number): Promise<TrResult[]> {
    return this.getPaged(`get_results/${testId}`, 'results', readResult, { paginateArrayForm: true });
  }

  getResultsForRun(runId: number): Promise<TrResult[]> {
    return this.getPaged(`get_results_for_run/${runId}`, 'results', readResult, { paginateArrayForm: true });
  }

  async getRaw(cmd: string): Promise<unknown> {
    return this.http.getJson(cmd);
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async addResultExtended(testId: number, result: AddResultRequest): Promise<void> {
    const body: Record<string, unknown> = { status_id: result.statusId };
    if (hasText(result.comment)) body.comment = result.comment;
    if (hasText(result.defects)) body.defects = result.defects;
    if (hasText(result.elapsed)) body.elapsed = result.elapsed;
    if (hasText(result.version)) body.version = result.version;
    await this.http.postJson(`add_result/${testId}`, body);
  }

  async addRun(projectId: number, request: AddRunRequest): Promise<TrRun> {
    const includeAll = request.includeAll === true;
    const body: Record<string, unknown> = {
      suite_id: request.suiteId ?? null,
      name: request.name,
      description: request.description ?? null,
      include_all: includeAll,
      refs: request.refs ?? null,
    };
    if (request.assignedToId != null) body.assignedto_id = request.assignedToId;
    // include_all=true must NOT carry case_ids — TestRail would ignore the
    // "all + future cases" semantics in favor of the explicit snapshot.
    if (!includeAll) body.case_ids = request.caseIds ?? [];
    return readRun(await this.http.postJson(`add_run/${projectId}`, body));
  }

  async updateRun(runId: number, request: UpdateRunRequest): Promise<TrRun> {
    const body: Record<string, unknown> = {};
    if (hasText(request.name)) body.name = request.name;
    if (request.description !== null && request.description !== undefined) {
      body.description = request.description;
    }
    if (request.refs !== null && request.refs !== undefined) body.refs = request.refs;
    return readRun(await this.http.postJson(`update_run/${runId}`, body));
  }

  async closeRun(runId: number): Promise<void> {
    await this.http.postJson(`close_run/${runId}`, {});
  }

  async deleteRun(runId: number): Promise<void> {
    await this.http.postJson(`delete_run/${runId}`, {});
  }

  async addSection(projectId: number, request: AddSectionRequest): Promise<TrSection> {
    const body = {
      suite_id: request.suiteId ?? null,
      parent_id: request.parentId ?? null,
      name: request.name,
      description: request.description ?? null,
    };
    return readSection(await this.http.postJson(`add_section/${projectId}`, body));
  }

  async updateSection(sectionId: number, name: string, description?: string | null): Promise<TrSection> {
    const body: Record<string, unknown> = { name };
    if (description !== null && description !== undefined) body.description = description;
    return readSection(await this.http.postJson(`update_section/${sectionId}`, body));
  }

  async deleteSection(sectionId: number): Promise<void> {
    await this.http.postJson(`delete_section/${sectionId}`, {});
  }

  async moveSection(sectionId: number, parentId?: number | null, afterId?: number | null): Promise<void> {
    const body: Record<string, unknown> = {};
    if (parentId !== null && parentId !== undefined) body.parent_id = parentId;
    if (afterId !== null && afterId !== undefined) body.after_id = afterId;
    await this.http.postJson(`move_section/${sectionId}`, body);
  }

  async addCase(sectionId: number, payload: TrAddCasePayload): Promise<TrCase> {
    return readCase(await this.http.postJson(`add_case/${sectionId}`, caseBody(payload)));
  }

  async updateCase(caseId: number, payload: TrAddCasePayload): Promise<TrCase> {
    return readCase(await this.http.postJson(`update_case/${caseId}`, caseBody(payload)));
  }

  async deleteCase(caseId: number): Promise<void> {
    await this.http.postJson(`delete_case/${caseId}`, {});
  }

  async copyCasesToSection(targetSectionId: number, caseIds: number[]): Promise<void> {
    await this.http.postJson(`copy_cases_to_section/${targetSectionId}`, { case_ids: caseIds });
  }

  async moveCasesToSection(
    targetSectionId: number,
    targetSuiteId: number | null,
    caseIds: number[],
  ): Promise<void> {
    const payload =
      targetSuiteId === null
        ? { case_ids: caseIds }
        : { suite_id: targetSuiteId, case_ids: caseIds };
    await this.http.postJson(`move_cases_to_section/${targetSectionId}`, payload);
  }
}

// ---------------------------------------------------------------------------
// Write payload builder — key mapping per C# AddCaseAsync/UpdateCaseAsync
// ---------------------------------------------------------------------------

function caseBody(payload: TrAddCasePayload): Record<string, unknown> {
  const body: Record<string, unknown> = { title: payload.title };
  if (typeof payload.typeId === 'number') body.type_id = payload.typeId;
  if (typeof payload.priorityId === 'number') body.priority_id = payload.priorityId;
  if (hasText(payload.estimate)) body.estimate = payload.estimate;
  if (hasText(payload.refs)) body.refs = payload.refs;
  if (hasText(payload.description)) body.custom_description = payload.description;
  if (hasText(payload.preconds)) body.custom_preconds = payload.preconds;
  // The instance's case template shows separated steps — write that field
  // when structured rows are present; plain-text custom_steps otherwise.
  const sep = (payload.stepsSeparated ?? []).filter(
    (s) => s.content.trim().length > 0 || s.expected.trim().length > 0,
  );
  if (sep.length > 0) {
    body.custom_steps_separated = sep.map((s) => ({ content: s.content, expected: s.expected }));
  } else if (hasText(payload.steps)) {
    body.custom_steps = payload.steps;
  }
  if (hasText(payload.expected)) body.custom_expected = payload.expected;
  if (typeof payload.ownerId === 'number') body.custom_testcaseowner = payload.ownerId;
  return body;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Element readers — snake_case → camelCase (C# ReadProject/ReadCase/…)
// ---------------------------------------------------------------------------

function hasNoNextPage(links: Record<string, unknown>): boolean {
  const next = links.next;
  return next === undefined || next === null || String(next).trim().length === 0;
}

function readPagedOrArray<T>(root: any, arrayProperty: string, read: (element: any) => T): T[] {
  if (Array.isArray(root)) return root.map(read);
  if (root !== null && typeof root === 'object' && Array.isArray(root[arrayProperty])) {
    return (root[arrayProperty] as unknown[]).map(read);
  }
  return [];
}

export function readProject(element: any): TrProject {
  return {
    id: getInt(element, 'id') ?? 0,
    name: getString(element, 'name') ?? 'Unnamed project',
    suiteMode: getInt(element, 'suite_mode') ?? 0,
    isCompleted: getBool(element, 'is_completed') ?? false,
  };
}

export function readSuite(element: any): TrSuite {
  return {
    id: getInt(element, 'id') ?? 0,
    projectId: getInt(element, 'project_id') ?? 0,
    name: getString(element, 'name') ?? 'Unnamed suite',
    description: getString(element, 'description'),
    isCompleted: getBool(element, 'is_completed') ?? false,
  };
}

export function readSection(element: any): TrSection {
  return {
    id: getInt(element, 'id') ?? 0,
    suiteId: getInt(element, 'suite_id'),
    parentId: getInt(element, 'parent_id'),
    name: getString(element, 'name') ?? 'Unnamed section',
    depth: getInt(element, 'depth') ?? 0,
    displayOrder: getInt(element, 'display_order') ?? 0,
  };
}

export function readCaseType(element: any): TrCaseType {
  return {
    id: getInt(element, 'id') ?? 0,
    name: getString(element, 'name') ?? '',
    isDefault: getBool(element, 'is_default') ?? false,
  };
}

export function readPriority(element: any): TrPriority {
  return {
    id: getInt(element, 'id') ?? 0,
    name: getString(element, 'name') ?? '',
    shortName: getString(element, 'short_name'),
    isDefault: getBool(element, 'is_default') ?? false,
  };
}

export function readCase(element: any): TrCase {
  return {
    id: getInt(element, 'id') ?? 0,
    title: getString(element, 'title') ?? 'Untitled case',
    sectionId: getInt(element, 'section_id'),
    suiteId: getInt(element, 'suite_id'),
    priorityId: getInt(element, 'priority_id'),
    typeId: getInt(element, 'type_id'),
    templateId: getInt(element, 'template_id'),
    createdBy: getInt(element, 'created_by'),
    updatedBy: getInt(element, 'updated_by'),
    createdOn: getLong(element, 'created_on'),
    updatedOn: getLong(element, 'updated_on'),
    refs: getString(element, 'refs'),
    estimate: getString(element, 'estimate'),
    preconds: getString(element, 'custom_preconds'),
    steps: getString(element, 'custom_steps'),
    expected: getString(element, 'custom_expected'),
    ownerId: getInt(element, 'custom_testcaseowner') ?? getInt(element, 'custom_test_case_owner'),
    assignedToId: getInt(element, 'case_assignedto_id'),
    stepsSeparated: readSteps(element),
  };
}

function readSteps(element: any): TrStep[] {
  const stepsElement = element !== null && typeof element === 'object' ? element.custom_steps_separated : undefined;
  if (!Array.isArray(stepsElement)) return [];
  return stepsElement.map((step, i) => ({
    index: i + 1,
    action: getString(step, 'content') ?? '',
    expected: getString(step, 'expected') ?? '',
  }));
}

export function readRun(element: any): TrRun {
  return {
    id: getInt(element, 'id') ?? 0,
    projectId: getInt(element, 'project_id') ?? 0,
    suiteId: getInt(element, 'suite_id'),
    name: getString(element, 'name') ?? 'Unnamed run',
    description: getString(element, 'description'),
    isCompleted: getBool(element, 'is_completed') ?? false,
    createdOn: getLong(element, 'created_on'),
    createdBy: getInt(element, 'created_by'),
    assignedToId: getInt(element, 'assignedto_id'),
    refs: getString(element, 'refs'),
    passedCount: getInt(element, 'passed_count') ?? 0,
    failedCount: getInt(element, 'failed_count') ?? 0,
    blockedCount: getInt(element, 'blocked_count') ?? 0,
    retestCount: getInt(element, 'retest_count') ?? 0,
    untestedCount: getInt(element, 'untested_count') ?? 0,
  };
}

export function readTest(element: any): TrTest {
  return {
    id: getInt(element, 'id') ?? 0,
    runId: getInt(element, 'run_id') ?? 0,
    caseId: getInt(element, 'case_id') ?? 0,
    title: getString(element, 'title') ?? 'Untitled test',
    statusId: getInt(element, 'status_id') ?? 3,
    assignedToId: getInt(element, 'assignedto_id'),
    priorityId: getInt(element, 'priority_id'),
    typeId: getInt(element, 'type_id'),
  };
}

export function readResult(element: any): TrResult {
  return {
    id: getInt(element, 'id') ?? 0,
    testId: getInt(element, 'test_id') ?? 0,
    statusId: getInt(element, 'status_id'),
    comment: getString(element, 'comment'),
    createdBy: getInt(element, 'created_by'),
    createdOn: getLong(element, 'created_on'),
    defects: getString(element, 'defects'),
    version: getString(element, 'version'),
    elapsed: getString(element, 'elapsed'),
  };
}

export function readStatus(element: any): TrStatus {
  return {
    id: getInt(element, 'id') ?? 0,
    name: getString(element, 'name') ?? 'unknown',
    label: getString(element, 'label') ?? 'Unknown',
    isSystem: getBool(element, 'is_system') ?? false,
    isFinal: getBool(element, 'is_final') ?? false,
    colorHex: getString(element, 'color_hex'),
  };
}

export function readUser(element: any): TrUser {
  return {
    id: getInt(element, 'id') ?? 0,
    name: getString(element, 'name') ?? 'Current user',
    email: getString(element, 'email'),
    isActive: getBool(element, 'is_active') ?? true,
  };
}

// ---------------------------------------------------------------------------
// Loose JSON accessors (C# GetString/GetInt/GetLong/GetBool)
// ---------------------------------------------------------------------------

function getString(element: any, propertyName: string): string | null {
  const value = element !== null && typeof element === 'object' ? element[propertyName] : undefined;
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : String(value);
}

function getInt(element: any, propertyName: string): number | null {
  const value = element !== null && typeof element === 'object' ? element[propertyName] : undefined;
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getLong(element: any, propertyName: string): number | null {
  return getInt(element, propertyName);
}

function getBool(element: any, propertyName: string): boolean | null {
  const value = element !== null && typeof element === 'object' ? element[propertyName] : undefined;
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}
