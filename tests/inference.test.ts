import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFormaService, createInferenceCancellation, embeddingProfilesCompatible, INFERENCE_LIMITS,
} from '@forma/core';
import type {
  EmbeddingProfile, GenerationProfile, InferenceCapabilities, InferenceRuntime,
  RuntimeEmbedding, RuntimeGeneration, FormaService, InferenceCancellationToken,
} from '@forma/core';
import { openNodeForma } from '@forma/adapters/node';
import { MemoryWorkoutStore, TEST_TIME, errorCode } from './helpers.js';

const ep: EmbeddingProfile = {
  id: 'synthetic-embedding', artifact: { id: 'not-a-real-model', sha256: '0'.repeat(64) },
  runtime: { id: 'fake', version: '1', backend: 'cpu' }, weightQuantization: 'none', weightPrecision: 'bf16', runtimePrecision: 'float32',
  outputPrecision: 'float32', dimensions: 2, queryPrefix: 'query: ', documentPrefix: 'document: ', normalization: 'l2',
};
const gp: GenerationProfile = { id: 'synthetic-generation', artifact: ep.artifact, runtime: ep.runtime,
  weightQuantization: 'none', weightPrecision: 'bf16', runtimePrecision: 'float32', outputPrecision: 'text' };
const clone = <T>(value: T): T => structuredClone(value);
const missing = { state: 'missing', profile: null } as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fake(mode = 'combined') {
  const calls: string[] = [];
  const runtime: InferenceRuntime = {
    capabilities: () => ({
      embedding: mode === 'generation' || mode === 'missing' ? missing : { state: 'ready', profile: clone(ep) },
      generation: mode === 'embedding' || mode === 'missing' ? missing : { state: 'ready', profile: clone(gp) },
    }),
    embed: async input => { calls.push(input.text); return { profile: clone(ep), task: input.task, vector: [1, 0] }; },
    generate: async input => { calls.push(input.text); return { profile: clone(gp), text: 'Untrusted narrative' }; },
    close: async () => { calls.push('close'); },
  };
  return { runtime, calls };
}
function fixture(runtime?: InferenceRuntime, store = new MemoryWorkoutStore()) {
  let id = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'inference-' + ++id },
    ...(runtime ? { inference: runtime } : {}) });
  return { service, store };
}
async function note(service: FormaService, requestId = 'note') {
  return service.notes.create({ requestId, date: '2026-10-14', text: 'Synthetic note text' });
}
const query = { text: 'Synthetic query', task: 'query' } as const;

for (const mode of ['default', 'missing', 'embedding', 'generation', 'combined']) {
  test('optional composition: ' + mode, async () => {
    const f = fake(mode);
    const { service } = fixture(mode === 'default' ? undefined : f.runtime);
    const n = await note(service);
    const c = service.inference.capabilities();
    assert.equal(c.embedding.state, ['default', 'missing', 'generation'].includes(mode) ? 'missing' : 'ready');
    assert.equal(c.generation.state, ['default', 'missing', 'embedding'].includes(mode) ? 'missing' : 'ready');
    if (c.embedding.state === 'ready') {
      assert.deepEqual((await service.inference.embed(query)).vector, [1, 0]);
      assert.deepEqual((await service.inference.embedNote({ source: n.source })).source, n.source);
      assert.equal(f.calls[0], 'query: Synthetic query');
      assert.equal(f.calls[1], 'document: Synthetic note text');
    } else await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_UNAVAILABLE'));
    if (c.generation.state === 'ready') {
      const result = await service.inference.generateNote({ source: n.source, instruction: 'Summarize', maxOutputCharacters: 64 });
      assert.deepEqual(result.source, n.source);
      assert.equal(result.text, 'Untrusted narrative');
    } else await assert.rejects(service.inference.generateNote({ source: n.source, instruction: 'Summarize', maxOutputCharacters: 64 }), errorCode('INFERENCE_UNAVAILABLE'));
    const workout = await service.workouts.create({ requestId: 'workout', date: '2026-10-14' });
    assert.equal((await service.workouts.get(workout.id)).id, workout.id);
    assert.equal((await service.notes.get(n.id)).revision, 1);
    await service.close();
  });
}

