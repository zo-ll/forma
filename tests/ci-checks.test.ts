import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {resolve, join} from 'node:path';
import ts from 'typescript';

const {validateSource, validateMobileSources, checkSourceBoundaries} = await import(pathToFileURL(resolve('scripts/check-boundaries.mjs')).href) as {
  validateSource(text: string, path: string, owner: string, coreRoot?: string): number;
  validateMobileSources(sources: unknown): Record<string, boolean>;
  checkSourceBoundaries(root?: string): number;
};
const {validateAudit} = await import(pathToFileURL(resolve('scripts/check-dependencies.mjs')).href) as {
  validateAudit(report: unknown, baseline: unknown, lock: unknown, today?: string): number;
};
const core = resolve('packages/core/src');
const graph = ['/node_modules/@op-engineering/op-sqlite/index.js', '/packages/mobile-host/dist/host.js',
  '/apps/mobile/src/native/NativeFormaDevice.ts', '/apps/mobile/src/gate.ts'];

test('the Android client explicitly enables the FTS5 option required by the notes migration', () => {
  const app = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8')) as {'op-sqlite'?: {fts5?: boolean}};
  assert.equal(app['op-sqlite']?.fts5, true);
});

test('core accepts only imports inside its own source owner', () => {
  assert.equal(validateSource("import type {X} from './types.js'; export {x} from './lib.js'", join(core, 'index.ts'), 'core'), 2);
  for (const text of [
    "import fs from 'node:fs'", "export {Platform} from 'react-native'", "import '@forma/adapters/sqlite'",
    "import x from '../../adapters/src/android/index.js'", "const x = require('fs')",
    "const x = import('react-native')", "type X = import('node:os').Platform", "import x = require('node:path')",
    'const x = import(moduleName)', "import x from '.external-package'",
  ]) assert.throws(() => validateSource(text, join(core, 'bad.ts'), 'core'));
});

test('mobile and shared runtime sources reject Node and Node adapter access', () => {
  for (const specifier of ['node:crypto', 'fs/promises', '@forma/adapters/node', '@forma/adapters/node/sqlite']) {
    assert.throws(() => validateSource(`import x from '${specifier}'`, resolve('apps/mobile/src/bad.ts'), 'mobile'));
  }
  assert.doesNotThrow(() => validateSource("import x from '@forma/adapters/android'; import y from 'react-native'", resolve('apps/mobile/src/root.ts'), 'mobile'));
});

test('actual mobile source maps reject Node paths and the build-only advisory', () => {
  assert.equal(Object.values(validateMobileSources(graph)).every(Boolean), true);
  for (const path of ['node:fs', 'fs', '/x/node:crypto', '/node/internal/fs.js', '/packages/adapters/dist/node/sqlite.js',
    '/node_modules/@forma/adapters/node/index.js', '/node_modules/fs/index.js', 'C:\\packages\\adapters\\src\\node\\index.ts',
    '/node_modules/braces/index.js']) assert.throws(() => validateMobileSources([...graph, path]));
  for (const invalid of [null, {}, [], [4], graph.slice(1)]) assert.throws(() => validateMobileSources(invalid));
});

