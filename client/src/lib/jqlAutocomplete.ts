export type JqlCompletionMode =
  | 'field'
  | 'operator'
  | 'value'
  | 'keyword'
  | 'order-field'
  | 'direction';

export interface JqlCompletionContext {
  mode: JqlCompletionMode;
  query: string;
  replaceFrom: number;
  replaceTo: number;
  field?: string;
  operator?: string;
  insideList?: boolean;
}

export interface JqlSuggestion {
  label: string;
  insertText: string;
  detail: string;
  kind: 'field' | 'operator' | 'value' | 'keyword';
}

export const COMMON_JQL_FIELDS = [
  'project',
  'key',
  'summary',
  'description',
  'text',
  'issuetype',
  'status',
  'statusCategory',
  'priority',
  'resolution',
  'assignee',
  'reporter',
  'creator',
  'sprint',
  'fixVersion',
  'affectedVersion',
  'component',
  'labels',
  'created',
  'updated',
  'resolved',
  'due',
  'worklogAuthor',
] as const;

const OPERATORS = ['NOT IN', 'IS NOT', 'WAS NOT IN', 'WAS IN', '!=', '!~', '>=', '<=', '=', '~', '>', '<', 'IN', 'IS', 'WAS', 'CHANGED'];
const KEYWORDS = ['AND', 'OR', 'ORDER BY'];
const VALUE_FUNCTIONS = [
  'currentUser()',
  'membersOf("")',
  'openSprints()',
  'futureSprints()',
  'closedSprints()',
  'now()',
  'startOfDay()',
  'endOfDay()',
  'startOfWeek()',
  'endOfWeek()',
  'EMPTY',
];