const malformedProfiles: [string, (p: Record<string, unknown>) => void][] = [
  ['zero dimensions', p => { p.dimensions = 0; }], ['fractional dimensions', p => { p.dimensions = 1.5; }],
  ['excess dimensions', p => { p.dimensions = 4097; }], ['NaN dimensions', p => { p.dimensions = NaN; }],
  ['float16 output', p => { p.outputPrecision = 'float16'; }], ['float16 runtime', p => { p.runtimePrecision = 'float16'; }],
  ['INT4 quantization', p => { p.weightQuantization = 'int4'; }],
  ['float16 quantization', p => { p.weightQuantization = 'float16'; }],
  ['misspelled mixed quantization', p => { p.weightQuantization = 'mixed-2-4-8'; }],
  ['INT4 weights', p => { p.weightPrecision = 'int4'; }], ['bad hash', p => { p.artifact = { id: 'fake', sha256: 'unknown' }; }],
  ['backend claim', p => { p.runtime = { ...ep.runtime, backend: 'effective-npu' }; }],
  ['delegate claim', p => { p.runtime = { ...ep.runtime, effectiveDelegate: 'gpu' }; }],
  ['normalization', p => { p.normalization = 'automatic'; }], ['prefix length', p => { p.queryPrefix = 'x'.repeat(513); }],
  ['invalid prefix Unicode', p => { p.documentPrefix = '\ud800'; }], ['blank ID', p => { p.id = ''; }],
];
for (const [label, change] of malformedProfiles) {
  test('malformed configured profile: ' + label, async () => {
    const p = clone(ep) as unknown as Record<string, unknown>;
    change(p);
    const f = fake();
    f.runtime.capabilities = () => ({ embedding: { state: 'ready', profile: p }, generation: missing }) as unknown as InferenceCapabilities;
    const { service } = fixture(f.runtime);
    assert.deepEqual(service.inference.capabilities(), {
      embedding: { state: 'failed', profile: null, reason: 'adapter-failure' },
      generation: { state: 'failed', profile: null, reason: 'adapter-failure' },
    });
    await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_UNAVAILABLE'));
    await note(service);
    await service.close();
  });
}
test('approved quantized profiles parse as ready', async () => {
  const quantizedEmbedding: EmbeddingProfile = { ...clone(ep), weightQuantization: 'int4-per-channel-qat' };
  const quantizedGeneration: GenerationProfile = { ...clone(gp), weightQuantization: 'mixed-2-4-8-bit-qat' };
  for (const declaration of [
    { embedding: { state: 'ready', profile: quantizedEmbedding }, generation: missing },
    { embedding: missing, generation: { state: 'ready', profile: quantizedGeneration } },
  ]) {
    const f = fake();
    f.runtime.capabilities = () => declaration as unknown as InferenceCapabilities;
    const { service } = fixture(f.runtime);
    const c = service.inference.capabilities();
    assert.ok(c.embedding.state === 'ready' || c.generation.state === 'ready');
    await service.close();
  }
});
test('weight quantization is part of exact compatibility', () => {
  const quantized = { ...clone(ep), weightQuantization: 'int4-per-channel-qat' } as EmbeddingProfile;
  assert.equal(embeddingProfilesCompatible(ep, quantized), false);
  assert.equal(embeddingProfilesCompatible(quantized, clone(quantized)), true);
});
for (const declaration of [null, {}, { embedding: missing }, { embedding: { state: 'ready', profile: null }, generation: missing },
  { embedding: { state: 'loading', profile: ep }, generation: missing },
  { embedding: { state: 'failed', profile: ep, reason: 'private failure text' }, generation: missing }]) {
  test('malformed capability declaration: ' + JSON.stringify(declaration)?.slice(0, 50), async () => {
    const f = fake();
    f.runtime.capabilities = () => declaration as InferenceCapabilities;
    const { service } = fixture(f.runtime);
    assert.equal(service.inference.capabilities().embedding.state, 'failed');
    await service.close();
  });
}
test('initial failed declaration and thrown declaration never become ready', async () => {
  for (const thrown of [false, true]) {
    const f = fake();
    f.runtime.capabilities = () => {
      if (thrown) throw new Error('private adapter error');
      return { embedding: { state: 'failed', profile: clone(ep), reason: 'adapter-failure' }, generation: missing };
    };
    const { service } = fixture(f.runtime);
    await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_UNAVAILABLE'));
    f.runtime.capabilities = fake().runtime.capabilities;
    assert.equal(service.inference.capabilities().embedding.state, 'failed');
    await service.close();
  }
});

