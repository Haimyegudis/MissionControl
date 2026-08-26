// Dialog smoke tests via react-dom/server (no jsdom in this workspace) plus
// pure-logic checks for the dialog helpers.

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CommandPalette, paletteJql } from '../src/dialogs/CommandPalette';
import { CreateIssue } from '../src/dialogs/CreateIssue';
import { fallbackSkeleton, fieldKind, shapeCreateValue } from '../src/dialogs/CreateIssue';
import { HelpDialog } from '../src/dialogs/HelpDialog';
import { LogWork, formatExistingEstimate } from '../src/dialogs/LogWork';
import { LumoCardModal } from '../src/dialogs/LumoCardModal';
import { LumoPanel } from '../src/dialogs/LumoPanel';
import { sourceMeta } from '../src/dialogs/lumoSources';
import {
  TransitionDialog,
  initialFieldValue,
  isHeuristicallyRequired,
  preselectResolution,
  shapeFieldValue,
} from '../src/dialogs/TransitionDialog';
import type { JiraCreateFieldMeta, JiraTransitionField } from '../src/types';

const noop = () => {};

function tf(partial: Partial<JiraTransitionField>): JiraTransitionField {
  return {
    id: 'f1',
    name: 'Field',
    required: false,
    schemaType: 'string',
    itemType: null,
    allowedValues: [],
    ...partial,
  };
}

