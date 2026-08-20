import { describe, expect, it } from 'vitest';
import { base64Utf8 } from '../src/base64.js';

describe('base64Utf8', () => {
  it('matches Node Buffer output for ASCII credentials', () => {
    const value = 'haim@hp.com:APIKEY123';
    expect(base64Utf8(value)).toBe(Buffer.from(value, 'utf8').toString('base64'));
  });

  it('matches Node Buffer output for non-ASCII, where plain btoa would throw', () => {
    const value = 'tëst@hp.com:ké£y';
    expect(base64Utf8(value)).toBe(Buffer.from(value, 'utf8').toString('base64'));
  });

  it('handles an empty string', () => {
    expect(base64Utf8('')).toBe('');
  });
});
