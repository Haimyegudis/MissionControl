import { describe, expect, it } from 'vitest';
import {
  applyJqlSuggestion,
  getJqlCompletionContext,
  getJqlSuggestions,
  jqlFieldText,
  jqlValueText,
} from '../src/lib/jqlAutocomplete';

describe('getJqlCompletionContext', () => {
  it('suggests fields at the start and after a logical connector', () => {
    expect(getJqlCompletionContext('sta', 3).mode).toBe('field');
    const afterAnd = getJqlCompletionContext('project = ISW AND pri', 21);
    expect(afterAnd).toMatchObject({ mode: 'field', query: 'pri' });
  });

  it('moves from a complete field to operator completion', () => {
    expect(getJqlCompletionContext('status ', 7)).toMatchObject({
      mode: 'operator',
      field: 'status',
      query: '',
    });
    expect(getJqlCompletionContext('status NO', 9)).toMatchObject({ mode: 'operator', query: 'NO' });
  });

  it('extracts a value prefix and its exact replacement range', () => {
    const jql = 'project = ISW AND status = Do';
    const context = getJqlCompletionContext(jql, jql.length);
    expect(context).toMatchObject({ mode: 'value', field: 'status', operator: '=', query: 'Do' });
    expect(jql.slice(context.replaceFrom, context.replaceTo)).toBe('Do');
  });

  it('handles quoted custom fields and IN-list values', () => {
    const jql = '"Epic Link" IN (ISW-';
    const context = getJqlCompletionContext(jql, jql.length, ['Epic Link']);
    expect(context).toMatchObject({
      mode: 'value',
      field: 'Epic Link',
      operator: 'IN',
      query: 'ISW-',
      insideList: true,
    });
  });

  it('suggests connectors after a complete value and sort directions after ORDER BY', () => {
    const valueJql = 'status = Done ';
    expect(getJqlCompletionContext(valueJql, valueJql.length).mode).toBe('keyword');
    const orderJql = 'project = ISW ORDER BY updated DE';
    expect(getJqlCompletionContext(orderJql, orderJql.length)).toMatchObject({
      mode: 'direction',
      query: 'DE',
    });
  });
});

describe('JQL suggestions and insertion', () => {
  it('includes and quotes Jira custom fields', () => {
    const context = getJqlCompletionContext('ep', 2, ['Epic Link']);
    const item = getJqlSuggestions(context, ['Epic Link']).find((candidate) => candidate.label === 'Epic Link');
    expect(item?.insertText).toBe('"Epic Link" ');
    expect(jqlFieldText('status')).toBe('status');
  });

  it('quotes values only when JQL requires it', () => {
    expect(jqlValueText('Done')).toBe('Done');
    expect(jqlValueText('In Progress')).toBe('"In Progress"');
    expect(jqlValueText('currentUser()')).toBe('currentUser()');
  });

  it('replaces only the token at the caret', () => {
    const jql = 'project = ISW AND status = Do ORDER BY updated';
    const caret = jql.indexOf('Do') + 2;
    const context = getJqlCompletionContext(jql, caret);
    const suggestion = getJqlSuggestions(context, [], ['Done'])[0];
    expect(applyJqlSuggestion(jql, context, suggestion)).toEqual({
      value: 'project = ISW AND status = Done  ORDER BY updated',
      caret: jql.indexOf('Do') + 'Done '.length,
    });
  });
});
