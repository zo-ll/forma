import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as core from '@forma/core';
import * as adapters from '@forma/adapters/android';
import { openNodeForma } from '@forma/adapters/node';
import * as mobile from '@forma/mobile-host';
import { MemoryWorkoutStore, TEST_TIME } from './helpers.js';

function evaluate(path: string, modules: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, any> {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(output, { exports, performance, ...extra,
    require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  return exports;
}
const modes = ['inference-embedding', 'inference-generation', 'inference-sequential'] as const;
for (const isolated of [false, true]) {
  for (const mode of [undefined, 'fixtures', ...modes]) {
    test('native inference requires explicit mode and isolated build: ' + isolated + '/' + mode, () => {
      const calls: unknown[] = [];
      const loaded = evaluate('apps/mobile/src/adapters/inference.ts', {
        '@forma/adapters/android': { createAndroidInferenceRuntime: (options: unknown) => { calls.push(options); return 'runtime'; } },
        '@forma/core': core, '../native/NativeFormaInference': { default: 'binding', __esModule: true },
        './device': { deviceAdapters: { isHostGate: () => isolated, ids: { next: () => 'owner' } } },
      });
      const enabled = isolated && modes.includes(mode as typeof modes[number]);
      assert.equal(loaded.experimentalGateInference(mode), enabled ? 'runtime' : undefined);
      assert.equal(calls.length, enabled ? 1 : 0);
      if (enabled) assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { native: 'binding',
        embedding: mode !== 'inference-generation', generation: mode !== 'inference-embedding' });
    });
  }
}
test('the mobile root preserves default missing models and cannot enable one through a later render', async () => {
  const seen: unknown[] = [];
  let id = 0;
  const service = core.createFormaService({ store: new MemoryWorkoutStore(), clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'root-' + ++id } });
  const loaded = evaluate('apps/mobile/src/root.ts', {
    '@op-engineering/op-sqlite': { open: () => assert.fail('Unexpected database call') },
    '@forma/adapters/android': { openAndroidForma: (options: unknown) => { seen.push(options); return service; } },
    '@forma/mobile-host': mobile, '@forma/core': core,
    './adapters/inference': { experimentalGateInference: (mode: unknown) => { assert.equal(mode, undefined); return undefined; } },
    './adapters/models': { modelFiles: {} }, './archive/flow': {}, './forms/index': {},
    './adapters/device': { deviceAdapters: { clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id' },
      preferences: { read: () => null, write: () => {} }, platform: { nowUtc: () => TEST_TIME, timeZone: () => 'UTC' } } },
  });
  const host = loaded.mobileRoot() as mobile.MobileHost;
  assert.equal(host, loaded.mobileRoot('inference-sequential'));
  await host.start();
  assert.equal(Object.hasOwn(seen[0] as object, 'inference'), false);
  assert.equal(host.service().inference.capabilities().embedding.state, 'missing');
  await host.close();
});
test('an optional native factory failure does not prevent primary service startup', async () => {
  let id = 0;
  const loaded = evaluate('apps/mobile/src/root.ts', {
    '@op-engineering/op-sqlite': { open: () => {} },
    '@forma/adapters/android': { openAndroidForma: () => core.createFormaService({ store: new MemoryWorkoutStore(),
      clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'fallback-' + ++id } }) },
    '@forma/mobile-host': mobile, '@forma/core': core,
    './adapters/inference': { experimentalGateInference: () => { throw new Error('Optional native module unavailable'); } },
    './adapters/models': { modelFiles: {} }, './archive/flow': {}, './forms/index': {},
    './adapters/device': { deviceAdapters: { clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id' },
      preferences: { read: () => null, write: () => {} }, platform: { nowUtc: () => TEST_TIME, timeZone: () => 'UTC' } } },
  });
  const host = loaded.mobileRoot('inference-sequential') as mobile.MobileHost;
  await host.start();
  assert.equal((await host.service().notes.create({ requestId: 'primary', date: '2026-10-14', text: 'Still available' })).text, 'Still available');
  await host.close();
});
for (const mode of modes) {
  test('read-only inference diagnostic uses portable ports without record or receipt changes: ' + mode, async () => {
    const calls: { kind: string; task?: string; text: string }[] = [];
    const runtime = adapters.createAndroidInferenceRuntime({ embedding: mode !== 'inference-generation', generation: mode !== 'inference-embedding',
      nextId: () => 'gate-owner', native: {
        openInference: async () => {}, closeInference: async () => {}, cancelInference: async () => true,
        async runInference(_owner, _seq, serialized) {
          const request = JSON.parse(serialized) as { kind: string; task?: string; text: string };
          calls.push(request);
          await new Promise<void>(resolve => setImmediate(resolve));
          const p = request.kind === 'embedding' ? adapters.ANDROID_EMBEDDING_PROFILE : adapters.ANDROID_GENERATION_PROFILE;
          return JSON.stringify({ kind: request.kind, artifactId: p.artifact.id, sha256: p.artifact.sha256,
            backend: p.runtime.backend, runtimeVersion: '0.18.0', runtimePrecision: 'float32',
            ...(request.kind === 'embedding' ? { task: request.task, vector: [1, ...Array<number>(255).fill(0)] } : { text: 'Private synthetic output' }) });
        },
      } });
    let id = 0;
    // Real Node SQLite/FTS5 plus fake native inference. This does not prove Android execution.
    const service = openNodeForma({ inference: runtime, databasePath: ':memory:',
      clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'gate-' + ++id } });
    await service.notes.create({ requestId: 'operator-created', date: '2026-10-14', text: 'Forma inference synthetic source. Run test-run' });
    const before = (await service.archive.export()).text;
    let after: string | undefined;
    let closed = false;
    const host = { start: async () => {}, service: () => service, close: async () => {
      after = (await service.archive.export()).text; await service.close(); closed = true;
    } };
    const logs: string[] = [];
    const loaded = evaluate('apps/mobile/src/inference-gate.ts', {
      '@forma/core': core, '@forma/adapters/android': adapters,
      './adapters/device': { deviceAdapters: { isHostGate: () => true } }, '../mobile-build.json': { sourceHead: 'synthetic-test' },
    }, { console: { info: (line: string) => { assert.equal(closed, true); logs.push(line); } } });
    await loaded.runInferenceGate(host, mode, 'test-run');
    assert.equal(after, before);
    assert.equal(logs.length, 1);
    const report = JSON.parse(logs[0]!.slice('FORMA_INFERENCE_RESULT '.length)) as { ok: boolean; results: { kind: string }[] };
    assert.equal(report.ok, true, logs[0]);
    assert.deepEqual(report.results.map(r => r.kind), mode === 'inference-embedding' ? ['embedding', 'embedding']
      : mode === 'inference-generation' ? ['generation'] : ['embedding', 'embedding', 'generation', 'embedding']);
    assert.equal(logs[0]!.includes('Private synthetic output'), false);
    assert.equal(logs[0]!.includes('Forma inference synthetic source'), false);
    const embeddingCalls = calls.filter(c => c.kind === 'embedding');
    assert.ok(embeddingCalls.every(c => c.text.startsWith(c.task === 'query' ? adapters.ANDROID_EMBEDDING_PROFILE.queryPrefix : adapters.ANDROID_EMBEDDING_PROFILE.documentPrefix)));
  });
}
test('a diagnostic call outside the isolated build never touches or closes the primary service', async () => {
  const loaded = evaluate('apps/mobile/src/inference-gate.ts', {
    '@forma/core': core, '@forma/adapters/android': adapters, './adapters/device': { deviceAdapters: { isHostGate: () => false } }, '../mobile-build.json': {},
  });
  const unexpected = () => assert.fail('The diagnostic reached a non-isolated service');
  await loaded.runInferenceGate({ start: unexpected, service: unexpected, close: unexpected }, 'inference-embedding', 'test-run');
});
test('a missing synthetic source never causes the diagnostic to create a note', async () => {
  let writes = 0, generated = 0, closed = 0;
  const logs: string[] = [];
  const service = { inference: { capabilities: () => ({ embedding: { state: 'missing' }, generation: { state: 'ready' } }),
    generateNote: async () => {generated++;} }, workouts: { list: async () => [] },
    notes: { searchText: async () => ({ items: [], nextCursor: null }), create: async () => { writes++; } } };
  const loaded = evaluate('apps/mobile/src/inference-gate.ts', {
    '@forma/core': core, '@forma/adapters/android': adapters, './adapters/device': { deviceAdapters: { isHostGate: () => true } }, '../mobile-build.json': {},
  }, { console: { info: (line: string) => logs.push(line) } });
  await loaded.runInferenceGate({ start: async () => {}, service: () => service, close: async () => {closed++;} }, 'inference-generation', 'test-run');
  assert.equal(writes, 0); assert.equal(generated, 0); assert.equal(closed, 1);
  assert.match(logs[0]!, /"ok":false/); assert.match(logs[0]!, /"primaryAfterFailure":true/);
});