function uniqueFields(fields: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...COMMON_JQL_FIELDS, ...fields]) {
    const name = value.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function jqlFieldText(field: string): string {
  return /^[A-Za-z][A-Za-z0-9_.\[\]-]*$/.test(field)
    ? field
    : `"${field.replace(/"/g, '\\"')}"`;
}

export function jqlValueText(value: string): string {
  const trimmed = value.trim();
  if (/^(?:EMPTY|NULL|true|false|-?\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*\(.*\))$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[A-Za-z0-9_.@\/-]+$/.test(trimmed) && !/^(?:AND|OR|IN|IS|NOT|ORDER|BY)$/i.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Finds the last AND/OR outside a quoted string. */
function lastLogicalBoundary(text: string): number {
  let quoted = false;
  let escaped = false;
  let tokenStart = -1;
  let last = 0;
  const commit = (end: number) => {
    if (tokenStart < 0) return;
    const token = text.slice(tokenStart, end).toUpperCase();
    if (token === 'AND' || token === 'OR') last = end;
    tokenStart = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      commit(i);
      quoted = true;
    } else if (/[A-Za-z]/.test(ch)) {
      if (tokenStart < 0) tokenStart = i;
    } else {
      commit(i);
    }
  }
  commit(text.length);
  return last;
}

function matchField(segment: string, fields: readonly string[]): { field: string; end: number } | null {
  if (segment.startsWith('"')) {
    let escaped = false;
    for (let i = 1; i < segment.length; i++) {
      const ch = segment[i];
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') return { field: segment.slice(1, i).replace(/\\"/g, '"'), end: i + 1 };
    }
    return null;
  }

  for (const field of uniqueFields(fields).sort((a, b) => b.length - a.length)) {
    const candidates = [field, jqlFieldText(field)];
    for (const candidate of candidates) {
      if (!segment.toLowerCase().startsWith(candidate.toLowerCase())) continue;
      const next = segment[candidate.length];
      if (next === undefined || /\s|[=!~<>]/.test(next)) return { field, end: candidate.length };
    }
  }

  const generic = segment.match(/^([A-Za-z][A-Za-z0-9_.\[\]-]*)/);
  if (!generic) return null;
  const next = segment[generic[1].length];
  // An unknown bare token is only a complete field once the user starts an
  // operator. At end-of-input it is still a field-name prefix (for example
  // `sta` → status/statusCategory).
  return next !== undefined && /\s|[=!~<>]/.test(next)
    ? { field: generic[1], end: generic[1].length }
    : null;
}

function completeOperator(rest: string): { operator: string; end: number } | null {
  for (const operator of [...OPERATORS].sort((a, b) => b.length - a.length)) {
    const pattern = operator.replace(/\s+/g, '\\s+').replace(/[!~]/g, '\\$&');
    const match = rest.match(new RegExp(`^${pattern}(?=\\s|\\(|$)`, 'i'));
    if (match) return { operator, end: match[0].length };
  }
  return null;
}

function valueContext(
  prefix: string,
  tail: string,
  tailStart: number,
  field: string,
  operator: string,
): JqlCompletionContext {
  const trimmed = tail.trim();
  const insideList = /\b(?:NOT\s+IN|IN|WAS\s+IN|WAS\s+NOT\s+IN)$/i.test(operator) &&
    (tail.match(/\(/g)?.length ?? 0) > (tail.match(/\)/g)?.length ?? 0);

  if (trimmed && /\s$/.test(tail) && (!insideList || trimmed.endsWith(')'))) {
    return { mode: 'keyword', query: '', replaceFrom: prefix.length, replaceTo: prefix.length };
  }

  let relativeStart = tail.length - tail.trimStart().length;
  const lastSeparator = Math.max(tail.lastIndexOf('('), tail.lastIndexOf(','));
  if (lastSeparator >= relativeStart) relativeStart = lastSeparator + 1;
  while (/\s/.test(tail[relativeStart] ?? '')) relativeStart++;
  let query = tail.slice(relativeStart).trim();
  if (query.startsWith('"')) query = query.slice(1);
  if (query.endsWith('"')) query = query.slice(0, -1);
  return {
    mode: 'value',
    query,
    replaceFrom: tailStart + relativeStart,
    replaceTo: prefix.length,
    field,
    operator,
    insideList,
  };
}

export function getJqlCompletionContext(
  jql: string,
  caret: number,
  fieldNames: readonly string[] = [],
): JqlCompletionContext {
  const safeCaret = Math.max(0, Math.min(caret, jql.length));
  const prefix = jql.slice(0, safeCaret);
  const orderMatch = /\bORDER\s+BY\b/gi;
  let orderIndex = -1;
  for (const match of prefix.matchAll(orderMatch)) orderIndex = match.index! + match[0].length;
  if (orderIndex >= 0) {
    const orderTail = prefix.slice(orderIndex);
    const comma = orderTail.lastIndexOf(',');
    const partStart = orderIndex + comma + 1;
    const part = prefix.slice(partStart);
    const leading = part.length - part.trimStart().length;
    const clean = part.trimStart();
    const direction = clean.match(/^(.*\S)\s+(A\w*|D\w*)$/i);
    if (direction) {
      return {
        mode: 'direction',
        query: direction[2],
        replaceFrom: safeCaret - direction[2].length,
        replaceTo: safeCaret,
      };
    }
    return {
      mode: 'order-field',
      query: clean,
      replaceFrom: partStart + leading,
      replaceTo: safeCaret,
    };
  }

  const boundary = lastLogicalBoundary(prefix);
  const rawSegment = prefix.slice(boundary);
  const leading = rawSegment.length - rawSegment.trimStart().length;
  const segmentStart = boundary + leading;
  const segment = rawSegment.trimStart().replace(/^\(+\s*/, (opening) => {
    // Keep replacement positions aligned while treating grouping parens as a boundary.
    return ' '.repeat(opening.length);
  });
  const segmentLeading = segment.length - segment.trimStart().length;
  const clean = segment.trimStart();
  const cleanStart = segmentStart + segmentLeading;
  const field = matchField(clean, fieldNames);
  if (!field) {
    return { mode: 'field', query: clean, replaceFrom: cleanStart, replaceTo: safeCaret };
  }

  const restRaw = clean.slice(field.end);
  const restLeading = restRaw.length - restRaw.trimStart().length;
  const rest = restRaw.trimStart();
  if (!rest) {
    return { mode: 'operator', query: '', replaceFrom: safeCaret, replaceTo: safeCaret, field: field.field };
  }

  const operator = completeOperator(rest);
  if (operator) {
    const tailStart = cleanStart + field.end + restLeading + operator.end;
    return valueContext(prefix, rest.slice(operator.end), tailStart, field.field, operator.operator);
  }
  return {
    mode: 'operator',
    query: rest,
    replaceFrom: cleanStart + field.end + restLeading,
    replaceTo: safeCaret,
    field: field.field,
  };
}

function ranked(values: readonly JqlSuggestion[], query: string): JqlSuggestion[] {
  const q = query.trim().replace(/^"/, '').toLowerCase();
  const unique = new Map<string, JqlSuggestion>();
  for (const item of values) if (!unique.has(item.label.toLowerCase())) unique.set(item.label.toLowerCase(), item);
  return [...unique.values()]
    .filter((item) => !q || item.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    })
    .slice(0, 50);
}

export function getJqlSuggestions(
  context: JqlCompletionContext,
  fieldNames: readonly string[] = [],
  remoteValues: readonly string[] = [],
): JqlSuggestion[] {
  if (context.mode === 'field' || context.mode === 'order-field') {
    return ranked(
      uniqueFields(fieldNames).map((field) => ({
        label: field,
        insertText: `${jqlFieldText(field)} `,
        detail: context.mode === 'order-field' ? 'JQL sort field' : 'JQL field',
        kind: 'field' as const,
      })),
      context.query,
    );
  }
  if (context.mode === 'operator') {
    return ranked(
      OPERATORS.map((operator) => ({
        label: operator,
        insertText: `${operator}${/\bIN$/i.test(operator) ? ' (' : ' '}`,
        detail: `Operator for ${context.field ?? 'field'}`,
        kind: 'operator' as const,
      })),
      context.query,
    );
  }
  if (context.mode === 'value') {
    const values = [...remoteValues, ...VALUE_FUNCTIONS];
    return ranked(
      values.map((value) => ({
        label: value,
        insertText: `${jqlValueText(value)}${context.insideList ? '' : ' '}`,
        detail: context.field ? `Value for ${context.field}` : 'JQL value',
        kind: 'value' as const,
      })),
      context.query,
    );
  }
  if (context.mode === 'direction') {
    return ranked(
      ['ASC', 'DESC'].map((direction) => ({
        label: direction,
        insertText: direction,
        detail: 'Sort direction',
        kind: 'keyword' as const,
      })),
      context.query,
    );
  }
  return KEYWORDS.map((keyword) => ({
    label: keyword,
    insertText: `${keyword} `,
    detail: 'JQL keyword',
    kind: 'keyword' as const,
  }));
}

export function applyJqlSuggestion(
  jql: string,
  context: JqlCompletionContext,
  suggestion: JqlSuggestion,
): { value: string; caret: number } {
  const value = jql.slice(0, context.replaceFrom) + suggestion.insertText + jql.slice(context.replaceTo);
  return { value, caret: context.replaceFrom + suggestion.insertText.length };
}