for (const [key, value] of Object.entries({ id: 'other', artifact: { ...ep.artifact, sha256: '1'.repeat(64) },
  runtime: { ...ep.runtime, version: '2' }, weightPrecision: 'float32', runtimePrecision: 'bf16',
  dimensions: 3, queryPrefix: 'other', documentPrefix: 'other', normalization: 'none' })) {
  test('profile compatibility includes ' + key, () => {
    assert.equal(embeddingProfilesCompatible(ep, { ...clone(ep), [key]: value }), false);
    assert.equal(embeddingProfilesCompatible(ep, clone(ep)), true);
  });
}

for (const bad of [[], [0, 0], [1], [1, 0, 0], [NaN, 0], [Infinity, 0], [1e100, 0], [1e-100, 0], [2, 0], ['1', 0]]) {
  test('independent malformed adapter vector: ' + String(bad), async () => {
    const f = fake();
    f.runtime.embed = async () => ({ profile: clone(ep), task: 'query', vector: bad }) as RuntimeEmbedding;
    const { service } = fixture(f.runtime);
    await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_FAILURE'));
    assert.equal(service.inference.capabilities().embedding.state, 'failed');
    await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_UNAVAILABLE'));
    await note(service);
    await service.close();
  });
}
for (const result of [null, {}, { profile: { ...ep, queryPrefix: 'mismatch' }, task: 'query', vector: [1, 0] },
  { profile: ep, task: 'document', vector: [1, 0] }, { profile: ep, task: 'query', vector: [1, 0], source: 'invented' }]) {
  test('independent malformed embedding result: ' + JSON.stringify(result)?.slice(0, 35), async () => {
    const f = fake();
    f.runtime.embed = async () => result as RuntimeEmbedding;
    const { service } = fixture(f.runtime);
    await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_FAILURE'));
    await service.close();
  });
}
for (const result of [null, {}, { profile: gp, text: '' }, { profile: gp, text: '\ud800' },
  { profile: gp, text: 'x'.repeat(65) }, { profile: { ...gp, id: 'other' }, text: 'text' },
  { profile: gp, text: 'text', facts: [] }]) {
  test('independent malformed generation result: ' + JSON.stringify(result)?.slice(0, 35), async () => {
    const f = fake();
    f.runtime.generate = async () => result as RuntimeGeneration;
    const { service } = fixture(f.runtime);
    const n = await note(service);
    await assert.rejects(service.inference.generateNote({ source: n.source, instruction: 'Summarize', maxOutputCharacters: 64 }), errorCode('INFERENCE_FAILURE'));
    assert.equal(service.inference.capabilities().generation.state, 'failed');
    assert.equal(service.inference.capabilities().embedding.state, 'ready');
    await service.close();
  });
}
for (const text of ['', ' ', '\u0000', '\ud800', '\udfff', 'x'.repeat(INFERENCE_LIMITS.maxTextCharacters + 1)]) {
  test('bounded caller text: ' + JSON.stringify(text).slice(0, 25), async () => {
    const f = fake();
    const { service } = fixture(f.runtime);
    await assert.rejects(service.inference.embed({ text, task: 'query' }), errorCode('INVALID_INPUT'));
    assert.equal(f.calls.length, 0);
    assert.equal(service.inference.capabilities().embedding.state, 'ready');
    await service.close();
  });
}
test('prefix expansion, instruction, output bounds, source and task validation', async () => {
  const f = fake();
  const { service } = fixture(f.runtime);
  const n = await note(service);
  await assert.rejects(service.inference.embed({ text: 'x'.repeat(16384), task: 'query' }), errorCode('INVALID_INPUT'));
  await assert.rejects(service.inference.embed({ ...query, task: 'other' } as never), errorCode('INVALID_INPUT'));
  for (const maxOutputCharacters of [0, -1, 1.5, 4097, Infinity]) {
    await assert.rejects(service.inference.generateNote({ source: n.source, instruction: 'Summarize', maxOutputCharacters }), errorCode('INVALID_INPUT'));
  }
  for (const instruction of ['', '\ud800', 'x'.repeat(1025)]) {
    await assert.rejects(service.inference.generateNote({ source: n.source, instruction, maxOutputCharacters: 64 }), errorCode('INVALID_INPUT'));
  }
  await assert.rejects(service.inference.embedNote({ source: { ...n.source, module: 'workouts' } } as never), errorCode('INVALID_INPUT'));
  await assert.rejects(service.inference.embedNote({ source: { ...n.source, revision: 0 } }), errorCode('INVALID_INPUT'));
  await assert.rejects(service.inference.embedNote({ source: { ...n.source, revision: 2 } }), errorCode('CONFLICT', 'source'));
  assert.equal(f.calls.length, 0);
  await service.close();
});

