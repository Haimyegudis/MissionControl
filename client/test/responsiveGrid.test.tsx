import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CardList } from '../src/components/CardList';
import { ResponsiveGrid } from '../src/components/ResponsiveGrid';
import type { GridColumn } from '../src/components/DataGrid';

interface Row {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  extra: string;
}

const columns: GridColumn<Row>[] = [
  { key: 'key', header: 'Key', width: 100 },
  { key: 'summary', header: 'Summary', width: 300 },
  { key: 'status', header: 'Status', width: 100, render: (r) => <b>{r.status}</b> },
  { key: 'assignee', header: 'Assignee', width: 120 },
  { key: 'priority', header: 'Priority', width: 80 },
  { key: 'extra', header: 'Extra', width: 80 },
];

const rows: Row[] = [
  { key: 'A-1', summary: 'First', status: 'Open', assignee: 'Dana', priority: 'High', extra: 'x' },
  { key: 'A-2', summary: 'Second', status: 'Done', assignee: 'Ravi', priority: 'Low', extra: 'y' },
];

describe('CardList', () => {
  it('renders one card per row with the first column as the title', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('A-1');
    expect(html).toContain('A-2');
    expect(html).toContain('First');
  });

  it('uses the column render function when present', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('<b>Open</b>');
  });

  it('prefers format over the raw property', () => {
    const cols: GridColumn<Row>[] = [
      { key: 'key', header: 'Key', width: 100 },
      { key: 'priority', header: 'Priority', width: 80, format: (r) => `P:${r.priority}` },
    ];
    const html = renderToString(<CardList columns={cols} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('P:High');
  });

  it('shows the visible fields and hides the overflow behind a count', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} visibleFields={4} />);
    expect(html).toContain('Assignee');
    expect(html).toContain('2 more');
  });

  it('shows no overflow control when every column fits', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} visibleFields={99} />);
    expect(html).not.toContain('more');
    expect(html).toContain('Extra');
  });

  it('renders an empty-state message with no rows', () => {
    const html = renderToString(<CardList columns={columns} rows={[]} rowKey={(r) => r.key} />);
    expect(html).toContain('No rows');
  });

  it('honours a custom empty-state message', () => {
    const html = renderToString(
      <CardList columns={columns} rows={[]} rowKey={(r) => r.key} emptyText="Nothing here" />,
    );
    expect(html).toContain('Nothing here');
  });

  it('renders a null cell value as blank rather than the string null', () => {
    const cols: GridColumn<Row>[] = [
      { key: 'key', header: 'Key', width: 100 },
      { key: 'missing', header: 'Missing', width: 80 },
    ];
    const html = renderToString(<CardList columns={cols} rows={rows} rowKey={(r) => r.key} />);
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('>null<');
  });
});

describe('ResponsiveGrid', () => {
  it('renders the desktop grid when the viewport is wide (server render has no window)', () => {
    const html = renderToString(
      <ResponsiveGrid stateKey="test" columns={columns} rows={rows} rowKey={(r) => r.key} />,
    );
    // The desktop grid renders a real table header; CardList never does.
    expect(html).toContain('Summary');
    expect(html).toContain('<table');
  });
});


describe('CardList hierarchy', () => {
  it('renders the second column as an unlabelled subtitle, not a field row', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('First');
    // "Summary" is the header of the subtitle column; it must not be printed.
    expect(html).not.toContain('Summary');
  });

  it('still labels the remaining fields', () => {
    const html = renderToString(<CardList columns={columns} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('Status');
  });

  it('drops a field whose value is blank rather than printing an empty row', () => {
    const cols: GridColumn<Row>[] = [
      { key: 'key', header: 'Key', width: 100 },
      { key: 'summary', header: 'Summary', width: 300 },
      { key: 'status', header: 'Status', width: 100 },
      { key: 'nothing', header: 'Nothing', width: 80, format: () => '' },
    ];
    const html = renderToString(<CardList columns={cols} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('Status');
    expect(html).not.toContain('Nothing');
  });

  it('survives a single-column grid', () => {
    const cols: GridColumn<Row>[] = [{ key: 'key', header: 'Key', width: 100 }];
    const html = renderToString(<CardList columns={cols} rows={rows} rowKey={(r) => r.key} />);
    expect(html).toContain('A-1');
    expect(html).not.toContain('more');
  });
});
