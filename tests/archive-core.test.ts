import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { ARCHIVE_LIMITS, createFormaService, sha256Utf8 } from '@forma/core';
import type { FormaService, RequestReceipt, WorkoutReader, WorkoutStore } from '@forma/core';
import { errorCode, MemoryWorkoutStore, TEST_TIME } from './helpers.js';

const oracle = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** The canonical JSON rule of the core: sorted keys, no spaces, no undefined values. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

type Envelope = Record<string, any>;
/** Change an archive and calculate a valid digest, so that the rule under test is the only failure. */
function edit(text: string, change: (archive: Envelope) => void): string {
  const archive = JSON.parse(text) as Envelope;
  change(archive);
  const { integrity: _ignored, ...unsigned } = archive;
  return canonical({ ...unsigned, integrity: { algorithm: 'sha-256', digest: oracle(canonical(unsigned)) } });
}
function digestOf(text: string): string {
  return (JSON.parse(text) as Envelope).integrity.digest as string;
}

interface Setup { readonly store: MemoryWorkoutStore; readonly service: FormaService; }
function setup(t: TestContext, prefix = 'id'): Setup {
  const store = new MemoryWorkoutStore();
  let next = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => prefix + '-' + ++next } });
  t.after(() => service.close());
  return { store, service };
}

async function seed(service: FormaService): Promise<void> {
  const finished = await service.workouts.create({ requestId: 'seed-create', date: '2026-10-01', splitDayId: 'lower', notes: 'Lower 🏋️ ünïcode' });
  await service.workouts.addSet({ requestId: 'seed-set-1', workoutId: finished.id, exerciseId: 'hammer-curls', reps: 10, weightKg: 12.5, loadConvention: 'per-hand', implementCount: 2 });
  await service.workouts.addSet({ requestId: 'seed-set-2', workoutId: finished.id, exerciseId: 'preacher-curl', reps: 8, weightKg: 20, rpe: 8.5 });
  const removed = await service.workouts.create({ requestId: 'seed-removed', date: '2026-10-02' });
  await service.workouts.delete({ requestId: 'seed-delete', workoutId: removed.id });
  const live = await service.workouts.start({ requestId: 'seed-start', date: '2026-10-03', splitDayId: 'upper' });
  await service.workouts.addSet({ requestId: 'seed-live-set', workoutId: live.id, exerciseId: 'preacher-curl-machine', reps: 12, weightKg: 30, loadConvention: 'entered' });
}

async function restoreText(service: FormaService, text: string, requestId = 'restore-1') {
  const inspection = await service.archive.inspect({ text });
  return service.archive.restore({ requestId, text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision });
}

