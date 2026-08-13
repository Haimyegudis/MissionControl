import { describe, expect, it } from 'vitest';
import { segmentSummary, tokenizeInline } from '../src/lib/lumoMarkdown';

describe('lumo mini-markdown', () => {
  it('splits text and pipe tables', () => {
    const s = segmentSummary('Intro line\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\nOutro');
    expect(s).toHaveLength(3);
    expect(s[0]).toEqual({ kind: 'text', text: 'Intro line' });
    expect(s[1]).toEqual({ kind: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] });
    expect(s[2]).toEqual({ kind: 'text', text: 'Outro' });
  });

  it('handles bordered tables without a separator row', () => {
    const s = segmentSummary('| Feature | Status |\n| ISW-1 — X | Done |');
    expect(s).toEqual([{ kind: 'table', headers: ['Feature', 'Status'], rows: [['ISW-1 — X', 'Done']] }]);
  });

  it('normalizes stray cell counts to header width', () => {
    const s = segmentSummary('| A | B |\n| 1 | 2 | extra |\n| only |');
    expect(s[0]).toEqual({
      kind: 'table',
      headers: ['A', 'B'],
      rows: [['1', '2 | extra'], ['only', '']],
    });
  });

  it('single pipe line stays text', () => {
    const s = segmentSummary('just one | line here');
    expect(s).toEqual([{ kind: 'text', text: 'just one | line here' }]);
  });

  it('empty input yields no segments', () => {
    expect(segmentSummary('')).toEqual([]);
    expect(segmentSummary(null)).toEqual([]);
  });

  it('tokenizes bold, code and links', () => {
    const t = tokenizeInline('see **HW table** and `IPRG-1` at [docs](https://x.y/z) end');
    expect(t).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'bold', text: 'HW table' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'IPRG-1' },
      { kind: 'text', text: ' at ' },
      { kind: 'link', text: 'docs', url: 'https://x.y/z' },
      { kind: 'text', text: ' end' },
    ]);
  });
});
