// Incident dashboard filter catalog — verbatim port of
// MissionControl.Application IncidentFilterCatalog.Default().
// docs/reference/jira-rest-layer.md §7.

import type { JiraFilterControlType, JiraFilterDefinition } from '../types.js';

const list: JiraFilterDefinition[] = [];
let order = 0;

function quick(id: string, name: string, jql: string, group = 'Quick'): void {
  list.push({
    id,
    displayName: name,
    controlType: 'quickButton',
    jiraFieldName: null,
    jiraFieldId: null,
    jqlTemplate: jql,
    isQuickFilter: true,
    supportsMultiSelect: false,
    displayOrder: order++,
    groupName: group,
  });
}

function drop(
  id: string,
  name: string,
  field: string,
  type: JiraFilterControlType = 'multiSelectDropdown',
  group = 'Fields',
): void {
  list.push({
    id,
    displayName: name,
    controlType: type,
    jiraFieldName: field,
    jiraFieldId: null,
    jqlTemplate: null,
    isQuickFilter: false,
    supportsMultiSelect: type === 'multiSelectDropdown',
    displayOrder: order++,
    groupName: group,
  });
}

quick('automation-infra', '!Automation Infra', 'labels != automation-infra');
quick('veracode', '!VeraCode', 'labels != veracode');
quick('dev-bug-stats', 'Dev Bug Statistics', 'issuetype = Bug AND "Bug Type" = Dev');
quick('qa-bug-stats', 'QA bug Statistic', 'issuetype = Bug AND "Bug Type" = QA');
quick('my-issues', 'My Issues', 'assignee = currentUser()');
quick('reported-by-me', 'Reported by me', 'reporter = currentUser()');
quick('no-clones', 'No Clones', 'issuetype != Clone');
quick('unassigned', 'Unassigned', 'assignee is EMPTY');
quick('incident', 'Incident', 'issuetype = Incident', 'Type');
quick('sw-bug', 'SW Bug', 'issuetype = Bug', 'Type');
quick('rc', 'RC', 'issuetype = RC', 'Type');
quick('investigation', 'Investigation', 'issuetype = Investigation', 'Type');
quick('open', 'Open', 'status = Open', 'Status');
quick('delivered', 'Delivered', 'status = Delivered', 'Status');
quick('verification', 'Verification', 'status = Verification', 'Status');
quick('rejected', 'Rejected', 'status = Rejected', 'Status');
quick('pending-decision', 'Pending Decision', 'status = "Pending Decision"', 'Status');
quick('review-approved', 'Review Approved', 'status = "Review Approved"', 'Status');
quick('closed', 'Closed', 'status = Closed', 'Status');
quick('done', 'Done', 'statusCategory = Done', 'Status');
quick('s3', 'S3', 'priority = S3', 'Severity');
quick('s4-5', 'S4/5', 'priority in (S4, S5)', 'Severity');
quick('s6', 'S6', 'priority = S6', 'Severity');
quick('future-platform', 'Future Platform', 'labels = future-platform');
quick('not-investigation', 'Not Investigation', 'issuetype != Investigation');
quick('clones-closed-links', 'Clones with CLOSED Links', 'issuetype = Clone AND issueLinkType = "is cloned by"');
quick('performance-bugs', 'Performance Bugs', 'labels = performance');
quick('in-progress', 'In Progress', 'status = "In Progress"');
quick('feature-incident', 'Feature incident', 'labels = feature-incident');
quick('reopen', 'Reopen', 'status = Reopened');

drop('program', 'Program', 'Program');
drop('fix-version', 'Fix Version/s', 'fixVersion');
drop('module-branch', 'Deliver to Module Branch', '"Module Branch"');
drop('merged-build', 'Merged in Build Num', '"Merged in Build Num"');
drop('sw-ee-team', 'SW EE Team', '"SW EE Team"');
drop('wt', 'WT', 'WT');
drop('assignee', 'Assignee', 'assignee', 'userPicker');
drop('reporter', 'Reporter', 'reporter', 'userPicker');
drop('sprint', 'Sprint', 'sprint');
drop('reject-reasons', 'Reject Reasons', '"Reject Reasons"');
drop('epic-link', 'Epic Link', '"Epic Link"');
drop('classification', 'Classification', 'Classification');
drop('labels', 'Labels', 'labels');
drop('resolution', 'Resolution', 'resolution');
drop('affects-version', 'Affects Version/s', 'affectedVersion');
drop('primary-developer', 'Primary Developer', '"Primary Developer"');
drop('primary-tester', 'Primary tester', '"Primary Tester"');
drop('created', 'Created', 'created', 'datePicker');
drop('priority', 'Priority', 'priority');
drop('severity', 'Severity', 'Severity');
drop('regression-vs-feature', 'Regression VS Feature', '"Regression VS Feature"');
drop('bug-classification', 'Bug classification & Reason', '"Bug Classification"');
drop('sw-ee-teams-group', 'SW EE Teams group', '"SW EE Teams Group"');
drop('program-group', 'Program Group', '"Program Group"');
drop('defect-status', 'Defect Status', '"Defect Status"');
drop('phase-detected', 'Phase Detected', '"Phase Detected"');
drop('priority-severity', 'Priority&Severity', '"Priority&Severity"');
drop('submitting-team-group', 'Submitting Team Group', '"Submitting Team Group"');
drop('bugs-mapping', 'Bugs Mapping', '"Bugs Mapping"');
drop('wt-group', 'WT Group', '"WT Group"');
drop('automation-statistics', 'Automation statistics', '"Automation Statistics"');
drop('environment-affected', 'Environment Affected', '"Environment Affected"');

list.push({
  id: 'summary',
  displayName: 'Summary',
  controlType: 'textSearch',
  jiraFieldName: 'summary',
  jiraFieldId: null,
  jqlTemplate: 'summary ~ {value}',
  isQuickFilter: false,
  supportsMultiSelect: false,
  displayOrder: order++,
  groupName: 'Search',
});

/** Default metadata-driven filter catalog for the incident dashboard. */
export const INCIDENT_FILTERS: readonly JiraFilterDefinition[] = list;