for (const rejection of ['throw', 'reject']) {
  test('adapter ' + rejection + ' fails capability and leaves records usable', async () => {
    const f = fake();
    f.runtime.embed = () => { if (rejection === 'throw') throw new Error('private'); return Promise.reject(new Error('private')); };
    const { service } = fixture(f.runtime);
    await assert.rejects(service.inference.embed(query), errorCode('INFERENCE_FAILURE'));
    await note(service);
    await service.archive.export();
    assert.equal(service.inference.capabilities().embedding.state, 'failed');
    await service.close();
  });
}

test('pre-cancel, repeated cancel, throwing listeners, and unsubscribe are deterministic', async () => {
  const c = createInferenceCancellation();
  let count = 0;
  c.token.subscribe(() => { throw new Error('listener'); });
  const off = c.token.subscribe(() => { count++; });
  off(); off();
  c.cancel(); c.cancel();
  c.token.subscribe(() => { count++; });
  assert.equal(count, 1);
  const f = fake();
  const { service } = fixture(f.runtime);
  await assert.rejects(service.inference.embed(query, c.token), errorCode('CANCELLED'));
  assert.equal(f.calls.length, 0);
  await service.close();
});

test('active and queued cancellation retain native slot, bound queue, and discard late replies', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  let seen: InferenceCancellationToken | undefined;
  let nativeCancelled = 0;
  f.runtime.embed = async (_input, token) => {
    seen = token;
    token.subscribe(() => { nativeCancelled++; });
    started.resolve();
    return gate.promise;
  };
  const { service } = fixture(f.runtime);
  const activeCancel = createInferenceCancellation();
  const active = service.inference.embed(query, activeCancel.token);
  const activeRejected = assert.rejects(active, errorCode('CANCELLED'));
  await started.promise;
  const queuedCancel = createInferenceCancellation();
  const queued = service.inference.embed(query, queuedCancel.token);
  const queuedRejected = assert.rejects(queued, errorCode('CANCELLED'));
  queuedCancel.cancel();
  await queuedRejected;
  const pending = Array.from({ length: 4 }, () => {
    const c = createInferenceCancellation();
    const promise = service.inference.embed(query, c.token);
    const rejected = assert.rejects(promise, errorCode('CANCELLED'));
    return { c, rejected };
  });
  await assert.rejects(service.inference.embed(query), errorCode('CONFLICT', 'inference.queue'));
  activeCancel.cancel(); activeCancel.cancel();
  await activeRejected;
  assert.equal(seen!.cancelled, true);
  assert.equal(nativeCancelled, 1);
  await assert.rejects(service.inference.embed(query), errorCode('CONFLICT', 'inference.queue'));
  for (const p of pending) p.c.cancel();
  await Promise.all(pending.map(p => p.rejected));
  gate.reject(new Error('late ignored failure'));
  await service.close();
  assert.equal(f.calls.at(-1), 'close');
});

