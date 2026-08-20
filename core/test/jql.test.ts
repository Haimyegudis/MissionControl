import { describe, it, expect } from 'vitest';
import { jqlQuote } from '../src/jira/jqlEscape.js';
import {
  buildFromFilters,
  buildIncidentJql,
  buildStickyJql,
  getReporterClause,
  quoteList,
  quoteValue,
} from '../src/jira/jqlBuilder.js';
import { INCIDENT_FILTERS } from '../src/jira/incidentCatalog.js';
import type { JiraFilterDefinition, JiraFilterSelection } from '../src/types.js';

const sel = (filterId: string, ...values: string[]): JiraFilterSelection => ({ filterId, values });

describe('jqlQuote (JqlEscape.Quote)', () => {
  it('returns "" (quoted empty) for null/empty', () => {
    expect(jqlQuote(null)).toBe('""');
    expect(jqlQuote('')).toBe('""');
  });

  it('wraps plain values in double quotes', () => {
    expect(jqlQuote('hello')).toBe('"hello"');
  });

  it('escapes backslash and double quote', () => {
    expect(jqlQuote('a\\b')).toBe('"a\\\\b"');
    expect(jqlQuote('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('drops control characters below 0x20', () => {
    expect(jqlQuote('a\nb\tcd')).toBe('"abcd"');
  });
});

describe('quoteValue (JqlBuilder variant)', () => {
  it('returns quoted empty for empty string', () => {
    expect(quoteValue('')).toBe('""');
  });

  it('escapes backslash and quote but does NOT strip control chars', () => {
    expect(quoteValue('a\\"b')).toBe('"a\\\\\\"b"');
    expect(quoteValue('a\nb')).toBe('"a\nb"');
  });
});

describe('buildFromFilters', () => {
  const defs = INCIDENT_FILTERS;

  it('emits unquoted project clause first when defaultProjectKey given', () => {
    expect(buildFromFilters(defs, [], 'ISW')).toBe('project = ISW');
  });

  it('emits nothing for blank project key and no selections', () => {
    expect(buildFromFilters(defs, [], '')).toBe('');
    expect(buildFromFilters(defs, [], null)).toBe('');
    expect(buildFromFilters(defs, [], '   ')).toBe('');
  });

  it('skips selections whose filter id is unknown', () => {
    expect(buildFromFilters(defs, [sel('no-such-filter', 'x')], 'ISW')).toBe('project = ISW');
  });

  it('looks up definitions case-insensitively', () => {
    expect(buildFromFilters(defs, [sel('MY-ISSUES')], 'ISW')).toBe(
      'project = ISW AND assignee = currentUser()',
    );
  });

  it('emits quick-button template verbatim, ignoring values', () => {
    expect(buildFromFilters(defs, [sel('s4-5', 'ignored')], null)).toBe('priority in (S4, S5)');
    expect(buildFromFilters(defs, [sel('clones-closed-links')], null)).toBe(
      'issuetype = Clone AND issueLinkType = "is cloned by"',
    );
  });

  it('skips non-quick-button selections with no values', () => {
    expect(buildFromFilters(defs, [sel('priority')], 'ISW')).toBe('project = ISW');
  });

  it('single value + non-multi control emits equals', () => {
    expect(buildFromFilters(defs, [sel('assignee', 'John Doe')], null)).toBe(
      '"assignee" = "John Doe"',
    );
  });

  it('multi-select emits in (...) even with a single value', () => {
    expect(buildFromFilters(defs, [sel('priority', 'S3')], null)).toBe('"priority" in ("S3")');
  });

  it('multiple values join with comma-space inside in (...)', () => {
    expect(buildFromFilters(defs, [sel('priority', 'S3', 'S4')], null)).toBe(
      '"priority" in ("S3", "S4")',
    );
  });

  it('does not double-quote field names already quoted', () => {
    expect(buildFromFilters(defs, [sel('module-branch', 'main')], null)).toBe(
      '"Module Branch" in ("main")',
    );
  });

  it('substitutes {value} with quoted first value', () => {
    expect(buildFromFilters(defs, [sel('summary', 'login bug')], null)).toBe(
      'summary ~ "login bug"',
    );
  });

  it('substitutes {values} with comma-space joined quoted values', () => {
    const custom: JiraFilterDefinition[] = [
      {
        id: 'multi-t',
        displayName: 'Multi',
        controlType: 'multiSelectDropdown',
        jiraFieldName: null,
        jiraFieldId: null,
        jqlTemplate: 'labels in ({values})',
        isQuickFilter: false,
        supportsMultiSelect: true,
        displayOrder: 0,
        groupName: null,
      },
    ];
    expect(buildFromFilters(custom, [sel('multi-t', 'a', 'b')], null)).toBe(
      'labels in ("a", "b")',
    );
  });

  it('template without placeholders is emitted verbatim when values present', () => {
    const custom: JiraFilterDefinition[] = [
      {
        id: 'raw-t',
        displayName: 'Raw',
        controlType: 'dropdown',
        jiraFieldName: null,
        jiraFieldId: null,
        jqlTemplate: 'resolution is EMPTY',
        isQuickFilter: false,
        supportsMultiSelect: false,
        displayOrder: 0,
        groupName: null,
      },
    ];
    expect(buildFromFilters(custom, [sel('raw-t', 'x')], null)).toBe('resolution is EMPTY');
  });

  it('no template and no field name yields nothing', () => {
    const custom: JiraFilterDefinition[] = [
      {
        id: 'blank',
        displayName: 'Blank',
        controlType: 'dropdown',
        jiraFieldName: null,
        jiraFieldId: null,
        jqlTemplate: null,
        isQuickFilter: false,
        supportsMultiSelect: false,
        displayOrder: 0,
        groupName: null,
      },
    ];
    expect(buildFromFilters(custom, [sel('blank', 'x')], 'ISW')).toBe('project = ISW');
  });

  it('escapes quotes and backslashes inside values', () => {
    expect(buildFromFilters(defs, [sel('labels', 'a"b\\c')], null)).toBe(
      '"labels" in ("a\\"b\\\\c")',
    );
  });

  it('joins project + fragments with AND in selection order', () => {
    expect(
      buildFromFilters(defs, [sel('incident'), sel('priority', 'S3', 'S4')], 'ISW'),
    ).toBe('project = ISW AND issuetype = Incident AND "priority" in ("S3", "S4")');
  });
});

describe('quoteList', () => {
  it('joins with comma and no space, escaping quotes only', () => {
    expect(quoteList(['Alice', 'Bo"b'])).toBe('"Alice","Bo\\"b"');
  });
});

describe('getReporterClause', () => {
  it('returns null when no person filters are active', () => {
    expect(getReporterClause([sel('priority', 'S3')])).toBeNull();
    expect(getReporterClause([])).toBeNull();
  });

  it('me-alias only (my-issues or reported-by-me)', () => {
    expect(getReporterClause([sel('my-issues')])).toBe(
      '(reporter = currentUser() OR assignee = currentUser())',
    );
    expect(getReporterClause([sel('reported-by-me')])).toBe(
      '(reporter = currentUser() OR assignee = currentUser())',
    );
  });

  it('people only from reporter + assignee selections, deduped case-insensitively', () => {
    expect(
      getReporterClause([sel('reporter', 'Alice', 'Bob'), sel('assignee', 'alice')]),
    ).toBe('(reporter in ("Alice","Bob") OR assignee in ("Alice","Bob"))');
  });

  it('me-alias plus people puts currentUser parts first', () => {
    expect(getReporterClause([sel('my-issues'), sel('reporter', 'Alice')])).toBe(
      '(reporter = currentUser() OR assignee = currentUser() OR reporter in ("Alice") OR assignee in ("Alice"))',
    );
  });

  it('ignores empty values', () => {
    expect(getReporterClause([sel('reporter', '')])).toBeNull();
  });
});

describe('buildStickyJql', () => {
  it('builds project + issuetype + status with clause appended', () => {
    expect(buildStickyJql('ISW', 'Verification', '(reporter = currentUser() OR assignee = currentUser())')).toBe(
      'project = ISW AND issuetype in (Incident, Bug, Defect) AND status = "Verification"' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' ORDER BY priority DESC, updated DESC',
    );
  });

  it('omits the clause when null or empty', () => {
    expect(buildStickyJql('ISW', 'Rejected', null)).toBe(
      'project = ISW AND issuetype in (Incident, Bug, Defect) AND status = "Rejected" ORDER BY priority DESC, updated DESC',
    );
  });
});

describe('buildIncidentJql — 6-step assembly', () => {
  const defs = INCIDENT_FILTERS;

  it('no selections: default issuetype, person, statusCategory, sticky exclusion, order', () => {
    const r = buildIncidentJql(defs, [], 'ISW');
    expect(r.main).toBe(
      'project = ISW' +
        ' AND issuetype in (Incident, Bug, Defect)' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' AND statusCategory != Done' +
        ' AND status not in (Rejected, Verification)' +
        ' ORDER BY priority DESC, updated DESC',
    );
    expect(r.verification).toBe(
      'project = ISW AND issuetype in (Incident, Bug, Defect) AND status = "Verification"' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' ORDER BY priority DESC, updated DESC',
    );
    expect(r.rejected).toBe(
      'project = ISW AND issuetype in (Incident, Bug, Defect) AND status = "Rejected"' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' ORDER BY priority DESC, updated DESC',
    );
  });

  it('step 2 skipped when jql already mentions issuetype', () => {
    const r = buildIncidentJql(defs, [sel('incident')], 'ISW');
    expect(r.main).toBe(
      'project = ISW AND issuetype = Incident' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' AND statusCategory != Done' +
        ' AND status not in (Rejected, Verification)' +
        ' ORDER BY priority DESC, updated DESC',
    );
  });

  it('step 4 skipped when jql already mentions status', () => {
    const r = buildIncidentJql(defs, [sel('open')], 'ISW');
    expect(r.main).toBe(
      'project = ISW AND status = Open' +
        ' AND issuetype in (Incident, Bug, Defect)' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' AND status not in (Rejected, Verification)' +
        ' ORDER BY priority DESC, updated DESC',
    );
  });

  it('person selections are excluded from the base and folded into the person clause', () => {
    const r = buildIncidentJql(defs, [sel('reporter', 'Alice'), sel('priority', 'S3')], 'ISW');
    expect(r.main).toBe(
      'project = ISW AND "priority" in ("S3")' +
        ' AND issuetype in (Incident, Bug, Defect)' +
        ' AND (reporter in ("Alice") OR assignee in ("Alice"))' +
        ' AND statusCategory != Done' +
        ' AND status not in (Rejected, Verification)' +
        ' ORDER BY priority DESC, updated DESC',
    );
    expect(r.verification).toContain(' AND (reporter in ("Alice") OR assignee in ("Alice")) ');
    expect(r.rejected).toContain(' AND (reporter in ("Alice") OR assignee in ("Alice")) ');
  });

  it('my-issues quick filter is excluded from base and becomes the me-alias clause', () => {
    const r = buildIncidentJql(defs, [sel('my-issues')], 'ISW');
    expect(r.main).toBe(
      'project = ISW' +
        ' AND issuetype in (Incident, Bug, Defect)' +
        ' AND (reporter = currentUser() OR assignee = currentUser())' +
        ' AND statusCategory != Done' +
        ' AND status not in (Rejected, Verification)' +
        ' ORDER BY priority DESC, updated DESC',
    );
  });

  it('assignee UserPicker selection also feeds the person clause', () => {
    const r = buildIncidentJql(defs, [sel('assignee', 'Bob')], 'ISW');
    expect(r.main).toContain(' AND (reporter in ("Bob") OR assignee in ("Bob"))');
    expect(r.main).not.toContain('"assignee" = "Bob"');
  });
});

describe('INCIDENT_FILTERS catalog', () => {
  it('has 63 entries: 30 quick + 32 dropdowns + summary', () => {
    expect(INCIDENT_FILTERS).toHaveLength(63);
    expect(INCIDENT_FILTERS.filter((f) => f.isQuickFilter)).toHaveLength(30);
    expect(
      INCIDENT_FILTERS.filter((f) => !f.isQuickFilter && f.controlType !== 'textSearch'),
    ).toHaveLength(32);
  });

  it('displayOrder increments 0..62 in catalog order', () => {
    INCIDENT_FILTERS.forEach((f, i) => expect(f.displayOrder).toBe(i));
  });

  it('quick filters are quickButton with verbatim templates', () => {
    const byId = new Map(INCIDENT_FILTERS.map((f) => [f.id, f]));
    const q = byId.get('automation-infra')!;
    expect(q.controlType).toBe('quickButton');
    expect(q.displayName).toBe('!Automation Infra');
    expect(q.jqlTemplate).toBe('labels != automation-infra');
    expect(q.groupName).toBe('Quick');
    expect(q.isQuickFilter).toBe(true);
    expect(byId.get('dev-bug-stats')!.jqlTemplate).toBe('issuetype = Bug AND "Bug Type" = Dev');
    expect(byId.get('pending-decision')!.jqlTemplate).toBe('status = "Pending Decision"');
    expect(byId.get('done')!.jqlTemplate).toBe('statusCategory = Done');
    expect(byId.get('done')!.groupName).toBe('Status');
    expect(byId.get('s4-5')!.displayName).toBe('S4/5');
    expect(byId.get('s4-5')!.groupName).toBe('Severity');
    expect(byId.get('reopen')!.jqlTemplate).toBe('status = Reopened');
  });

  it('dropdowns carry verbatim jiraFieldName including embedded quotes', () => {
    const byId = new Map(INCIDENT_FILTERS.map((f) => [f.id, f]));
    expect(byId.get('priority-severity')!.jiraFieldName).toBe('"Priority&Severity"');
    expect(byId.get('module-branch')!.jiraFieldName).toBe('"Module Branch"');
    expect(byId.get('wt')!.jiraFieldName).toBe('WT');
    expect(byId.get('fix-version')!.jiraFieldName).toBe('fixVersion');
    expect(byId.get('environment-affected')!.jiraFieldName).toBe('"Environment Affected"');
    expect(byId.get('program')!.groupName).toBe('Fields');
    expect(byId.get('program')!.controlType).toBe('multiSelectDropdown');
    expect(byId.get('program')!.supportsMultiSelect).toBe(true);
  });

  it('assignee/reporter are UserPicker (non-multi), created is DatePicker', () => {
    const byId = new Map(INCIDENT_FILTERS.map((f) => [f.id, f]));
    expect(byId.get('assignee')!.controlType).toBe('userPicker');
    expect(byId.get('assignee')!.supportsMultiSelect).toBe(false);
    expect(byId.get('reporter')!.controlType).toBe('userPicker');
    expect(byId.get('reporter')!.supportsMultiSelect).toBe(false);
    expect(byId.get('created')!.controlType).toBe('datePicker');
    expect(byId.get('created')!.supportsMultiSelect).toBe(false);
  });

  it('summary text search is the last entry', () => {
    const last = INCIDENT_FILTERS[INCIDENT_FILTERS.length - 1]!;
    expect(last.id).toBe('summary');
    expect(last.controlType).toBe('textSearch');
    expect(last.jiraFieldName).toBe('summary');
    expect(last.jqlTemplate).toBe('summary ~ {value}');
    expect(last.groupName).toBe('Search');
    expect(last.isQuickFilter).toBe(false);
  });
});
