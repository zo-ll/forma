import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as core from '@forma/core';
import * as mobileHost from '@forma/mobile-host';
import type { MobileHost } from '@forma/mobile-host';
import { openNodeForma } from '@forma/adapters/node';
import { TEST_TIME } from './helpers.js';

/** Run the actual Forma gate JavaScript with local Node bindings, never a device. */
test('actual Forma hostgate notes/FTS/archive and restart fixtures have exact counts in the Node shim', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-hostgate-notes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  let host: MobileHost; let preferences: string | null = null; let marker: string | null = null; let next = 0;
  const listeners = new Set<(state: string) => void>();
  const counts = JSON.parse(readFileSync('apps/mobile/host-gate-counts.json', 'utf8'));
  const results: any[] = [];
  const storage = { read: () => preferences, write: (value: string) => { preferences = value; } };
  const platform = { nowUtc: () => TEST_TIME, timeZone: () => 'UTC' };
  const compiled = ts.transpileModule(readFileSync('apps/mobile/src/gate.ts', 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const modules: Record<string, unknown> = {
    'react-native': { AppState: { addEventListener: (_: string, listener: (state: string) => void) => {
      listeners.add(listener); return { remove: () => listeners.delete(listener) };
    } } },
    '@forma/core': core, '@forma/mobile-host': mobileHost,
    './adapters/device': { deviceAdapters: {
      platform, preferences: storage, isHostGate: () => true,
      ids: { next: () => '00000000-0000-4000-8000-' + String(++next).padStart(12, '0') },
      gateSnapshots: { read: () => marker, write: (value: string) => { marker = value; return true; } },
    } },
    './root': { mobileRoot: () => host }, '../mobile-build.json': { fixtureCount: counts.fixtures },
    '../host-gate-counts.json': counts,
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, { exports, setTimeout, clearTimeout, console: { info: (message: string) => {
    if (message.startsWith('FORMA_HOST_READY ')) {
      host.background(); listeners.forEach(listener => listener('background')); listeners.forEach(listener => listener('active'));
    }
    if (message.startsWith('FORMA_HOST_RESULT ')) results.push(JSON.parse(message.slice('FORMA_HOST_RESULT '.length)));
  } }, require: (name: string) => { assert(Object.hasOwn(modules, name), name); return modules[name]; } });
  const run = exports.runHostGate as (owner: MobileHost, mode: string, runId: string) => Promise<void>;
  for (const mode of ['fixtures', 'seed', 'verify']) {
    host = mobileHost.createMobileHost({ preferences: storage, platform,
      openService: () => openNodeForma({ databasePath: path, clock: platform }) });
    try { await run(host, mode, mode === 'fixtures' ? 'fixture-run' : 'restart-run'); }
    finally { await host.close(); }
    const result = results.at(-1);
    assert.equal(result.ok, true, result.message + '\n' + result.stack);
    assert.equal(result.count, counts[mode]);
  }
  assert.equal(results.length, 3);
  assert.deepEqual(results.map(value => value.count), [22, 8, 13]);
});