test('cooperative cancellation settles and removes caller and adapter listeners', async () => {
  const f = fake();
  let externalListeners = 0;
  let lateListenerCalls = 0;
  let notify = (): void => undefined;
  const token: InferenceCancellationToken = {
    cancelled: false,
    subscribe(listener) { externalListeners++; notify = listener; return () => { externalListeners--; }; },
  };
  let runtimeToken!: InferenceCancellationToken;
  f.runtime.embed = async (input, t) => {
    runtimeToken = t;
    t.subscribe(() => { lateListenerCalls++; });
    return { profile: ep, task: input.task, vector: [1, 0] };
  };
  const { service } = fixture(f.runtime);
  await service.inference.embed(query, token);
  assert.equal(externalListeners, 0);
  notify();
  runtimeToken.subscribe(() => { lateListenerCalls++; });
  await service.close();
  assert.equal(lateListenerCalls, 0);
  const second = fake();
  const start = deferred<void>();
  second.runtime.embed = async (_input, t) => new Promise((_resolve, reject) => {
    t.subscribe(() => reject(new Error('stopped'))); start.resolve();
  });
  const s = fixture(second.runtime).service;
  const c = createInferenceCancellation();
  const p = s.inference.embed(query, c.token);
  const rejected = assert.rejects(p, errorCode('CANCELLED'));
  await start.promise;
  c.cancel();
  await rejected;
  assert.equal(s.inference.capabilities().embedding.state, 'ready');
  await s.close();
});

for (const operation of ['edit', 'delete', 'confirm']) {
  test('obsolete note result after ' + operation + ' is not published', async () => {
    const f = fake();
    const gate = deferred<RuntimeEmbedding>();
    const start = deferred<void>();
    f.runtime.embed = async () => { start.resolve(); return gate.promise; };
    const { service } = fixture(f.runtime);
    const n = await note(service);
    const result = service.inference.embedNote({ source: n.source });
    const rejected = assert.rejects(result, errorCode('CONFLICT', 'source'));
    await start.promise;
    if (operation === 'edit') await service.notes.update({ requestId: 'edit', noteId: n.id, expectedRevision: 1, text: 'Newer text' });
    else if (operation === 'delete') await service.notes.delete({ requestId: 'delete', noteId: n.id, expectedRevision: 1 });
    else await service.notes.confirmFields({ requestId: 'confirm', noteId: n.id, expectedRevision: 1, fields: { pain: [], sleep: null, personalBest: null } });
    gate.resolve({ profile: clone(ep), task: 'document', vector: [1, 0] });
    await rejected;
    assert.equal(service.inference.capabilities().embedding.state, 'ready');
    await service.close();
  });
}

