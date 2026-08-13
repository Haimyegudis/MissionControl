// renderToString smoke tests for the TestRail views (Phase 3). The store is
// populated directly; effects do not run under react-dom/server so no network
// is touched — these assert the static contract strings and row rendering.

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { trStore, type TestRailState } from '../src/stores/testrail';
import { testrailRunIdStore } from '../src/router';
import type { TrCase, TrRun, TrSection, TrSuite } from '../src/testrailTypes';
import { CaseLibraryView } from '../src/views/testrail/CaseLibraryView';
import { RunEditor, RunsView } from '../src/views/testrail/RunsView';
import { RunDetailView } from '../src/views/testrail/RunDetailView';
import { TestRailReportsView } from '../src/views/testrail/TestRailReportsView';

const suite: TrSuite = { id: 10, projectId: 1, name: 'Press suite', description: null, isCompleted: false };
const section: TrSection = { id: 5, suiteId: 10, parentId: null, name: 'Calibration', depth: 0, displayOrder: 1 };
const kase: TrCase = {
  id: 77,
  title: 'Nozzle check',
  sectionId: 5,
  suiteId: 10,
  priorityId: null,
  typeId: null,
  templateId: null,
  createdBy: null,
  updatedBy: null,
  createdOn: null,
  updatedOn: null,
  refs: null,
  estimate: null,
  preconds: null,
  steps: null,
  expected: null,
  ownerId: null,
  assignedToId: null,
  stepsSeparated: [],
};
const run: TrRun = {
  id: 900,
  projectId: 1,
  suiteId: 10,
  name: 'Sprint 42 regression',
  description: null,
  isCompleted: false,
  createdOn: 1755000000,
  createdBy: 3,
  assignedToId: null,
      refs: null,
  passedCount: 4,
  failedCount: 1,
  blockedCount: 0,
  retestCount: 0,
  untestedCount: 5,
};

function connectedState(): TestRailState {
  return {
    ...trStore.get(),
    phase: 'connected',
    session: { connected: true, baseUrl: 'https://tr', email: 'me@hp.com', user: { id: 3, name: 'Me', email: null, isActive: true } },
    meta: null,
    people: { '3': 'Me' },
    allProjects: [{ id: 1, name: 'Indigo Press', suiteMode: 3, isCompleted: false }],
    projects: [{ id: 1, name: 'Indigo Press', suiteMode: 3, isCompleted: false }],
    projectId: 1,
    suites: [suite],
    sections: { 10: [section] },
    cases: { 10: [kase] },
    runs: [run],
    runsLoaded: true,
    planRuns: [],
    selSuiteId: 10,
    selSectionId: null,
  };
}

describe('TestRail views (Phase 3 smoke)', () => {
  it('CaseLibraryView renders suite picker, filters, section group and case row', () => {
    trStore.set(connectedState());
    const html = renderToString(<CaseLibraryView />);
    expect(html).toContain('Case library');
    expect(html).toContain('★ All suites — entire project');
    expect(html).toContain('Title contains…');
    expect(html).toContain('Owner…');
    expect(html).toContain('Assigned to…');
    expect(html).toContain('Never-ran check');
    expect(html).toContain('⚙ Columns');
    expect(html).toContain('Calibration');
    expect(html).toContain('Nozzle check');
    expect(html).toContain('copy…');
    expect(html).toContain('move…');
    expect(html).toContain('+ Section');
    expect(html).toContain('+ Case');
  });

  it('RunsView renders project picker, search, suite filter, My runs chip and the run row', () => {
    trStore.set(connectedState());
    const html = renderToString(<RunsView />);
    expect(html).toContain('Test runs');
    expect(html).toContain('title="Project"');
    expect(html).toContain('Indigo Press');
    expect(html).toContain('My runs');
    expect(html).toContain('Sprint 42 regression');
    expect(html).toContain('+ New run');
    expect(html).toContain('active');
    expect(html).toContain('delete');
  });

  it('RunEditor (create) shows the project, assignee default and the three case modes', () => {
    const st = connectedState();
    trStore.set(st);
    const html = renderToString(<RunEditor st={st} existing={null} onClose={() => {}} />);
    expect(html).toContain('New test run — Indigo Press');
    expect(html).toContain('Assign To');
    expect(html).toContain('Include all test cases');
    expect(html).toContain('Select specific test cases');
    expect(html).toContain('Dynamic filtering');
    expect(html).toContain('Create run');
  });

  it('RunDetailView renders tiles, progress bar and chips', () => {
    trStore.set(connectedState());
    testrailRunIdStore.set(900);
    const html = renderToString(<RunDetailView />);
    expect(html).toContain('Sprint 42 regression');
    expect(html).toContain('EXECUTION PROGRESS');
    expect(html).toContain('Pass rate');
    expect(html).toContain('Blocked');
    expect(html).toContain('Untested');
    expect(html).toContain('My tests');
  });

  it('TestRailReportsView renders project picker, totals, distribution and per-run rows', () => {
    trStore.set(connectedState());
    const html = renderToString(<TestRailReportsView />);
    expect(html).toContain('Execution report');
    expect(html).toContain('title="Project"');
    expect(html).toContain('Overall pass rate');
    expect(html).toContain('Untested backlog');
    expect(html).toContain('Overall distribution');
    expect(html).toContain('Per-run distribution');
    expect(html).toContain('Sprint 42 regression');
  });

  it('gates render a Settings pointer when disconnected', () => {
    trStore.set({ ...connectedState(), phase: 'disconnected' });
    const html = renderToString(<RunsView />);
    expect(html).toContain('Not connected');
    expect(html).toContain('Open Settings');
  });
});
