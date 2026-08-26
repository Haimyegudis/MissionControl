import { describe, expect, it } from 'vitest';
import { mergeTableFilterTables, originalPageDocument } from '../src/routes/confluence.js';
import type { ConfluencePageContent } from '@mc/core';

describe('Confluence render document', () => {
  it('sanitizes active content and applies a nonce to its own script', () => {
    const page: ConfluencePageContent = {
      id: '42',
      spaceKey: 'DOC',
      title: '<Unsafe title>',
      parentId: null,
      status: 'current',
      url: '/pages/viewpage.action?pageId=42',
      createdBy: null,
      createdAt: null,
      lastModifiedBy: 'Author',
      lastModifiedAt: '2026-08-17T08:00:00.000Z',
      excerpt: null,
      storageBody: '',
      viewBody:
        '<p>Safe</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
        '<img src="https://docs.example/image.png" onerror="alert(2)">' +
        '<a href="javascript:alert(3)" onclick="alert(4)">bad link</a>',
      version: 7,
    };

    const html = originalPageDocument(page, 'https://docs.example', '', 'known-nonce');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<script nonce="known-nonce">');
    expect(html).toContain('&lt;Unsafe title&gt;');
  });

  it('keeps a safe subset of inline styles but strips positioning properties', () => {
    const basePage: Omit<ConfluencePageContent, 'viewBody'> = {
      id: '42',
      spaceKey: 'DOC',
      title: 'Styled',
      parentId: null,
      status: 'current',
      url: '/pages/viewpage.action?pageId=42',
      createdBy: null,
      createdAt: null,
      lastModifiedBy: 'Author',
      lastModifiedAt: '2026-08-17T08:00:00.000Z',
      excerpt: null,
      storageBody: '',
      version: 7,
    };

    const allowedHtml = originalPageDocument(
      { ...basePage, viewBody: '<p style="color: red; text-align: center;">x</p>' },
      'https://docs.example',
      '',
      'known-nonce',
    );
    expect(allowedHtml).toContain('color:red');
    expect(allowedHtml).toContain('text-align:center');

    const strippedHtml = originalPageDocument(
      { ...basePage, viewBody: '<p style="position: absolute; color: blue">x</p>' },
      'https://docs.example',
      '',
      'known-nonce',
    );
    expect(strippedHtml).not.toContain('position');
    expect(strippedHtml).toContain('color:blue');
  });

  it('forces the Table Filter plugin wrapper visible now that its JS is stripped', () => {
    const page: ConfluencePageContent = {
      id: '42',
      spaceKey: 'DOC',
      title: 'Filtered',
      parentId: null,
      status: 'current',
      url: '/pages/viewpage.action?pageId=42',
      createdBy: null,
      createdAt: null,
      lastModifiedBy: 'Author',
      lastModifiedAt: '2026-08-17T08:00:00.000Z',
      excerpt: null,
      storageBody: '',
      viewBody: '<p>content</p>',
      version: 7,
    };

    const html = originalPageDocument(page, 'https://docs.example', '', 'known-nonce');
    expect(html).toContain('.tablefilter-outer-wrapper[data-id]{visibility:visible');
  });

  it('rewrites proxied asset URLs absolute against the app origin, not the base href', () => {
    const page: ConfluencePageContent = {
      id: '42',
      spaceKey: 'DOC',
      title: 'Styled',
      parentId: null,
      status: 'current',
      url: '/pages/viewpage.action?pageId=42',
      createdBy: null,
      createdAt: null,
      lastModifiedBy: 'Author',
      lastModifiedAt: '2026-08-17T08:00:00.000Z',
      excerpt: null,
      storageBody: '',
      viewBody: '<p>content</p>',
      version: 7,
    };
    const upstreamHtml = '<html><head><link rel="stylesheet" href="/s/main.css"></head><body></body></html>';

    const html = originalPageDocument(page, 'https://docs.example', upstreamHtml, 'known-nonce', 'http://self.test');
    expect(html).toContain('<base href="https://docs.example/pages/viewpage.action?pageId=42">');
    expect(html).toContain('href="http://self.test/api/confluence/proxy?url=');
    expect(html).not.toContain('href="/api/confluence/proxy?url=');
  });
});

describe('mergeTableFilterTables', () => {
  it('merges same-header tables in a tablefilter wrapper into one table', () => {
    const header = '<tr><th>Node</th><th>Type</th></tr>';
    const table = (rows: number, offset: number) =>
      `<table>${header}${Array.from({ length: rows }, (_, i) => `<tr><td>N${offset + i}</td><td>T</td></tr>`).join('')}</table>`;
    const html = `<div class="tablefilter-outer-wrapper" data-id="1">${table(2, 0)}${table(3, 2)}${table(4, 5)}</div>`;

    const merged = mergeTableFilterTables(html);
    const tableCount = (merged.match(/<table>/g) ?? []).length;
    const headerCount = (merged.match(/<th>Node<\/th>/g) ?? []).length;
    const dataRowCount = (merged.match(/<td>N\d+<\/td>/g) ?? []).length;

    expect(tableCount).toBe(1);
    expect(headerCount).toBe(1);
    expect(dataRowCount).toBe(9);
  });

  it('leaves tables with different headers untouched', () => {
    const html =
      '<div class="tablefilter-outer-wrapper" data-id="1">' +
      '<table><tr><th>Node</th></tr><tr><td>N1</td></tr></table>' +
      '<table><tr><th>Other</th></tr><tr><td>O1</td></tr></table>' +
      '</div>';

    const merged = mergeTableFilterTables(html);
    expect((merged.match(/<table>/g) ?? []).length).toBe(2);
    expect(merged).toContain('N1');
    expect(merged).toContain('O1');
  });

  it('leaves tables outside a tablefilter wrapper untouched', () => {
    const html =
      '<table><tr><th>Node</th></tr><tr><td>N1</td></tr></table>' +
      '<table><tr><th>Node</th></tr><tr><td>N2</td></tr></table>';

    const merged = mergeTableFilterTables(html);
    expect((merged.match(/<table>/g) ?? []).length).toBe(2);
  });
});