test('hung inference does not delay records, receipts, archive or same-ID restore; new calls excluded', async () => {
  const f = fake();
  const gate = deferred<RuntimeGeneration>();
  const start = deferred<void>();
  f.runtime.generate = async () => { start.resolve(); return gate.promise; };
  const { service, store } = fixture(f.runtime);
  const n = await note(service);
  const archive = await service.archive.export();
  const input = { source: n.source, instruction: 'Summarize', maxOutputCharacters: 64 };
  const pending = service.inference.generateNote(input);
  const rejected = assert.rejects(pending, errorCode('CANCELLED'));
  await start.promise;
  const workoutInput = { requestId: 'workout', date: '2026-10-14' };
  const workout = await service.workouts.create(workoutInput);
  assert.deepEqual(await service.workouts.create(workoutInput), workout);
  await service.notes.update({ requestId: 'edit', noteId: n.id, expectedRevision: 1, text: 'newer' });
  assert.equal((await service.notes.get(n.id)).text, 'newer');
  const inspect = await service.archive.inspect({ text: archive.text });
  const restore = { requestId: 'restore', text: archive.text, expectedDigest: inspect.digest, expectedHistoryRevision: inspect.currentHistoryRevision };
  const restoring = service.archive.restore(restore);
  assert.throws(() => service.inference.capabilities(), errorCode('CONFLICT', 'restore'));
  await assert.rejects(service.inference.embed(query), errorCode('CONFLICT', 'restore'));
  await restoring;
  await rejected;
  assert.equal(store.replacements, 1);
  assert.equal((await service.notes.get(n.id)).revision, 1);
  assert.equal((await service.notes.get(n.id)).text, 'Synthetic note text');
  assert.equal((await service.archive.export()).counts.workouts, 0);
  gate.resolve({ profile: gp, text: 'obsolete text' });
  await service.close();
});

test('failed restore invalidates derived waits without changing records', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  f.runtime.embed = async () => { started.resolve(); return gate.promise; };
  const { service } = fixture(f.runtime);
  const n = await note(service);
  const archive = await service.archive.export();
  const inspection = await service.archive.inspect({ text: archive.text });
  const pending = service.inference.embedNote({ source: n.source });
  const rejected = assert.rejects(pending, errorCode('CANCELLED'));
  await started.promise;
  await note(service, 'second');
  await assert.rejects(service.archive.restore({ requestId: 'restore', text: archive.text, expectedDigest: archive.digest,
    expectedHistoryRevision: inspection.currentHistoryRevision }), errorCode('CONFLICT', 'expectedHistoryRevision'));
  await rejected;
  assert.equal((await service.notes.history()).items.length, 2);
  gate.resolve({ profile: ep, task: 'document', vector: [1, 0] });
  await service.close();
});

test('mutable caller inputs, status and independent fake results cannot relabel work', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const start = deferred<void>();
  f.runtime.embed = async () => { start.resolve(); return gate.promise; };
  const { service } = fixture(f.runtime);
  const n = await note(service);
  const active = service.inference.embed(query);
  await start.promise;
  const mutable = { source: { ...n.source }, instruction: 'Original instruction', maxOutputCharacters: 64 };
  f.runtime.generate = async input => {
    assert.equal(input.text, 'Synthetic note text');
    assert.equal(input.instruction, 'Original instruction');
    (input.profile as { id: string }).id = 'adapter mutation';
    return { profile: clone(gp), text: 'Independent result' };
  };
  const pending = service.inference.generateNote(mutable);
  mutable.source.revision = 999;
  mutable.source.noteId = 'different';
  mutable.instruction = 'changed';
  mutable.maxOutputCharacters = 1;
  const status = service.inference.capabilities();
  if (status.generation.profile) (status.generation.profile as { id: string }).id = 'caller mutation';
  gate.resolve({ profile: clone(ep), task: 'query', vector: [1, 0] });
  await active;
  const result = await pending;
  assert.deepEqual(result.source, n.source);
  assert.equal(result.profile.id, gp.id);
  assert.equal(service.inference.capabilities().generation.profile!.id, gp.id);
  await service.close();
});

