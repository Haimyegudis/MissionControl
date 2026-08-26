// fetch()'s text() always decodes UTF-8 regardless of the response's declared
// charset. TestRail DC serves Windows-1252 bytes for CSV-imported text
// (bullets, curly quotes, dashes), which surfaced as U+FFFD in cached case
// titles and steps. decodeResponseText() honors the declared charset and
// falls back to Windows-1252 when a UTF-8 decode still mangles bytes.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { decodeResponseText, TestRailHttp } from '../src/testrail/httpClient.js';

describe('decodeResponseText', () => {
  it('decodes UTF-8 bytes with no charset header as UTF-8', () => {
    // "–" (en dash) encoded as UTF-8 bytes 0xE2 0x80 0x93.
    const buf = new Uint8Array([0x61, 0xe2, 0x80, 0x93, 0x62]).buffer; // "a–b"
    expect(decodeResponseText(buf, null)).toBe('a–b');
  });

  it('falls back to windows-1252 when a utf-8 charset header lies', () => {
    // 0x95 bullet, 0x93/0x94 curly quotes, 0x96 dash — cp1252, not UTF-8.
    const buf = new Uint8Array([0x95, 0x20, 0x93, 0x61, 0x94, 0x20, 0x96]).buffer;
    const text = decodeResponseText(buf, 'application/json; charset=utf-8');
    expect(text).toBe('• “a” –');
    expect(text).not.toContain('�');
  });

  it('honors an explicit iso-8859-1 charset header', () => {
    const buf = new Uint8Array([0xe9]).buffer; // é in Latin-1
    expect(decodeResponseText(buf, 'text/plain; charset=iso-8859-1')).toBe('é');
  });

  it('returns empty string for an empty buffer', () => {
    expect(decodeResponseText(new ArrayBuffer(0), null)).toBe('');
  });
});

describe('TestRailHttp charset handling (integration)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodes a windows-1252 body served with a utf-8 content-type header', async () => {
    // {"title":"a \x96 b"} with 0x96 as a raw cp1252 dash byte, not UTF-8.
    const json = '{"title":"a \x96 b"}';
    const bytes = new Uint8Array(json.length);
    for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);

    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const http = new TestRailHttp({
      baseUrl: 'https://hp-testrail.external.hp.com',
      email: 'a@hp.com',
      apiKey: 'key',
    });
    const result = await http.getJson('get_case/1');

    expect(result.title).toBe('a – b');
  });
});