test('a real source-tree violation makes the checker process fail', () => {
  const base = mkdtempSync(join(tmpdir(), 'forma-boundary-negative-'));
  try {
    for (const dir of ['packages/core/src', 'packages/mobile-host/src', 'packages/adapters/src/android',
      'packages/adapters/src/sqlite', 'apps/mobile/src']) mkdirSync(join(base, dir), {recursive: true});
    for (const file of ['apps/mobile/App.tsx', 'apps/mobile/index.js']) writeFileSync(join(base, file), 'export {};');
    writeFileSync(join(base, 'packages/core/src/bad.ts'), "import fs from 'node:fs';");
    const command = `import {checkSourceBoundaries} from ${JSON.stringify(pathToFileURL(resolve('scripts/check-boundaries.mjs')).href)};checkSourceBoundaries(${JSON.stringify(base)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', command], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core import escapes its owner/);
    writeFileSync(join(base, 'packages/core/src/bad.ts'), "export {}; // node:fs in a comment is not an import");
    assert.equal(checkSourceBoundaries(base), 3);
    writeFileSync(join(base, 'apps/mobile/src/bad.ts'), "import {open} from '@forma/adapters/node';");
    assert.throws(() => checkSourceBoundaries(base), /Node import reached mobile/);
  } finally {rmSync(base, {recursive: true, force: true});}
});

test('mobile metadata imports retain types before the build runner creates its JSON file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-build-metadata-'));
  try {
    const source = join(directory, 'consumer.ts');
    const declaration = join(directory, 'build-metadata.d.ts');
    const input = "import metadata from './mobile-build.json'; const head: string = metadata.sourceHead;";
    writeFileSync(source, input);
    writeFileSync(declaration, readFileSync('apps/mobile/src/build-metadata.d.ts', 'utf8'));
    const options: ts.CompilerOptions = {strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true};
    const diagnostics = (files: string[]) => ts.getPreEmitDiagnostics(ts.createProgram(files, options));
    assert.ok(diagnostics([source]).some(d => d.code === 2307), 'The fixture must have no generated metadata.');
    assert.deepEqual(diagnostics([source, declaration]), []);
    writeFileSync(source, input + ' const wrong: number = metadata.sourceHead;');
    assert.ok(diagnostics([source, declaration]).some(d => d.code === 2322), 'The declaration must not erase metadata types.');
  } finally {rmSync(directory, {recursive: true, force: true});}
});

const baseline = JSON.parse(readFileSync('scripts/dependency-audit-baseline.json', 'utf8')) as {
  mobile: {expires: string; findings: Array<{name: string; severity: string; nodes: Array<{path: string; version: string}>; via: unknown[]}>};
};
const lock = JSON.parse(readFileSync('apps/mobile/package-lock.json', 'utf8'));
const accepted = baseline.mobile.findings[0]!;
const report = {vulnerabilities: {[accepted.name]: {severity: accepted.severity, nodes: accepted.nodes.map(x => x.path), via: accepted.via}},
  metadata: {vulnerabilities: {total: 1}}};
const date = '2026-10-13';

test('audit accepts only the exact dated known build-tool risk', () => {
  assert.equal(validateAudit(report, baseline.mobile, lock, date), 1);
  assert.equal(validateAudit({vulnerabilities: {}, metadata: {vulnerabilities: {total: 0}}}, {findings: []}, lock, date), 0);
  assert.throws(() => validateAudit(report, baseline.mobile, lock, '2026-11-14'), /expired/);
});

test('audit fails new risks, severity, versions, paths, and propagated causes', () => {
  for (const patch of [
    {severity: 'critical'}, {severity: 'moderate'}, {nodes: ['node_modules/new-package']},
    {via: ['different-parent']}, {via: [{name: 'new-package', url: 'https://github.com/advisories/new', severity: 'high', range: '*'}]},
  ]) assert.throws(() => validateAudit({...report, vulnerabilities: {[accepted.name]: {...report.vulnerabilities[accepted.name], ...patch}}}, baseline.mobile, lock, date));
  const changedLock = structuredClone(lock);
  changedLock.packages[accepted.nodes[0]!.path].version = '999.0.0';
  assert.throws(() => validateAudit(report, baseline.mobile, changedLock, date), /Unapproved/);
  assert.throws(() => validateAudit({...report, vulnerabilities: {'new-package': report.vulnerabilities[accepted.name]}}, baseline.mobile, lock, date), /Unapproved/);
});

test('audit never treats a network error or incomplete report as a pass', () => {
  for (const value of [null, {}, {error: {code: 'ENOAUDIT'}}, {...report, error: {code: 'network'}},
    {...report, metadata: {vulnerabilities: {total: 0}}}, {...report, vulnerabilities: []},
    {...report, vulnerabilities: {[accepted.name]: {}}}]) assert.throws(() => validateAudit(value, baseline.mobile, lock, date));
});
