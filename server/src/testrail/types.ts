// TestRail domain types (Phase 2 — unified-deck plan T5).
// Faithful camelCase port of C:\APPS\TestRailWeb\TestRail\TestRailModels.cs.

export interface TrConnection {
  baseUrl: string;
  email: string;
  apiKey: string;
}

export interface TrProject {
  id: number;
  name: string;
  suiteMode: number;
  isCompleted: boolean;
}

export interface TrSuite {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  isCompleted: boolean;
}

export interface TrSection {
  id: number;
  suiteId: number | null;
  parentId: number | null;
  name: string;
  depth: number;
  displayOrder: number;
}

export interface TrStep {
  index: number;
  action: string;
  expected: string;
}

export interface TrCase {
  id: number;
  title: string;
  sectionId: number | null;
  suiteId: number | null;
  priorityId: number | null;
  typeId: number | null;
  templateId: number | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdOn: number | null;
  updatedOn: number | null;
  refs: string | null;
  estimate: string | null;
  preconds: string | null;
  steps: string | null;
  expected: string | null;
  /** custom_testcaseowner ?? custom_test_case_owner */
  ownerId: number | null;
  /** case_assignedto_id */
  assignedToId: number | null;
  /** custom_steps_separated */
  stepsSeparated: TrStep[];
}

export interface TrUser {
  id: number;
  name: string;
  email: string | null;
  isActive: boolean;
}

export interface TrRun {
  id: number;
  projectId: number;
  suiteId: number | null;
  name: string;
  description: string | null;
  isCompleted: boolean;
  createdOn: number | null;
  createdBy: number | null;
  assignedToId: number | null;
  refs: string | null;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  retestCount: number;
  untestedCount: number;
}

export interface TrPlanRun {
  id: number;
  suiteId: number | null;
  name: string;
  planId: number | null;
  isCompleted: boolean;
  createdOn: number | null;
}

export interface TrTest {
  id: number;
  runId: number;
  caseId: number;
  title: string;
  statusId: number;
  assignedToId: number | null;
  priorityId: number | null;
  typeId: number | null;
}

export interface TrResult {
  id: number;
  testId: number;
  statusId: number | null;
  comment: string | null;
  createdBy: number | null;
  createdOn: number | null;
  defects: string | null;
  version: string | null;
  elapsed: string | null;
}

export interface TrStatus {
  id: number;
  name: string;
  label: string;
  isSystem: boolean;
  isFinal: boolean;
  colorHex: string | null;
}

export interface TrCaseType {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface TrPriority {
  id: number;
  name: string;
  shortName: string | null;
  isDefault: boolean;
}

export interface TrAddCasePayload {
  title: string;
  typeId?: number | null;
  priorityId?: number | null;
  estimate?: string | null;
  refs?: string | null;
  description?: string | null;
  preconds?: string | null;
  steps?: string | null;
  expected?: string | null;
  ownerId?: number | null;
}