test('SHA-256 matches the Node oracle at block boundaries and for non-ASCII text', () => {
  const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65),
    'é'.repeat(28), 'Übung 🏋️ 漢字 \u0000 end', 'lone \ud800 surrogate', 'x'.repeat(1000)];
  for (const sample of samples) assert.equal(sha256Utf8(sample), oracle(sample), JSON.stringify(sample).slice(0, 40));
  assert.equal(sha256Utf8('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('export, inspect, and restore keep exact records, receipts, catalog, and Unicode', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const exported = await source.service.archive.export();
  assert.equal(exported.createdAt, TEST_TIME);
  assert.deepEqual(exported.counts, { workouts: 2, sets: 3, receipts: 7, inProgress: 1 });
  assert.equal(exported.byteLength, Buffer.byteLength(exported.text, 'utf8'));
  const { integrity, ...unsigned } = JSON.parse(exported.text) as Envelope;
  assert.equal(integrity.digest, oracle(canonical(unsigned)));
  assert.equal(exported.digest, integrity.digest);
  assert.equal(exported.text, canonical(JSON.parse(exported.text)));

  const target = setup(t, 'dst');
  await target.service.workouts.create({ requestId: 'target-only', date: '2026-09-01' });
  const inspection = await target.service.archive.inspect({ text: exported.text });
  assert.deepEqual(inspection.current, { workouts: 1, sets: 0, receipts: 1, inProgress: 0 });
  assert.deepEqual(inspection.archive, exported.counts);
  assert.deepEqual(inspection.modules, ['catalog', 'requests', 'workouts']);
  const result = await target.service.archive.restore({ requestId: 'restore-1', text: exported.text,
    expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision });
  assert.deepEqual(result, { digest: exported.digest, counts: exported.counts });
  assert.deepEqual(await target.service.workouts.list(), await source.service.workouts.list());
  assert.deepEqual(await target.service.exercises.list(), await source.service.exercises.list());
  const sourceReceipts = [...source.store.receipts.values()];
  for (const receipt of sourceReceipts) assert.deepEqual(target.store.receipts.get(receipt.requestId), receipt);
  assert.equal(target.store.receipts.size, sourceReceipts.length + 1);
  assert.equal(target.store.receipts.has('target-only'), false);
  // Replays return original snapshots, including the deleted workout.
  assert.equal((await target.service.workouts.create({ requestId: 'seed-removed', date: '2026-10-02' })).id, 'src-4');
  await assert.rejects(target.service.workouts.get('src-4'), errorCode('NOT_FOUND'));
  // A same-request retry replays without another replacement.
  assert.deepEqual(await target.service.archive.restore({ requestId: 'restore-1', text: exported.text,
    expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision }), result);
  assert.equal(target.store.replacements, 1);
});

test('restore advances the local revision, also for an empty archive, and stale cursors conflict', async (t) => {
  const empty = setup(t, 'empty');
  const exported = await empty.service.archive.export();
  const target = setup(t, 'target');
  for (const day of ['01', '02']) await target.service.workouts.create({ requestId: 'c' + day, date: '2026-10-' + day });
  const page = await target.service.workouts.history({ limit: 1 });
  assert(page.nextCursor);
  const before = target.store.historyRevision;
  await restoreText(target.service, exported.text);
  assert.equal(target.store.historyRevision, before + 1);
  assert.deepEqual(await target.service.workouts.list(), []);
  await assert.rejects(target.service.workouts.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
});

test('a write after inspection blocks restore with zero replacement, and a successful restore replays later', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const target = setup(t, 'dst');
  const inspection = await target.service.archive.inspect({ text });
  await target.service.workouts.create({ requestId: 'between', date: '2026-10-05' });
  const input = { requestId: 'restore-r', text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision };
  await assert.rejects(target.service.archive.restore(input), errorCode('CONFLICT', 'expectedHistoryRevision'));
  assert.equal(target.store.replacements, 0);
  assert.equal((await target.service.workouts.list()).length, 1);
  assert.equal(target.store.receipts.has('restore-r'), false);
  const fresh = await target.service.archive.inspect({ text });
  const confirmed = { ...input, expectedHistoryRevision: fresh.currentHistoryRevision };
  const result = await target.service.archive.restore(confirmed);
  await target.service.workouts.create({ requestId: 'after', date: '2026-10-06' });
  assert.deepEqual(await target.service.archive.restore(confirmed), result);
  assert.equal(target.store.replacements, 1);
  await assert.rejects(target.service.archive.restore({ ...confirmed, expectedHistoryRevision: confirmed.expectedHistoryRevision + 1 }),
    errorCode('CONFLICT', 'requestId'));
});

