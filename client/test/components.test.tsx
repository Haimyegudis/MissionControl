// UI smoke tests via react-dom/server (no jsdom in this workspace).

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DataGrid } from '../src/components/DataGrid';
import type { GridColumn } from '../src/components/DataGrid';
import { PagedGrid } from '../src/components/PagedGrid';
import { EpicChip } from '../src/components/EpicChip';
import { IssueLinkText } from '../src/components/IssueLinkText';
import { Bars } from '../src/charts/Bars';
import { StackedBarsH } from '../src/charts/StackedBarsH';

interface Row {
  key: string;
  summary: string;
}

const columns: GridColumn<Row>[] = [
  { key: 'key', header: 'Key', width: 100 },
  { key: 'summary', header: 'Summary', width: 300 },
];

const rows: Row[] = [
  { key: 'ISW-1', summary: 'First row' },
  { key: 'ISW-2', summary: 'Second row' },
];

describe('DataGrid', () => {
  it('renders headers and row cells', () => {
    const html = renderToString(
      <DataGrid stateKey="Test.Grid" columns={columns} rows={rows} rowKey={(r) => r.key} />,
    );
    expect(html).toContain('Key');
    expect(html).toContain('Summary');
    expect(html).toContain('ISW-1');
    expect(html).toContain('Second row');
  });

  it('renders a resize grip on every header', () => {
    const html = renderToString(
      <DataGrid stateKey="Test.Grid" columns={columns} rows={rows} rowKey={(r) => r.key} />,
    );
    expect(html.split('dg-grip').length - 1).toBe(columns.length);
    expect(html).toContain('Drag to resize · double-click to reset');
  });

  it('renders the empty text when there are no rows', () => {
    const html = renderToString(
      <DataGrid stateKey="Test.Grid" columns={columns} rows={[]} rowKey={(r) => r.key} emptyText="Nothing here" />,
    );
    expect(html).toContain('Nothing here');
  });
});

describe('PagedGrid', () => {
  it('shows "{first}-{last} of {total}" and slices to the page size', () => {
    const many: Row[] = Array.from({ length: 23 }, (_, i) => ({ key: `ISW-${i + 1}`, summary: `Row ${i + 1}` }));
    const html = renderToString(
      <PagedGrid stateKey="Test.Paged" columns={columns} rows={many} rowKey={(r) => r.key} />,
    );
    expect(html).toContain('1-10 of 23');
    expect(html).toContain('ISW-10');
    expect(html).not.toContain('Row 11'); // page 2 content not rendered
    expect(html).toContain('◀');
    expect(html).toContain('▶');
  });
});

describe('EpicChip', () => {
  it('shows epic name with the key as tooltip', () => {
    const html = renderToString(<EpicChip epicKey="ISW-9" epicName="Platform" />);
    expect(html).toContain('Platform');
    expect(html).toContain('title="ISW-9"');
  });
});

describe('IssueLinkText', () => {
  it('renders keys as links and URLs as numbered links', () => {
    const html = renderToString(<IssueLinkText text="ISW-5 via https://example.com/x" />);
    expect(html).toContain('ISW-5');
    expect(html).toContain('Open ISW-5 in new window');
    expect(html).toContain('Link 1');
    expect(html).toContain('href="https://example.com/x"');
  });
});

describe('charts', () => {
  it('Bars renders bars, gridlines and legend', () => {
    const html = renderToString(
      <Bars
        title="Logged vs Estimated"
        series={[
          { name: 'Estimated', color: '#4F46E5' },
          { name: 'Logged', color: '#10B981' },
        ]}
        groups={[
          { label: 'ISW-1', values: [8, 5] },
          { label: 'ISW-2', values: [4, 6], colors: [undefined, '#EF4444'] },
        ]}
      />,
    );
    expect(html).toContain('Logged vs Estimated');
    expect(html).toContain('Estimated');
    expect(html).toContain('#EF4444');
  });

  it('StackedBarsH renders rows with legend outside right', () => {
    const html = renderToString(
      <StackedBarsH
        rows={[{ label: 'Mon 10 Aug', values: [2, 3] }]}
        series={[
          { name: 'ISW-1', color: '#4F46E5' },
          { name: 'ISW-2', color: '#10B981' },
        ]}
      />,
    );
    expect(html).toContain('Mon 10 Aug');
    expect(html).toContain('ISW-1');
    expect(html).toContain('ISW-2');
  });
});
