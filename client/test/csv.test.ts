import { describe, expect, it } from 'vitest';
import { buildCsv, csvFilename } from '../src/lib/csv';

interface Row {
  key: string;
  summary: string;
  hours: number;
}

const columns = [
  { header: 'Key', value: (r: Row) => r.key },
  { header: 'Summary', value: (r: Row) => r.summary },
  { header: 'Hours', value: (r: Row) => r.hours },
];

describe('buildCsv (ui-parity §12.10)', () => {
  it('starts with a UTF-8 BOM', () => {
    const csv = buildCsv(columns, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('emits header row + data rows with CRLF line endings', () => {
    const csv = buildCsv(columns, [{ key: 'ISW-1', summary: 'Plain', hours: 2 }]);
    expect(csv).toBe('﻿Key,Summary,Hours\r\nISW-1,Plain,2\r\n');
  });

  it('quotes and escapes commas, quotes and newlines (RFC-4180)', () => {
    const csv = buildCsv(columns, [{ key: 'ISW-2', summary: 'Has, comma and "quote"\nand newline', hours: 1.5 }]);
    expect(csv).toContain('"Has, comma and ""quote""\nand newline"');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = buildCsv(
      [{ header: 'A', value: () => null }, { header: 'B', value: () => undefined }],
      [{} as Row],
    );
    expect(csv).toBe('﻿A,B\r\n,\r\n');
  });
});

describe('csvFilename', () => {
  it('replaces dots with underscores and appends .csv', () => {
    expect(csvFilename('Incident.All')).toBe('Incident_All.csv');
    expect(csvFilename('Dashboard.SprintTable')).toBe('Dashboard_SprintTable.csv');
    expect(csvFilename('nodots')).toBe('nodots.csv');
  });
});