test('invalid archives fail before any store operation', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const firstWorkout = (archive: Envelope) => archive.modules.workouts.workouts[0];
  const cases: readonly [string, string, string][] = [
    ['not JSON', text.slice(0, -1), 'archive'],
    ['extra root key', edit(text, (a) => { a.extra = 1; }), 'archive'],
    ['wrong format', edit(text, (a) => { a.format = 'other'; }), 'archive.formatVersion'],
    ['newer format version', edit(text, (a) => { a.formatVersion = 2; }), 'archive.formatVersion'],
    ['unknown module', edit(text, (a) => { a.modules.notes = { version: 1 }; }), 'archive.modules'],
    ['missing module', edit(text, (a) => { delete a.modules.requests; }), 'archive.modules'],
    ['newer module version', edit(text, (a) => { a.modules.workouts.version = 2; }), 'archive.modules'],
    ['digest mismatch', text.replace('ünïcode', 'unicode'), 'archive.integrity'],
    ['unsupported algorithm', edit(text, () => {}).replace('"sha-256"', '"md5"'), 'archive.integrity'],
    ['duplicate workout ID', edit(text, (a) => { a.modules.workouts.workouts.push({ ...firstWorkout(a), sets: [] }); }), 'archive.workouts'],
    ['duplicate set ID across workouts', edit(text, (a) => {
      const [one, two] = a.modules.workouts.workouts; two.sets = [{ ...one.sets[0], position: 0 }];
    }), 'archive.workouts'],
    ['unknown exercise reference', edit(text, (a) => { firstWorkout(a).sets[0].exerciseId = 'missing'; }), 'archive.workouts'],
    ['unknown split reference', edit(text, (a) => { firstWorkout(a).splitDayId = 'missing'; }), 'archive.workouts'],
    ['two active sessions', edit(text, (a) => { for (const w of a.modules.workouts.workouts) { w.status = 'in-progress'; w.finishedAt = null; } }), 'archive.workouts'],
    ['active session with finish time', edit(text, (a) => {
      const live = a.modules.workouts.workouts.find((w: Envelope) => w.status === 'in-progress'); live.finishedAt = TEST_TIME;
    }), 'archive.workouts'],
    ['legacy set without load fields', edit(text, (a) => {
      const set = firstWorkout(a).sets[0]; delete set.loadConvention; delete set.implementCount;
    }), 'archive.workouts'],
    ['gap in set positions', edit(text, (a) => { firstWorkout(a).sets[0].position = 5; }), 'archive.workouts'],
    ['wrong timestamp', edit(text, (a) => { firstWorkout(a).createdAt = '2026-10-01'; }), 'archive.workouts'],
    ['duplicate receipt ID', edit(text, (a) => { a.modules.requests.receipts.push(a.modules.requests.receipts[0]); }), 'archive.requests'],
    ['unknown operation', edit(text, (a) => { a.modules.requests.receipts[0].operation = 'notes.create'; }), 'archive.requests'],
    ['receipt format 2', edit(text, (a) => { a.modules.requests.receipts[0].formatVersion = 2; }), 'archive.requests'],
    ['duplicate exercise', edit(text, (a) => { a.modules.catalog.exercises.push(a.modules.catalog.exercises[0]); }), 'archive.catalog'],
    ['over the byte limit', ' '.repeat(ARCHIVE_LIMITS.maxArchiveBytes + 1), 'archive.size'],
    ['over the byte limit in UTF-8 only', 'é'.repeat(ARCHIVE_LIMITS.maxArchiveBytes / 2 + 1), 'archive.size'],
    ['over the workout budget', edit(text, (a) => {
      const template = { ...firstWorkout(a), sets: [], status: 'finished' };
      a.modules.workouts.workouts = Array.from({ length: ARCHIVE_LIMITS.maxWorkouts + 1 }, (_, index) => ({ ...template, id: 'w' + index }));
    }), 'archive.size'],
  ];
  const target = setup(t, 'dst');
  await target.service.workouts.create({ requestId: 'keep', date: '2026-09-01' });
  const before = structuredClone([...target.store.workouts.values()]);
  const writes = target.store.writes;
  for (const [name, invalidText, field] of cases) {
    await assert.rejects(target.service.archive.inspect({ text: invalidText }), errorCode('INVALID_INPUT', field), name + ' (inspect)');
    await assert.rejects(target.service.archive.restore({ requestId: 'bad', text: invalidText, expectedDigest: '0'.repeat(64), expectedHistoryRevision: 0 }),
      errorCode('INVALID_INPUT', field), name + ' (restore)');
  }
  assert.equal(target.store.writes, writes);
  assert.deepEqual([...target.store.workouts.values()], before);
  // Confirmation and request identity conflicts also fail before the store.
  await assert.rejects(target.service.archive.restore({ requestId: 'bad', text, expectedDigest: '0'.repeat(64), expectedHistoryRevision: 0 }),
    errorCode('CONFLICT', 'expectedDigest'));
  await assert.rejects(target.service.archive.restore({ requestId: 'seed-create', text, expectedDigest: digestOf(text), expectedHistoryRevision: 0 }),
    errorCode('CONFLICT', 'requestId'));
  for (const [input, field] of [
    [{ requestId: ' bad', text, expectedDigest: digestOf(text), expectedHistoryRevision: 0 }, 'requestId'],
    [{ requestId: 'ok', text, expectedDigest: 'ABC', expectedHistoryRevision: 0 }, 'expectedDigest'],
    [{ requestId: 'ok', text, expectedDigest: digestOf(text), expectedHistoryRevision: -1 }, 'expectedHistoryRevision'],
    [{ requestId: 'ok', text, expectedDigest: digestOf(text), expectedHistoryRevision: 0, extra: true }, 'extra'],
  ] as const) await assert.rejects(target.service.archive.restore(input as never), errorCode('INVALID_INPUT', field));
  await assert.rejects(target.service.archive.inspect({ text: 42 } as never), errorCode('INVALID_INPUT', 'archive'));
  assert.equal(target.store.writes, writes);
});