test('close shares promise, closes storage before uncooperative runtime drains, retains ownership', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const start = deferred<void>();
  const closeGate = deferred<void>();
  let runtimeClose = 0;
  f.runtime.embed = async () => { start.resolve(); return gate.promise; };
  f.runtime.close = async () => { runtimeClose++; await closeGate.promise; };
  const { service, store } = fixture(f.runtime);
  const pending = service.inference.embed(query);
  const rejected = assert.rejects(pending, errorCode('CANCELLED'));
  await start.promise;
  const close = service.close();
  assert.equal(service.close(), close);
  await rejected;
  assert.equal(store.closeCalls, 1);
  assert.equal(runtimeClose, 0);
  await assert.rejects(service.notes.get('anything'), errorCode('SERVICE_CLOSED'));
  await assert.rejects(service.inference.embed(query), errorCode('SERVICE_CLOSED'));
  assert.throws(() => fixture(f.runtime), errorCode('CONFLICT', 'inference'));
  gate.resolve({ profile: ep, task: 'query', vector: [1, 0] });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(runtimeClose, 1);
  assert.throws(() => fixture(f.runtime), errorCode('CONFLICT', 'inference'));
  closeGate.resolve();
  await close;
  const reused = fixture(f.runtime).service;
  await reused.close();
});

test('runtime cleanup failure still closes storage and never releases unknown ownership', async () => {
  const f = fake();
  f.runtime.close = async () => { throw new Error('unknown native release'); };
  const { service, store } = fixture(f.runtime);
  await note(service);
  const close = service.close();
  await assert.rejects(close, errorCode('INFERENCE_FAILURE'));
  assert.equal(service.close(), close);
  assert.equal(store.closeCalls, 1);
  assert.throws(() => fixture(f.runtime), errorCode('CONFLICT', 'inference'));
});

test('queued jobs do not bypass a failed capability', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  let calls = 0;
  f.runtime.embed = async () => { calls++; started.resolve(); return gate.promise; };
  const { service } = fixture(f.runtime);
  const first = service.inference.embed(query);
  const firstRejected = assert.rejects(first, errorCode('INFERENCE_FAILURE'));
  await started.promise;
  const second = service.inference.embed(query);
  const secondRejected = assert.rejects(second, errorCode('INFERENCE_UNAVAILABLE'));
  gate.reject(new Error('adapter rejected'));
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(calls, 1);
  assert.equal(service.inference.capabilities().embedding.state, 'failed');
  await service.close();
});

test('queued obsolete source never sends newer text to an adapter', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  let calls = 0;
  f.runtime.embed = async () => { calls++; started.resolve(); return gate.promise; };
  const { service } = fixture(f.runtime);
  const n = await note(service);
  const first = service.inference.embed(query);
  await started.promise;
  const second = service.inference.embedNote({ source: n.source });
  const rejected = assert.rejects(second, errorCode('CONFLICT', 'source'));
  await service.notes.update({ requestId: 'new-text', noteId: n.id, expectedRevision: 1, text: 'New text' });
  gate.resolve({ profile: ep, task: 'query', vector: [1, 0] });
  await first;
  await rejected;
  assert.equal(calls, 1);
  await service.close();
});

test('generation rejects edited sources and accepts valid supplementary Unicode', async () => {
  const f = fake();
  const gate = deferred<RuntimeGeneration>();
  const started = deferred<void>();
  f.runtime.generate = async () => { started.resolve(); return gate.promise; };
  const { service } = fixture(f.runtime);
  const n = await note(service);
  const first = service.inference.generateNote({ source: n.source, instruction: 'Summarize', maxOutputCharacters: 64 });
  const rejected = assert.rejects(first, errorCode('CONFLICT', 'source'));
  await started.promise;
  const edited = await service.notes.update({ requestId: 'edit', noteId: n.id, expectedRevision: 1, text: 'New text' });
  gate.resolve({ profile: gp, text: 'Synthetic 🙂' });
  await rejected;
  const second = await service.inference.generateNote({ source: edited.source, instruction: 'Summarize 🙂', maxOutputCharacters: 64 });
  assert.equal(second.text, 'Synthetic 🙂');
  assert.deepEqual(second.source, edited.source);
  await service.close();
});

