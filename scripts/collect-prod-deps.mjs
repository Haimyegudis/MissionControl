#!/usr/bin/env node
// Collects the PRODUCTION dependency closure of the server workspace into a
// destination node_modules directory (for the offline installer payload).
//
// npm workspaces hoist packages to the repo-root node_modules, so we resolve
// each dependency name against server/node_modules first, then the root
// node_modules, and walk the transitive closure via each package.json's
// "dependencies" + "optionalDependencies" fields. Nested node_modules inside a
// package (version-conflict shadowing) are copied along with the package.
//
// Junk / secret exclusions are applied while copying:
//   - native build intermediates (build/* except *.node, obj/, deps/)
//   - docs/tests/benchmarks/.bin/.github, *.md, *.map
//   - HARD-DENY (never copied, even if a package ships one): .env*,
//     config.json, credentials*, *.db, *.sqlite*, *.pem, *.key, *.pfx
//
// Usage: node scripts/collect-prod-deps.mjs <repoRoot> <destNodeModules>

import fs from 'node:fs';
import path from 'node:path';

const [, , repoRootArg, destArg] = process.argv;
if (!repoRootArg || !destArg) {
  console.error('usage: node collect-prod-deps.mjs <repoRoot> <destNodeModules>');
  process.exit(2);
}
const repoRoot = path.resolve(repoRootArg);
const destRoot = path.resolve(destArg);

const EXCLUDED_DIRS = new Set([
  '.bin', '.github', 'deps', 'obj', 'docs', 'doc', 'test', 'tests',
  '__tests__', 'benchmark', 'benchmarks', 'example', 'examples', 'coverage',
]);
const EXCLUDED_FILE_RE = /\.(pdb|iobj|ipdb|exp|lib|obj|tlog|log|md|markdown|map|gyp|gypi)$/i;
const FORBIDDEN_FILE_RE = /^(\.env(\..+)?|config\.json|credentials.*)$|\.(db|sqlite|sqlite3|pem|key|pfx)$/i;

const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'server', 'package.json'), 'utf8'),
);
const searchDirs = [
  path.join(repoRoot, 'server', 'node_modules'),
  path.join(repoRoot, 'node_modules'),
];

function findPkgDir(name) {
  for (const dir of searchDirs) {
    const candidate = path.join(dir, ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

// ---- resolve transitive closure ------------------------------------------
const queue = Object.keys(serverPkg.dependencies ?? {});
const resolved = new Map(); // name -> source dir
const missingOptional = [];

while (queue.length > 0) {
  const name = queue.shift();
  if (resolved.has(name)) continue;
  const dir = findPkgDir(name);
  if (!dir) {
    console.error(`FATAL: production dependency "${name}" not found in node_modules.`);
    process.exit(1);
  }
  resolved.set(name, dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!resolved.has(dep)) queue.push(dep);
  }
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
    if (resolved.has(dep)) continue;
    if (findPkgDir(dep)) queue.push(dep);
    else missingOptional.push(`${name} -> ${dep}`);
  }
}

// ---- copy with pruning ----------------------------------------------------
let filesCopied = 0;
let bytesCopied = 0;
let denied = 0;

function copyDir(src, dst, inBuild) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
      copyDir(s, d, inBuild || entry.name.toLowerCase() === 'build');
      continue;
    }
    if (FORBIDDEN_FILE_RE.test(entry.name)) {
      denied += 1;
      console.log(`  DENY (forbidden name): ${s}`);
      continue;
    }
    if (EXCLUDED_FILE_RE.test(entry.name)) continue;
    // inside a native build tree keep only the compiled addon binaries
    if (inBuild && !entry.name.toLowerCase().endsWith('.node')) continue;
    fs.copyFileSync(s, d);
    filesCopied += 1;
    bytesCopied += fs.statSync(d).size;
  }
}

for (const [name, dir] of [...resolved.entries()].sort()) {
  const dst = path.join(destRoot, ...name.split('/'));
  copyDir(dir, dst, false);
}

// ---- sanity: the better-sqlite3 native addon must have shipped -----------
if (resolved.has('better-sqlite3')) {
  const addon = path.join(destRoot, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(addon)) {
    console.error(`FATAL: native addon missing from payload: ${addon}`);
    process.exit(1);
  }
  console.log(`native addon OK: ${addon} (${fs.statSync(addon).size} bytes)`);
}

for (const miss of missingOptional) console.log(`  note: optional dep not installed, skipped: ${miss}`);
console.log(
  `collect-prod-deps: ${resolved.size} packages, ${filesCopied} files, ` +
  `${(bytesCopied / 1024 / 1024).toFixed(1)} MB, ${denied} forbidden files denied -> ${destRoot}`,
);