test('a catalog mismatch fails inside the transaction without replacement', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const target = setup(t, 'dst');
  const mismatches = [
    edit(text, (a) => { a.modules.catalog.exercises.reverse(); }),
    edit(text, (a) => {
      const lower = a.modules.catalog.splitDays.find((day: Envelope) => day.id === 'lower');
      lower.exerciseIds = lower.exerciseIds.filter((id: string) => id !== 'hammer-curls');
      a.modules.catalog.splitDays.find((day: Envelope) => day.id === 'arms-shoulders').exerciseIds.push('hammer-curls');
    }),
    edit(text, (a) => { a.modules.catalog.exercises.find((e: Envelope) => e.id === 'preacher-curl').name = 'Preacher Curl Machine 2'; }),
  ];
  for (const mismatch of mismatches) {
    await assert.rejects(target.service.archive.inspect({ text: mismatch }), errorCode('INVALID_INPUT', 'archive.catalog'));
    await assert.rejects(target.service.archive.restore({ requestId: 'cat', text: mismatch, expectedDigest: digestOf(mismatch), expectedHistoryRevision: 0 }),
      errorCode('INVALID_INPUT', 'archive.catalog'));
  }
  assert.equal(target.store.replacements, 0);
  assert.equal(target.store.receipts.size, 0);
});

const LEGACY: readonly RequestReceipt[] = [
  // Released before load conventions: no load pair in the signature or the set snapshot.
  { requestId: 'legacy-add', operation: 'workouts.addSet', formatVersion: 1,
    inputSignature: '{"exerciseId":"leg-curls","reps":8,"rpe":null,"weightKg":20,"workoutId":"gone"}',
    resultJson: '{"id":"gone-set","exerciseId":"leg-curls","reps":8,"weightKg":20,"rpe":null,"position":0}' },
  // Released before sessions: no status or finish time.
  { requestId: 'legacy-create', operation: 'workouts.create', formatVersion: 1,
    inputSignature: '{"date":"2026-01-02","durationMin":null,"notes":"","splitDayId":null}',
    resultJson: '{"id":"gone","date":"2026-01-02","splitDayId":null,"notes":"","durationMin":null,"createdAt":"2026-01-02T08:00:00.000Z","updatedAt":"2026-01-02T08:00:00.000Z","sets":[]}' },
  { requestId: 'legacy-delete', operation: 'workouts.delete', formatVersion: 1, inputSignature: '{"workoutId":"gone"}', resultJson: 'null' },
  { requestId: 'legacy-update-set', operation: 'workouts.updateSet', formatVersion: 1,
    inputSignature: '{"rpe":null,"setId":"gone-set","workoutId":"gone"}',
    resultJson: '{"id":"gone-set","exerciseId":"leg-curls","reps":8,"weightKg":20,"rpe":null,"position":0}' },
];

