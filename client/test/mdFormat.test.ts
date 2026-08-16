// Markdown formatting ops for the case editor toolbar (lib/mdFormat).

import { describe, expect, it } from 'vitest';
import { applyMdFormat } from '../src/lib/mdFormat';

describe('applyMdFormat', () => {
  it('wraps the selection in bold/italic/code marks', () => {
    const r = applyMdFormat('open the menu', 5, 8, 'bold');
    expect(r.text).toBe('open **the** menu');
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('the');
    expect(applyMdFormat('x', 0, 1, 'italic').text).toBe('*x*');
    expect(applyMdFormat('run cmd now', 4, 7, 'code').text).toBe('run `cmd` now');
  });

  it('inserts a placeholder when nothing is selected', () => {
    const r = applyMdFormat('', 0, 0, 'bold');
    expect(r.text).toBe('**bold text**');
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('bold text');
  });

  it('numbers each selected line for ol; dashes for ul', () => {
    const src = 'first\nsecond\nthird';
    const ol = applyMdFormat(src, 0, src.length, 'ol');
    expect(ol.text).toBe('1. first\n2. second\n3. third');
    const ul = applyMdFormat(src, 0, src.length, 'ul');
    expect(ul.text).toBe('- first\n- second\n- third');
  });

  it('expands list formatting to whole lines around a partial selection', () => {
    const src = 'aaa\nbbb\nccc';
    const r = applyMdFormat(src, 5, 6, 'ol'); // inside "bbb"
    expect(r.text).toBe('aaa\n1. bbb\nccc');
  });

  it('inserts a table template on its own line', () => {
    const r = applyMdFormat('before', 6, 6, 'table');
    expect(r.text).toContain('before\n| Header 1 | Header 2 |');
    expect(r.text).toContain('| --- | --- |');
  });

  it('link wraps the selection as the label and selects the url', () => {
    const r = applyMdFormat('see docs here', 4, 8, 'link');
    expect(r.text).toBe('see [docs](https://) here');
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('https://');
  });
});
