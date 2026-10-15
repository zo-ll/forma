import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const url = pathToFileURL(resolve('scripts/mobile-host-protocol.mjs')).href;
const {validateHostResult, validateRestart, validateSqliteBuildOptions} = await import(url) as {
  validateSqliteBuildOptions: (library: unknown) => {fts5: true};
  validateHostResult: (value: unknown, metadata: object, mode: string, runId: string, count: number) => void;
  validateRestart: (seed: unknown, verify: unknown) => void;
};
test('the APK build rejects a SQLite library without the required FTS5 compile option', () => {
  assert.deepEqual(validateSqliteBuildOptions('binary\0ENABLE_FTS5\0other'), {fts5: true});
  for (const value of [undefined, null, {}, '', 'ENABLE_FTS5', 'ENABLE_FTS50\0', 'ENABLE_JSON1\0']) {
    assert.throws(() => validateSqliteBuildOptions(value), /ENABLE_FTS5/);
  }
});

const metadata = {sourceHead: 'head', sourceDigest: 'digest', dirty: false, fixtureCount: 12, reactNative: '0.87.1', opSqlite: '18.2.5'};
const valid = {...metadata, mode: 'fixtures', runId: 'run', ok: true, count: 12};
test('mobile host results require exact source, runtime, mode, identity and count', () => {
  assert.doesNotThrow(() => validateHostResult(valid, metadata, 'fixtures', 'run', 12));
  for (const change of [
    {ok: false}, {ok: 1}, {sourceHead: 'other'}, {sourceDigest: 'other'}, {dirty: true},
    {mode: 'verify'}, {runId: 'old'}, {count: 11}, {count: 13}, {count: '12'},
    {fixtureCount: 39}, {reactNative: 'other'}, {opSqlite: 'other'},
  ]) assert.throws(() => validateHostResult({...valid, ...change}, metadata, 'fixtures', 'run', 12));
  for (const value of [null, undefined, {}, []]) assert.throws(() => validateHostResult(value, metadata, 'fixtures', 'run', 12));
});
test('seed and verify modes also require all expected assertions', () => {
  for (const [mode, count] of [['seed', 6], ['verify', 8]] as const) {
    assert.doesNotThrow(() => validateHostResult({...valid, mode, count}, metadata, mode, 'run', count));
    assert.throws(() => validateHostResult({...valid, mode, count: 1}, metadata, mode, 'run', count));
  }
});
test('restart verification rejects missing, malformed or reused process IDs', () => {
  assert.doesNotThrow(() => validateRestart('123', '124'));
  for (const pair of [[undefined, '124'], ['123', null], ['123', '123'], ['', '124'], ['123', '1 2'], [123, 124]]) {
    assert.throws(() => validateRestart(pair[0], pair[1]));
  }
});