test('legacy, deleted-record, and null-result receipts restore byte-exact and replay', async (t) => {
  const source = setup(t, 'src');
  for (const receipt of LEGACY) source.store.receipts.set(receipt.requestId, receipt);
  const { text } = await source.service.archive.export();
  const target = setup(t, 'dst');
  await restoreText(target.service, text);
  for (const receipt of LEGACY) assert.deepEqual(target.store.receipts.get(receipt.requestId), receipt);
  const replay = await target.service.workouts.addSet({ requestId: 'legacy-add', workoutId: 'gone', exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  assert.equal(replay.loadConvention, 'unknown');
  assert.equal((await target.service.workouts.create({ requestId: 'legacy-create', date: '2026-01-02' })).status, 'finished');
  assert.equal(await target.service.workouts.delete({ requestId: 'legacy-delete', workoutId: 'gone' }), undefined);
  // Replay never rewrites a stored receipt.
  for (const receipt of LEGACY) assert.deepEqual(target.store.receipts.get(receipt.requestId), receipt);
  assert.deepEqual(await target.service.workouts.list(), []);
});

test('malformed receipts fail restore before a write and stop export', async (t) => {
  const source = setup(t, 'src');
  for (const receipt of LEGACY) source.store.receipts.set(receipt.requestId, receipt);
  const { text } = await source.service.archive.export();
  const receipt = (archive: Envelope, id: string) => archive.modules.requests.receipts.find((r: Envelope) => r.requestId === id);
  const bad = [
    edit(text, (a) => { receipt(a, 'legacy-add').resultJson = '{"id":"gone-set"}'; }),
    edit(text, (a) => { receipt(a, 'legacy-add').resultJson = '{"id":'; }),
    edit(text, (a) => { receipt(a, 'legacy-delete').resultJson = '{}'; }),
    edit(text, (a) => { receipt(a, 'legacy-create').resultJson = 'null'; }),
    edit(text, (a) => { receipt(a, 'legacy-delete').inputSignature = '{"workoutId":"gone","extra":1}'; }),
    edit(text, (a) => { receipt(a, 'legacy-delete').inputSignature = '{ "workoutId":"gone"}'; }),
    edit(text, (a) => { receipt(a, 'legacy-delete').inputSignature = '["gone"]'; }),
    edit(text, (a) => { receipt(a, 'legacy-delete').inputSignature = '{"workoutId":{"nested":{"deep":1}}}'; }),
    edit(text, (a) => { receipt(a, 'legacy-add').inputSignature = '{"exerciseId":"leg-curls","loadConvention":"unknown","reps":8,"rpe":null,"weightKg":20,"workoutId":"gone"}'; }),
    edit(text, (a) => { receipt(a, 'legacy-update-set').inputSignature = '{"setId":"gone-set","workoutId":"gone"}'; }),
  ];
  const target = setup(t, 'dst');
  const writes = target.store.writes;
  for (const invalidText of bad) {
    await assert.rejects(target.service.archive.restore({ requestId: 'r', text: invalidText, expectedDigest: digestOf(invalidText), expectedHistoryRevision: 0 }),
      errorCode('INVALID_INPUT', 'archive.requests'));
  }
  assert.equal(target.store.writes, writes);
  source.store.receipts.set('broken', { ...LEGACY[0]!, requestId: 'broken', resultJson: '{"id":"x"}' });
  await assert.rejects(source.service.archive.export(), errorCode('STORAGE_FAILURE', 'archive.requests'));
});

test('export checks the record budget before it reads the records', async (t) => {
  const store = new MemoryWorkoutStore();
  const listed: string[] = [];
  const counting: WorkoutStore = {
    read: (run) => store.read((reader) => run({
      ...reader,
      countArchiveRecords: async () => ({ workouts: 1, sets: ARCHIVE_LIMITS.maxSets + 1, receipts: 0, inProgress: 0 }),
      listWorkouts: async (input) => { listed.push('workouts'); return reader.listWorkouts(input); },
    } satisfies WorkoutReader)),
    write: (run) => store.write(run),
    close: () => store.close(),
  };
  const service = createFormaService({ store: counting, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'x' } });
  t.after(() => service.close());
  await assert.rejects(service.archive.export(), errorCode('INVALID_INPUT', 'archive.size'));
  assert.deepEqual(listed, []);
});

test('the core exclusion blocks cached API references during restore and always ends', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const target = setup(t, 'dst');
  const workouts = target.service.workouts;
  const exercises = target.service.exercises;
  const inspection = await target.service.archive.inspect({ text });
  const input = { requestId: 'restore-x', text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision };

  // A read accepted before the restore drains first. New work through cached references fails.
  const acceptedRead = workouts.list();
  const restoring = target.service.archive.restore(input);
  await assert.rejects(workouts.create({ requestId: 'during', date: '2026-10-09' }), errorCode('CONFLICT', 'restore'));
  await assert.rejects(exercises.list(), errorCode('CONFLICT', 'restore'));
  await assert.rejects(target.service.archive.export(), errorCode('CONFLICT', 'restore'));
  await assert.rejects(target.service.archive.restore({ ...input, requestId: 'restore-y' }), errorCode('CONFLICT', 'restore'));
  assert.deepEqual(await acceptedRead, []);
  await restoring;
  assert.equal(target.store.replacements, 1);
  assert.equal(target.store.receipts.has('during'), false);
  assert.equal(target.store.receipts.has('restore-y'), false);
  // The exclusion ended after success.
  assert.equal((await workouts.list()).length, 2);

  // A failed restore also ends the exclusion.
  await assert.rejects(target.service.archive.restore({ ...input, requestId: 'restore-z' }), errorCode('CONFLICT', 'expectedHistoryRevision'));
  assert.equal((await workouts.create({ requestId: 'after-failure', date: '2026-10-10' })).date, '2026-10-10');
});

