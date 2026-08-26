import { describe, expect, it } from 'vitest';
import { originalPageDocument } from '../src/routes/confluence.js';
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
});