test('cancelled late malformed reply does not poison a capability', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  f.runtime.embed = async () => { started.resolve(); return gate.promise; };
  const { service } = fixture(f.runtime);
  const c = createInferenceCancellation();
  const first = service.inference.embed(query, c.token);
  const rejected = assert.rejects(first, errorCode('CANCELLED'));
  await started.promise;
  c.cancel();
  await rejected;
  gate.resolve({} as RuntimeEmbedding);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(service.inference.capabilities().embedding.state, 'ready');
  f.runtime.embed = fake().runtime.embed!;
  await service.inference.embed(query);
  await service.close();
});

test('close promise is shared even inside injected cancellation listeners', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  let reentrant: Promise<void> | undefined;
  const { service } = fixture(f.runtime);
  f.runtime.embed = async (_input, token) => {
    token.subscribe(() => { reentrant = service.close(); });
    started.resolve();
    return gate.promise;
  };
  const first = service.inference.embed(query);
  const rejected = assert.rejects(first, errorCode('CANCELLED'));
  await started.promise;
  const closing = service.close();
  assert.equal(reentrant, closing);
  await rejected;
  gate.resolve({ profile: ep, task: 'query', vector: [1, 0] });
  await closing;
});

test('malformed runtime methods and caller subscription failures cannot strand jobs', async () => {
  for (const method of ['embed', 'generate']) {
    const f = fake();
    delete f.runtime[method as 'embed' | 'generate'];
    const { service } = fixture(f.runtime);
    assert.equal(service.inference.capabilities().embedding.state, 'failed');
    await service.close();
  }
  const f = fake();
  const { service } = fixture(f.runtime);
  await assert.rejects(service.inference.embed(query, {
    cancelled: false, subscribe() { throw new Error('bad token'); },
  }), errorCode('INVALID_INPUT', 'token'));
  await service.inference.embed(query);
  await service.close();
});

test('source-linked prefix overflow leaves the capability ready', async () => {
  const f = fake();
  const { service } = fixture(f.runtime);
  const n = await service.notes.create({ requestId: 'large', date: '2026-10-14', text: 'x'.repeat(16384) });
  await assert.rejects(service.inference.embedNote({ source: n.source }), errorCode('INVALID_INPUT', 'text'));
  assert.equal(service.inference.capabilities().embedding.state, 'ready');
  assert.equal(f.calls.length, 0);
  await service.close();
});

test('restore queues its accepted write before a cancellation listener closes the service', async () => {
  const f = fake();
  const gate = deferred<RuntimeEmbedding>();
  const started = deferred<void>();
  const { service, store } = fixture(f.runtime);
  let closing: Promise<void> | undefined;
  f.runtime.embed = async (_input, token) => {
    token.subscribe(() => { closing = service.close(); });
    started.resolve();
    return gate.promise;
  };
  await note(service);
  const archive = await service.archive.export();
  const inspection = await service.archive.inspect({ text: archive.text });
  const pending = service.inference.embed(query);
  const rejected = assert.rejects(pending, errorCode('CANCELLED'));
  await started.promise;
  await service.archive.restore({ requestId: 'restore', text: archive.text, expectedDigest: archive.digest,
    expectedHistoryRevision: inspection.currentHistoryRevision });
  await rejected;
  assert.equal(store.replacements, 1);
  assert.equal(store.closeCalls, 1);
  gate.resolve({ profile: ep, task: 'query', vector: [1, 0] });
  await closing;
});

test('Node factory passes optional runtime and defaults to missing', async () => {
  const defaultService = openNodeForma({ databasePath: ':memory:' });
  assert.equal(defaultService.inference.capabilities().embedding.state, 'missing');
  await defaultService.close();
  const f = fake();
  const service = openNodeForma({ databasePath: ':memory:', inference: f.runtime });
  assert.equal((await service.inference.embed(query)).profile.id, ep.id);
  await service.close();
});