test('a write accepted before restore drains first and then blocks the confirmed restore', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const target = setup(t, 'dst');
  const inspection = await target.service.archive.inspect({ text });
  const accepted = target.service.workouts.create({ requestId: 'accepted', date: '2026-10-08' });
  const restoring = target.service.archive.restore({ requestId: 'restore-a', text, expectedDigest: inspection.digest,
    expectedHistoryRevision: inspection.currentHistoryRevision });
  assert.equal((await accepted).date, '2026-10-08');
  await assert.rejects(restoring, errorCode('CONFLICT', 'expectedHistoryRevision'));
  assert.equal(target.store.replacements, 0);
  assert.deepEqual((await target.service.workouts.list()).map((workout) => workout.date), ['2026-10-08']);
});

test('close during restore drains the restore and then rejects new work', async (t) => {
  const source = setup(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const target = setup(t, 'dst');
  const workouts = target.service.workouts;
  const inspection = await target.service.archive.inspect({ text });
  const restoring = target.service.archive.restore({ requestId: 'restore-c', text, expectedDigest: inspection.digest,
    expectedHistoryRevision: inspection.currentHistoryRevision });
  const closing = target.service.close();
  await assert.rejects(workouts.list(), errorCode('SERVICE_CLOSED'));
  await assert.rejects(target.service.archive.inspect({ text }), errorCode('SERVICE_CLOSED'));
  assert.equal((await restoring).counts.workouts, 2);
  await closing;
  assert.equal(target.store.replacements, 1);
  await assert.rejects(target.service.archive.restore({ requestId: 'late', text, expectedDigest: inspection.digest, expectedHistoryRevision: 0 }),
    errorCode('SERVICE_CLOSED'));
});
