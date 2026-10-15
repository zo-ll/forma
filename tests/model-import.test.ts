import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { MODEL_ARTIFACTS, createModelImportFlow, parseModelStatus } from '@forma/mobile-host';
import type { ModelFiles } from '@forma/mobile-host';
import { memoryFixture, errorCode } from './helpers.js';

const [embedding, generator] = MODEL_ARTIFACTS;
const empty = () => MODEL_ARTIFACTS.map(a => ({ artifactId: a.id, state: 'missing', byteLength: 0 }));
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function setup() {
  let id = 0; let available = true;
  const calls: string[] = [];
  const importResult = deferred<unknown>();
  const files: ModelFiles = {
    status: async () => empty(),
    importFile: async (a, r) => { calls.push(a, r); return importResult.promise; },
    cancel: async r => { calls.push('cancel:' + r); return true; },
  };
  const flow = createModelImportFlow({ files, nextId: () => 'model-' + ++id, available: () => available });
  return { flow, files, calls, importResult, close: () => { available = false; } };
}
test('the catalog selects only the exact approved files and literal source URLs', () => {
  assert.equal(MODEL_ARTIFACTS.length, 2);
  assert.equal(embedding!.byteLength, 164626432);
  assert.equal(generator!.byteLength, 2008432640);
  assert.equal(embedding!.backend, 'cpu'); assert.equal(generator!.backend, 'gpu');
  for (const a of MODEL_ARTIFACTS) {
    assert.match(a.sha256, /^[a-f0-9]{64}$/); assert.ok(a.url.endsWith('/' + a.filename));
    assert.equal(new URL(a.url).hostname, 'huggingface.co'); assert.ok(Object.isFrozen(a));
  }
});
test('the native allowlist and no-backup location match the portable catalog', () => {
  const native = readFileSync('apps/mobile/android/app/src/main/java/dev/forma/mobile/ModelArtifactStore.kt', 'utf8');
  for (const a of MODEL_ARTIFACTS) {
    assert.ok(native.includes(`ModelArtifact("${a.id}", ${a.byteLength}L, "${a.sha256}")`), a.id);
  }
  const module = readFileSync('apps/mobile/android/app/src/main/java/dev/forma/mobile/FormaModelsModule.kt', 'utf8');
  assert.match(module, /File\(context.noBackupFilesDir, "forma-models-v1"\)/);
  assert.doesNotMatch(module, /https?:\/\/|SQLite|URL\(/);
});
test('status validation rejects unknown, duplicate, malformed, and false verified files', () => {
  const a = embedding!;
  for (const value of [null, [], [empty()[0], empty()[0]],
    [{ artifactId: a.id, state: 'ready', byteLength: 0 }, empty()[1]],
    [{ artifactId: a.id, state: 'verified', byteLength: a.byteLength - 1 }, empty()[1]],
    [{ artifactId: a.id, state: 'missing', byteLength: 1 }, empty()[1]],
    [{ artifactId: 'not-approved', state: 'verified', byteLength: 1 }, empty()[1]],
    [{ ...empty()[0], path: '/private/file' }, empty()[1]],
    [{ ...empty()[0], byteLength: NaN }, empty()[1]],
  ]) assert.throws(() => parseModelStatus(value));
  assert.deepEqual(parseModelStatus(empty().reverse()), empty());
});
test('rapid duplicate import commands share one native request across subscribers', async () => {
  const s = setup(); await s.flow.refresh(); let notifications = 0;
  const unsubscribe = s.flow.subscribe(() => { notifications++; });
  s.flow.subscribe(() => { throw new Error('listener'); });
  const first = s.flow.importFile(embedding!.id); const again = s.flow.importFile(embedding!.id);
  assert.equal(first, again); await settle(); assert.deepEqual(s.calls, [embedding!.id, 'model-1']);
  assert.equal(s.flow.snapshot().active, embedding!.id);
  await assert.rejects(s.flow.importFile(generator!.id), errorCode('CONFLICT'));
  unsubscribe(); const before = notifications;
  s.importResult.resolve({ status: 'imported', artifactId: embedding!.id, byteLength: embedding!.byteLength });
  await first;
  assert.equal(s.flow.snapshot().active, null); assert.equal(notifications, before);
  assert.equal(s.flow.snapshot().files![0]!.state, 'verified');
  assert.match(s.flow.snapshot().notice!, /Inference is not enabled/);
  const copy = s.flow.snapshot().files as unknown as { state: string }[];
  copy[0]!.state = 'changed'; assert.equal(s.flow.snapshot().files![0]!.state, 'verified');
});
test('cancellation retains the busy slot until native settlement and uses the exact request', async () => {
  const s = setup(); await s.flow.refresh(); const importing = s.flow.importFile(embedding!.id); await settle();
  const cancelled = s.flow.cancel(); assert.equal(s.flow.cancel(), cancelled); await cancelled;
  assert.equal(s.flow.snapshot().active, embedding!.id);
  assert.deepEqual(s.calls, [embedding!.id, 'model-1', 'cancel:model-1']);
  s.importResult.resolve({ status: 'cancelled', artifactId: embedding!.id, byteLength: 0 }); await importing;
  assert.equal(s.flow.snapshot().files![0]!.state, 'missing');
  assert.match(s.flow.snapshot().notice!, /cancelled/); assert.equal(s.flow.snapshot().active, null);
});
test('a completed commit wins over a late cancellation request', async () => {
  const s = setup(); await s.flow.refresh(); const importing = s.flow.importFile(embedding!.id); await s.flow.cancel();
  s.importResult.resolve({ status: 'imported', artifactId: embedding!.id, byteLength: embedding!.byteLength }); await importing;
  assert.equal(s.flow.snapshot().files![0]!.state, 'verified'); assert.match(s.flow.snapshot().notice!, /saved/);
});
test('late status results cannot replace a newer import result', async () => {
  const s = setup(); await s.flow.refresh(); const status = deferred<unknown>(); s.files.status = () => status.promise;
  const refreshing = s.flow.refresh(); await settle(); const importing = s.flow.importFile(embedding!.id);
  s.importResult.resolve({ status: 'imported', artifactId: embedding!.id, byteLength: embedding!.byteLength }); await importing;
  status.resolve(empty()); await refreshing;
  assert.equal(s.flow.snapshot().files![0]!.state, 'verified'); assert.equal(s.flow.snapshot().checking, false);
});
test('failed replacement and malformed result keep the last verified status and hide native text', async () => {
  for (const result of ['throw', { status: 'imported', artifactId: generator!.id, byteLength: generator!.byteLength },
    { status: 'imported', artifactId: embedding!.id, byteLength: 10 },
    { status: 'cancelled', artifactId: embedding!.id, byteLength: 2 }]) {
    const s = setup(); s.files.status = async () => [{ artifactId: embedding!.id, state: 'verified', byteLength: embedding!.byteLength }, empty()[1]];
    await s.flow.refresh(); const before = s.flow.snapshot().files;
    const attempt = s.flow.importFile(embedding!.id); await settle();
    if (result === 'throw') s.importResult.reject(new Error('/private/provider/path secret'));
    else s.importResult.resolve(result);
    await attempt;
    assert.deepEqual(s.flow.snapshot().files, before);
    assert.equal(s.flow.snapshot().error?.code, 'STORAGE_FAILURE');
    assert.doesNotMatch(s.flow.snapshot().error!.message, /secret|private|provider/);
  }
});
test('initial status is required and concurrent checks share one native read', async () => {
  const s = setup(); await assert.rejects(s.flow.importFile(embedding!.id), errorCode('CONFLICT'));
  const result = deferred<unknown>(); let reads = 0;
  s.files.status = () => { reads++; return result.promise; };
  const first = s.flow.refresh(); assert.equal(s.flow.refresh(), first); await settle(); assert.equal(reads, 1);
  result.resolve(empty()); await first; assert.deepEqual(s.flow.snapshot().files, empty());
});
test('failed cancellation keeps the import slot and permits a safe retry', async () => {
  const s = setup(); await s.flow.refresh(); const importing = s.flow.importFile(embedding!.id); await settle();
  s.files.cancel = async () => { throw new Error('private provider detail'); };
  await s.flow.cancel(); assert.equal(s.flow.snapshot().active, embedding!.id);
  assert.equal(s.flow.snapshot().error?.code, 'STORAGE_FAILURE'); assert.equal(s.flow.snapshot().cancelling, false);
  s.files.cancel = async () => true; await s.flow.cancel(); assert.equal(s.flow.snapshot().cancelling, true);
  s.importResult.resolve({ status: 'cancelled', artifactId: embedding!.id, byteLength: 0 }); await importing;
  assert.equal(s.flow.snapshot().active, null);
});
test('the closed host prevents import without a picker request', async () => {
  const s = setup(); s.close(); await assert.rejects(s.flow.importFile(embedding!.id), errorCode('SERVICE_CLOSED'));
  assert.deepEqual(s.calls, []);
});
test('model file I/O cannot block records or promote inference readiness', async t => {
  const { service } = memoryFixture(t);
  const s = setup(); await s.flow.refresh(); const importing = s.flow.importFile(embedding!.id); await settle();
  const note = await service.notes.create({ requestId: 'independent-model-import', date: '2026-10-15', text: 'Synthetic record' });
  assert.equal(note.text, 'Synthetic record');
  assert.equal(service.inference.capabilities().embedding.state, 'missing');
  const archive = await service.archive.export(); assert.doesNotMatch(archive.text, /litertlm/);
  s.importResult.resolve({ status: 'imported', artifactId: embedding!.id, byteLength: embedding!.byteLength }); await importing;
  assert.equal(service.inference.capabilities().embedding.state, 'missing');
});
