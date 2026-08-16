// Markdown → HTML for the WYSIWYG case editor (lib/caseMarkdown.mdToHtml).
// htmlToMd needs a live DOM and is exercised in the browser.

import { describe, expect, it } from 'vitest';
import { mdToHtml } from '../src/lib/caseMarkdown';

describe('mdToHtml', () => {
  it('renders inline bold/italic/code/links', () => {
    expect(mdToHtml('a **b** *i* `c`')).toBe('<div>a <b>b</b> <i>i</i> <code>c</code></div>');
    expect(mdToHtml('[docs](https://x.y)')).toBe('<div><a href="https://x.y">docs</a></div>');
  });

  it('escapes HTML in the source text', () => {
    expect(mdToHtml('<script>alert(1)</script>')).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
  });

  it('groups numbered and bullet lines into lists', () => {
    expect(mdToHtml('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(mdToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('renders GFM tables with header separator', () => {
    const html = mdToHtml('| H1 | H2 |\n| --- | --- |\n| a | b |');
    expect(html).toContain('<table><thead><tr><th>H1</th><th>H2</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td>a</td><td>b</td></tr></tbody>');
  });

  it('keeps plain lines and blank lines as divs', () => {
    expect(mdToHtml('one\n\ntwo')).toBe('<div>one</div><div><br></div><div>two</div>');
    expect(mdToHtml('')).toBe('<div><br></div>');
  });
});
