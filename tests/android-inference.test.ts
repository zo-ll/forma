import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createFormaService, createInferenceCancellation } from '@forma/core';
import type { InferenceRuntime } from '@forma/core';
import { ANDROID_EMBEDDING_PROFILE as ep, ANDROID_GENERATION_PROFILE as gp, createAndroidInferenceRuntime } from '@forma/adapters/android';
import type { AndroidInferenceBinding } from '@forma/adapters/android';
import { MODEL_ARTIFACTS } from '@forma/mobile-host';
import { MemoryWorkoutStore, TEST_TIME, errorCode } from './helpers.js';
const clone = <T>(value: T): T => structuredClone(value);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function response(kind = 'embedding'): Record<string, unknown> {
  const p = kind === 'embedding' ? ep : gp;
  return { kind, artifactId: p.artifact.id, sha256: p.artifact.sha256, runtimeVersion: p.runtime.version,
    backend: p.runtime.backend, runtimePrecision: 'float32',
    ...(kind === 'embedding' ? { task: 'query', vector: [1, ...Array<number>(255).fill(0)] } : { text: 'Synthetic output' }) };
}
function fixture(options: { embedding?: boolean; generation?: boolean } = { embedding: true, generation: true }) {
  const calls: unknown[][] = [];
  const native: AndroidInferenceBinding = {
    async openInference(owner) { calls.push(['open', owner]); },
    async runInference(owner, seq, request) {
      const dto = JSON.parse(request) as { kind: string; task?: string };
      calls.push(['run', owner, seq, dto]);
      return JSON.stringify({ ...response(dto.kind), ...(dto.task ? { task: dto.task } : {}) });
    },
    async cancelInference(owner, seq) { calls.push(['cancel', owner, seq]); return true; },
    async closeInference(owner) { calls.push(['close', owner]); },
  };
  const runtime = createAndroidInferenceRuntime({ native, nextId: () => 'owner-1', ...options });
  let id = 0;
  const service = createFormaService({ inference: runtime, store: new MemoryWorkoutStore(),
    clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'native-' + ++id } });
  return { native, runtime, service, calls };
}
const query = { text: 'Synthetic query', task: 'query' } as const;
const direct = { text: ep.queryPrefix + query.text, task: 'query', profile: ep } as const;
async function generate(f: ReturnType<typeof fixture>) {
  const note = await f.service.notes.create({ requestId: 'saved-note', date: '2026-10-14', text: 'Synthetic saved note' });
  return f.service.inference.generateNote({ source: note.source, instruction: 'Summarize', maxOutputCharacters: 64 });
}
for (const flags of [{}, { embedding: true }, { generation: true }, { embedding: true, generation: true }]) {
  test('Android composition is explicit: ' + JSON.stringify(flags), async () => {
    const f = fixture(flags);
    assert.deepEqual(f.calls, []);
    assert.equal(f.service.inference.capabilities().embedding.state, flags.embedding ? 'ready' : 'missing');
    assert.equal(f.service.inference.capabilities().generation.state, flags.generation ? 'ready' : 'missing');
    if (flags.embedding) assert.equal((await f.service.inference.embed(query)).vector.length, 256);
    else await assert.rejects(f.service.inference.embed(query), errorCode('INFERENCE_UNAVAILABLE'));
    if (flags.generation) assert.equal((await generate(f)).text, 'Synthetic output');
    else await assert.rejects(generate(f), errorCode('INFERENCE_UNAVAILABLE'));
    await f.service.close();
    assert.equal(f.calls.filter(c => c[0] === 'open').length, flags.embedding || flags.generation ? 1 : 0);
    assert.equal(f.calls.filter(c => c[0] === 'close').length, flags.embedding || flags.generation ? 1 : 0);
  });
}
test('the SDK dependency and native response version match the portable profiles', () => {
  const gradle = readFileSync('apps/mobile/android/app/build.gradle', 'utf8');
  const native = readFileSync('apps/mobile/android/app/src/main/java/dev/forma/mobile/InferenceJson.kt', 'utf8');
  const dependency = gradle.match(/implementation\("com\.google\.ai\.edge\.litertlm:litertlm-android:([^"]+)"\)/)?.[1];
  const metadata = native.match(/\.put\("runtimeVersion", "([^"]+)"\)/)?.[1];
  assert.equal(dependency, ep.runtime.version);
  assert.equal(metadata, dependency);
  assert.equal(gp.runtime.version, dependency);
});
test('profiles agree with the import catalog and contain no effective delegate claim', () => {
  for (const p of [ep, gp]) {
    const a = MODEL_ARTIFACTS.find(a => a.id === p.artifact.id)!;
    assert.equal(p.artifact.sha256, a.sha256);
    assert.equal(p.runtime.backend, a.backend);
    assert.equal(p.runtime.version, '0.18.0');
    assert.deepEqual(Object.keys(p.runtime).sort(), ['backend', 'id', 'version']);
    assert.equal(p.runtimePrecision, 'float32');
  }
});
test('the core adds each task prefix exactly once; the adapter passes text without another prefix', async () => {
  const f = fixture();
  await f.service.inference.embed(query);
  await f.service.inference.embed({ text: 'Synthetic document', task: 'document' });
  assert.deepEqual(f.calls.filter(c => c[0] === 'run').map(c => c[3]), [
    { kind: 'embedding', task: 'query', text: ep.queryPrefix + query.text },
    { kind: 'embedding', task: 'document', text: ep.documentPrefix + 'Synthetic document' },
  ]);
  await f.service.close();
});
test('profile DTOs are detached and a substituted configuration cannot reach native', async () => {
  const f = fixture();
  const caps = f.runtime.capabilities();
  if (caps.embedding.state !== 'ready') assert.fail();
  (caps.embedding.profile.runtime as { backend: string }).backend = 'gpu';
  assert.equal(f.runtime.capabilities().embedding.profile?.runtime.backend, 'cpu');
  await assert.rejects(f.runtime.embed!({ ...direct, profile: { ...clone(ep), dimensions: 128 } }, createInferenceCancellation().token));
  await assert.rejects(f.runtime.generate!({ text: 'Synthetic', instruction: 'Summarize', maxOutputCharacters: 64,
    profile: { ...clone(gp), runtimePrecision: 'bf16' } }, createInferenceCancellation().token));
  assert.deepEqual(f.calls, []);
  await f.service.close();
});
for (const [name, mutate] of [
  ['artifact', (v: Record<string, unknown>) => { v.artifactId = 'other'; }],
  ['hash', v => { v.sha256 = '0'.repeat(64); }], ['backend', v => { v.backend = 'gpu'; }],
  ['version', v => { v.runtimeVersion = 'unversioned'; }], ['precision', v => { v.runtimePrecision = 'float16'; }],
  ['delegate', v => { v.effectiveDelegate = 'gpu'; }], ['task', v => { v.task = 'document'; }],
  ['dimensions', v => { v.vector = [1, 0]; }], ['zero', v => { v.vector = Array<number>(256).fill(0); }],
  ['norm', v => { v.vector = [2, ...Array<number>(255).fill(0)]; }],
  ['float64', v => { v.vector = [1 / 3, ...Array<number>(255).fill(0)]; }],
  ['nonfinite', v => { v.vector = [Infinity, ...Array<number>(255).fill(0)]; }],
] satisfies [string, (value: Record<string, unknown>) => void][]) {
  test('native DTO rejects ' + name, async () => {
    const f = fixture();
    f.native.runInference = async () => { const v = response(); mutate(v); return JSON.stringify(v); };
    await assert.rejects(f.service.inference.embed(query), errorCode('INFERENCE_FAILURE'));
    assert.equal(f.service.inference.capabilities().embedding.state, 'failed');
    assert.equal((await f.service.notes.create({ requestId: 'primary', date: '2026-10-14', text: 'Still independent' })).text, 'Still independent');
    await f.service.close();
  });
}
for (const serialized of ['null', '{}', 'not JSON', '"' + 'x'.repeat(32769) + '"']) {
  test('malformed native JSON does not escape as an SDK error', async () => {
    const f = fixture();
    f.native.runInference = async () => serialized;
    await assert.rejects(f.service.inference.embed(query), errorCode('INFERENCE_FAILURE'));
    await f.service.close();
  });
}
test('a native failure never falls back to another backend', async () => {
  const f = fixture();
  let count = 0;
  f.native.runInference = async () => { count++; throw new Error('private SDK error /private/model/path'); };
  await assert.rejects(generate(f), e => {
    assert.ok(errorCode('INFERENCE_FAILURE')(e));
    assert.ok(e instanceof Error && !e.message.includes('private'));
    return true;
  });
  await assert.rejects(generate(f), errorCode('INFERENCE_UNAVAILABLE'));
  assert.equal(count, 1);
  await f.service.close();
});
test('cancellation does not release the unsafe native slot; primary records remain independent', async () => {
  const f = fixture();
  const entered = deferred<void>(), finish = deferred<string>();
  f.native.runInference = async () => { entered.resolve(); return finish.promise; };
  const signal = createInferenceCancellation();
  const work = f.service.inference.embed(query, signal.token);
  await entered.promise;
  signal.cancel();
  await assert.rejects(work, errorCode('CANCELLED'));
  const note = await f.service.notes.create({ requestId: 'while-native', date: '2026-10-14', text: 'No inference dependency' });
  assert.equal(note.text, 'No inference dependency');
  await assert.rejects(f.runtime.embed!(direct, createInferenceCancellation().token), errorCode('CONFLICT'));
  let done = false;
  const close = f.service.close().then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(f.calls.some(c => c[0] === 'close'), false);
  finish.resolve(JSON.stringify(response()));
  await close;
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 1);
});
test('an already-cancelled token never opens native', async () => {
  const f = fixture();
  const signal = createInferenceCancellation(); signal.cancel();
  await assert.rejects(f.runtime.embed!(direct, signal.token), errorCode('CANCELLED'));
  await f.service.close();
  assert.deepEqual(f.calls, []);
});
test('close during native open waits for ownership and releases it without a model call', async () => {
  const f = fixture();
  const entered = deferred<void>(), opened = deferred<void>();
  f.native.openInference = async () => { entered.resolve(); await opened.promise; };
  const work = f.runtime.embed!(direct, createInferenceCancellation().token);
  await entered.promise;
  const close = f.runtime.close();
  opened.resolve();
  await assert.rejects(work, errorCode('CANCELLED'));
  await close;
  assert.deepEqual(f.calls, [['close', 'owner-1']]);
  await f.service.close();
});
test('one native binding has one owner, including after a failed close', async () => {
  const f = fixture();
  const again = () => createAndroidInferenceRuntime({ native: f.native, nextId: () => 'owner-2', embedding: true });
  assert.throws(again, errorCode('CONFLICT'));
  await f.service.inference.embed(query);
  f.native.closeInference = async () => { throw new Error('close failed'); };
  const close = f.runtime.close();
  assert.equal(close, f.runtime.close());
  await assert.rejects(close, errorCode('INFERENCE_FAILURE'));
  assert.throws(again, errorCode('CONFLICT'));
  await assert.rejects(f.service.close(), errorCode('INFERENCE_FAILURE'));
});
test('successful close permits another adapter owner and does not call native twice', async () => {
  const f = fixture();
  await f.service.inference.embed(query);
  await Promise.all([f.runtime.close(), f.runtime.close()]);
  const second: InferenceRuntime = createAndroidInferenceRuntime({ native: f.native, nextId: () => 'owner-2' });
  await second.close();
  await f.service.close();
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 1);
});