describe('TransitionDialog helpers (§10.5)', () => {
  it('required = flag OR name heuristic', () => {
    expect(isHeuristicallyRequired(tf({ required: true }))).toBe(true);
    expect(isHeuristicallyRequired(tf({ name: 'Verified in Build' }))).toBe(true);
    expect(isHeuristicallyRequired(tf({ name: 'Approved Build' }))).toBe(true);
    expect(isHeuristicallyRequired(tf({ name: 'Resolution' }))).toBe(true);
    expect(isHeuristicallyRequired(tf({ name: 'Reject Reason' }))).toBe(true);
    expect(isHeuristicallyRequired(tf({ name: 'Some Field' }))).toBe(false);
  });

  it('resolution preselect: Fixed → Done → Resolved → first', () => {
    expect(preselectResolution(["Won't Fix", 'Fixed', 'Done'])).toBe('Fixed');
    expect(preselectResolution(["Won't Fix", 'Done'])).toBe('Done');
    expect(preselectResolution(["Won't Fix", 'Resolved'])).toBe('Resolved');
    expect(preselectResolution(["Won't Fix", 'Duplicate'])).toBe("Won't Fix");
    expect(preselectResolution([])).toBe('');
  });

  it('initial value keeps the issue current value (e.g. Task Type on close)', () => {
    const taskType = tf({
      id: 'customfield_11000',
      name: 'Task Type',
      schemaType: 'option',
      allowedValues: ['Development', 'Support'],
    });
    // current value in the allowed list → prefilled, no re-pick needed
    expect(initialFieldValue({ ...taskType, currentValue: 'Support' })).toBe('Support');
    // no / unknown current value → empty as before
    expect(initialFieldValue(taskType)).toBe('');
    expect(initialFieldValue({ ...taskType, currentValue: 'Bogus' })).toBe('');
    // resolution: current wins, otherwise the Fixed→Done→Resolved preselect
    const res = tf({ id: 'resolution', schemaType: 'resolution', allowedValues: ['Fixed', "Won't Fix"] });
    expect(initialFieldValue({ ...res, currentValue: "Won't Fix" })).toBe("Won't Fix");
    expect(initialFieldValue(res)).toBe('Fixed');
    // text keeps the current value; dates trim datetime to yyyy-MM-dd
    expect(initialFieldValue(tf({ schemaType: 'string', currentValue: 'note' }))).toBe('note');
    expect(initialFieldValue(tf({ schemaType: 'date', currentValue: '2026-08-01T10:00:00.000+02:00' }))).toBe(
      '2026-08-01',
    );
    expect(initialFieldValue(tf({ schemaType: 'date' }))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // worklog / assignee always start empty
    expect(initialFieldValue(tf({ id: 'worklog', currentValue: '2h' }))).toBe('');
    expect(initialFieldValue(tf({ id: 'assignee', currentValue: 'jdoe' }))).toBe('');
  });

  it('value shaping per schema type', () => {
    expect(shapeFieldValue(tf({ schemaType: 'resolution' }), 'Fixed')).toEqual({ name: 'Fixed' });
    expect(shapeFieldValue(tf({ schemaType: 'option' }), 'Yes')).toEqual({ value: 'Yes' });
    expect(shapeFieldValue(tf({ schemaType: 'option-with-child' }), 'Yes')).toEqual({ value: 'Yes' });
    expect(shapeFieldValue(tf({ schemaType: 'array', itemType: 'option' }), 'Yes')).toEqual([{ value: 'Yes' }]);
    expect(shapeFieldValue(tf({ schemaType: 'priority' }), 'High')).toEqual({ name: 'High' });
    expect(shapeFieldValue(tf({ schemaType: 'user' }), 'jdoe')).toEqual({ name: 'jdoe' });
    expect(shapeFieldValue(tf({ schemaType: 'date' }), '2026-08-12')).toBe('2026-08-12');
    expect(shapeFieldValue(tf({ schemaType: 'number' }), '4.5')).toBe(4.5);
    expect(shapeFieldValue(tf({ schemaType: 'timetracking' }), '2h')).toEqual({
      originalEstimate: '2h',
      remainingEstimate: '2h',
    });
    expect(shapeFieldValue(tf({ schemaType: 'string' }), 'raw text')).toBe('raw text');
    const dt = shapeFieldValue(tf({ schemaType: 'datetime' }), '2026-08-12') as string;
    expect(dt).toMatch(/^2026-08-12T00:00:00\.000[+-]\d{2}:\d{2}$/);
  });

  it('renders title, subtitle, fields, required stars and OK label', () => {
    const fields = [
      tf({ id: 'resolution', name: 'Resolution', schemaType: 'resolution', allowedValues: ['Fixed', 'Done'] }),
      tf({ id: 'worklog', name: 'Worklog' }),
      tf({ id: 'assignee', name: 'Assignee' }),
      tf({ id: 'comment', name: 'Comment' }),
    ];
    const html = renderToString(
      <TransitionDialog
        issueKey="ISW-7"
        transition={{ id: '31', name: 'Close Issue', toStatus: 'Closed' }}
        fields={fields}
        onClose={noop}
      />,
    );
    expect(html).toContain('Close Issue');
    expect(html).toContain('ISW-7  →  Closed');
    expect(html).toContain('Resolution');
    expect(html).toContain('Time Spent'); // worklog special id
    expect(html).toContain('Assignee');
    expect(html).toContain('Cancel');
    // comment renders only as the bottom box, not as a field label list entry
    expect((html.match(/Comment/g) ?? []).length).toBe(1);
  });

  it('shows Date Started when the screen has a worklog field', () => {
    const html = renderToString(
      <TransitionDialog
        issueKey="ISW-7"
        transition={{ id: '31', name: 'Close Issue', toStatus: 'Closed' }}
        fields={[tf({ id: 'worklog', name: 'Worklog' })]}
        onClose={noop}
      />,
    );
    expect(html).toContain('Date Started');
    expect(html).toContain('datetime-local');
    expect(html).toContain('Pick date');
  });

  it('hides Date Started when the screen has no worklog field', () => {
    const html = renderToString(
      <TransitionDialog
        issueKey="ISW-7"
        transition={{ id: '31', name: 'Close Issue', toStatus: 'Closed' }}
        fields={[tf({ id: 'resolution', name: 'Resolution', schemaType: 'resolution', allowedValues: ['Fixed'] })]}
        onClose={noop}
      />,
    );
    expect(html).not.toContain('Date Started');
  });
});

describe('LogWork (§10.4)', () => {
  it('formats the existing estimate label', () => {
    expect(formatExistingEstimate(2 * 3600)).toBe('2 hours');
    expect(formatExistingEstimate(1.5 * 3600)).toBe('1.5 hours');
    expect(formatExistingEstimate(5400)).toBe('1.5 hours');
    expect(formatExistingEstimate(45 * 60)).toBe('45 minutes');
  });

  it('renders title, hints and radios (existing shown only with estimate)', () => {
    const html = renderToString(
      <LogWork issueKey="ISW-9" remainingEstimate={7200} onClose={noop} />,
    );
    expect(html).toContain('Log Work: ISW-9');
    expect(html).toContain('(eg. 3w 4d 12h) — estimate of time you spent working.');
    expect(html).toContain('Adjust automatically');
    expect(html).toContain('The estimate is reduced by the amount of work done, but never below 0.');
    expect(html).toContain('Use existing estimate of 2 hours');
    expect(html).toContain('Set to');
    expect(html).toContain('Reduce by');

    const withoutEstimate = renderToString(<LogWork issueKey="ISW-9" onClose={noop} />);
    expect(withoutEstimate).not.toContain('Use existing estimate');
  });

  it('LogWork renders the Date Started picker button', () => {
    const html = renderToString(<LogWork issueKey="ISW-7" onClose={noop} />);
    expect(html).toContain('Date Started');
    expect(html).toContain('Pick date');
  });
});

describe('CreateIssue (§10.2)', () => {
  it('field kinds follow the table', () => {
    const f = (p: Partial<JiraCreateFieldMeta>): JiraCreateFieldMeta => ({
      fieldId: 'x',
      displayName: 'X',
      required: false,
      schemaType: 'string',
      allowedValues: [],
      ...p,
    });
    expect(fieldKind(f({ allowedValues: ['A'], schemaType: 'array' }))).toBe('multiselect');
    expect(fieldKind(f({ allowedValues: ['A'], schemaType: 'option' }))).toBe('select');
    expect(fieldKind(f({ displayName: 'Description' }))).toBe('longtext');
    expect(fieldKind(f({ displayName: 'Environment' }))).toBe('longtext');
    expect(fieldKind(f({ schemaType: 'date' }))).toBe('date');
    expect(fieldKind(f({ schemaType: 'datetime' }))).toBe('datetime');
    expect(fieldKind(f({ schemaType: 'number' }))).toBe('number');
    expect(fieldKind(f({ schemaType: 'user' }))).toBe('user');
    expect(fieldKind(f({}))).toBe('text');
  });

  it('fallback skeleton matches the contract', () => {
    const skeleton = fallbackSkeleton();
    const names = skeleton.map((f) => f.displayName);
    expect(names).toEqual([
      'Summary',
      'Priority',
      'Program',
      'Reproducibility',
      'Environment Affected',
      'Severity',
      'Description',
    ]);
    expect(skeleton.find((f) => f.displayName === 'Priority')?.allowedValues).toEqual([
      'Highest',
      'High',
      'Medium',
      'Low',
      'Lowest',
    ]);
    expect(skeleton.find((f) => f.displayName === 'Program')?.allowedValues).toContain('Indigo 100K');
    expect(skeleton.find((f) => f.displayName === 'Reproducibility')?.allowedValues).toContain('Did not try');
  });

  it('submit shaping omits empty values', () => {
    const sel: JiraCreateFieldMeta = {
      fieldId: 'priority',
      displayName: 'Priority',
      required: true,
      schemaType: 'priority',
      allowedValues: ['High'],
    };
    expect(shapeCreateValue(sel, '')).toBeUndefined();
    expect(shapeCreateValue(sel, 'High')).toEqual({ name: 'High' });
    const multi: JiraCreateFieldMeta = { ...sel, schemaType: 'array' };
    expect(shapeCreateValue(multi, [])).toBeUndefined();
    expect(shapeCreateValue(multi, ['A', 'B'])).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it('renders header, subtitle and loading state', () => {
    const html = renderToString(<CreateIssue onClose={noop} />);
    expect(html).toContain('Indigo Software (ISW)');
    expect(html).toContain('Required fields are marked with an asterisk *');
    expect(html).toContain('Loading create screen');
    expect(html).toContain('Create another');
    expect(html).toContain('Open in Jira');
  });
});

describe('CommandPalette (§11)', () => {
  it('builds the JQL per contract', () => {
    expect(paletteJql('login bug')).toBe('summary ~ "login bug*"');
    expect(paletteJql('ISW-123')).toBe('key = "ISW-123" OR summary ~ "ISW-123*"');
    expect(paletteJql('isw-9')).toBe('key = "ISW-9" OR summary ~ "isw-9*"');
  });

  it('renders query box, NAV entries and footer hint', () => {
    const html = renderToString(<CommandPalette onClose={noop} onPickIssue={noop} />);
    expect(html).toContain('Search Jira · Confluence · TestRail · Enter to open · Esc to close');
    expect(html).toContain('NAV');
    expect(html).toContain('Dashboard');
  });

  it('pomodoro pick mode retitles and hides NAV', () => {
    const html = renderToString(<CommandPalette mode="pomodoro" onClose={noop} onPickIssue={noop} />);
    expect(html).toContain('Pick issue for Pomodoro');
    expect(html).not.toContain('>NAV<');
  });
});

describe('HelpDialog', () => {
  it('renders the tabbed guide with all areas and the footer version', () => {
    const html = renderToString(<HelpDialog onClose={noop} />);
    expect(html).toContain('Jira');
    expect(html).toContain('TestRail');
    expect(html).toContain('Confluence');
    expect(html).toContain('Lumo (AI)');
    expect(html).toContain('Alerts');
    expect(html).toContain('Traceability');
    expect(html).toContain('Setup &amp; Data');
    expect(html).toContain('Shortcuts');
    expect(html).toContain('Mission Control');
    expect(html).toContain('v1.1');
  });
});

describe('Lumo (§10.10)', () => {
  it('source map matches the contract', () => {
    expect(sourceMeta('jira')).toEqual({ label: 'Jira', color: '#2563EB' });
    expect(sourceMeta('confluence')).toEqual({ label: 'Confluence', color: '#1D4ED8' });
    expect(sourceMeta('testrail')).toEqual({ label: 'TestRail', color: '#059669' });
    expect(sourceMeta('github')).toEqual({ label: 'GitHub', color: '#374151' });
    expect(sourceMeta('slack')).toEqual({ label: 'Slack', color: '#4F46E5' });
  });

  it('panel renders header, models and input', () => {
    const html = renderToString(<LumoPanel open onClose={noop} />);
    expect(html).toContain('Lumo');
    expect(html).toContain('powered by');
    expect(html).toContain('claude-sonnet-5');
    expect(html).toContain('gemini-2.5-pro');
    expect(html).toContain('Ask Lumo anything...');
  });

  it('card modal renders badge, fields and footer url', () => {
    const html = renderToString(
      <LumoCardModal
        card={{
          source: 'jira',
          title: 'ISW-1',
          summary: 'Something broke',
          url: 'https://jira.example/browse/ISW-1',
          fields: { status: 'Open', priority: 'High' },
        }}
        onClose={noop}
      />,
    );
    expect(html).toContain('Jira');
    expect(html).toContain('Something broke');
    expect(html).toContain('status');
    expect(html).toContain('Open in browser ⤴');
    expect(html).toContain('https://jira.example/browse/ISW-1');
  });
});
