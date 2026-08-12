import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/lib/linkify';

describe('tokenize (ui-parity §12.9)', () => {
  it('finds issue keys', () => {
    expect(tokenize('see ISW-123 please')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'key', key: 'ISW-123' },
      { kind: 'text', text: ' please' },
    ]);
  });

  it('lowercase keys are not matched', () => {
    expect(tokenize('isw-123')).toEqual([{ kind: 'text', text: 'isw-123' }]);
  });

  it('numbers URLs 1-based in order of appearance', () => {
    const tokens = tokenize('a https://x.com/1 b http://y.com/2 c');
    expect(tokens).toContainEqual({ kind: 'url', url: 'https://x.com/1', index: 1 });
    expect(tokens).toContainEqual({ kind: 'url', url: 'http://y.com/2', index: 2 });
  });

  it('trims trailing punctuation off URLs and re-emits it as text', () => {
    expect(tokenize('go to https://x.com/a. now')).toEqual([
      { kind: 'text', text: 'go to ' },
      { kind: 'url', url: 'https://x.com/a', index: 1 },
      { kind: 'text', text: '.' },
      { kind: 'text', text: ' now' },
    ]);
    // ')' is excluded by the URL charset itself; ';' stays in trailing text.
    const t2 = tokenize('(https://x.com/b);');
    expect(t2).toContainEqual({ kind: 'url', url: 'https://x.com/b', index: 1 });
    expect(t2.filter((t) => t.kind === 'text').map((t) => (t as { text: string }).text).join('')).toBe('();');
  });

  it('only http/https schemes match', () => {
    expect(tokenize('ftp://x.com/file')).toEqual([{ kind: 'text', text: 'ftp://x.com/file' }]);
  });

  it('mixes keys and urls', () => {
    const tokens = tokenize('ISW-1 fixed via https://jira/browse/ISW-1');
    expect(tokens[0]).toEqual({ kind: 'key', key: 'ISW-1' });
    expect(tokens).toContainEqual({ kind: 'url', url: 'https://jira/browse/ISW-1', index: 1 });
  });

  it('handles empty and null input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  it('key needs at least two leading chars and digits after the dash', () => {
    expect(tokenize('A-1')).toEqual([{ kind: 'text', text: 'A-1' }]);
    expect(tokenize('AB2_X-42')).toContainEqual({ kind: 'key', key: 'AB2_X-42' });
  });
});
