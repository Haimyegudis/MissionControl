// core must run inside an Android WebView. Anything Node-only that reaches it
// throws at runtime, not at build time — Buffer in the TestRail Basic auth
// header shipped exactly that way and failed only on the device.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function sources(): Array<{ rel: string; text: string }> {
  return walk(SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ rel: path.relative(SRC, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
}

/** Strip comments so prose about Buffer does not trip the scan. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('core stays free of Node-only APIs', () => {
  it('imports no node: module', () => {
    const offenders = sources()
      .filter((f) => /from 'node:/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it.each([
    ['Buffer', /\bBuffer\s*\./],
    ['process', /\bprocess\s*\./],
    ['__dirname', /\b__dirname\b/],
    ['__filename', /\b__filename\b/],
    ['require', /\brequire\s*\(/],
    ['setImmediate', /\bsetImmediate\s*\(/],
  ])('does not use the Node global %s', (_name, pattern) => {
    const offenders = sources()
      .filter((f) => pattern.test(code(f.text)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
