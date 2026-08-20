// core must run inside a WebView: no Node built-ins anywhere in src.
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

describe('core has no Node built-in imports', () => {
  it('finds no node: specifier in core/src', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const srcDir = path.resolve(here, '../src');
    const offenders = walk(srcDir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /from 'node:/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});
