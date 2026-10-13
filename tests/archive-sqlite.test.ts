import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openNodeForma, SqliteWorkoutStore } from '@forma/adapters/node';
import { createFormaService } from '@forma/core';
import type { FormaService, WorkoutWriter } from '@forma/core';
import { archiveContract } from './archive-contract.js';
import { errorCode, memoryFixture, TEST_TIME } from './helpers.js';

interface Database { readonly path: string; readonly service: FormaService; }
async function database(t: TestContext, prefix = 'id'): Promise<Database> {
  const directory = await mkdtemp(join(tmpdir(), 'forma-archive-'));
  const path = join(directory, 'records.sqlite');
  let next = 0;
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => prefix + '-' + ++next } });
  t.after(async () => { try { await service.close(); } finally { await rm(directory, { recursive: true, force: true }); } });
  return { path, service };
}

/** Raw rows of every table that restore can change, read by an independent connection. */
function rows(path: string): Record<string, unknown> {
  const db = new DatabaseSync(path);
  try {
    return Object.fromEntries([
      ['workouts', 'SELECT * FROM workouts ORDER BY id'], ['sets', 'SELECT * FROM sets ORDER BY id'],
      ['receipts', 'SELECT * FROM request_receipts ORDER BY request_id'], ['revision', 'SELECT revision FROM workout_history_state'],
      ['exercises', 'SELECT * FROM exercises ORDER BY catalog_position'], ['aliases', 'SELECT * FROM exercise_aliases ORDER BY normalized_alias'],
      ['groups', 'SELECT * FROM workout_groups ORDER BY catalog_position'], ['members', 'SELECT * FROM workout_group_exercises ORDER BY group_id, position'],
    ].map(([name, sql]) => [name, db.prepare(sql!).all().map((row) => ({ ...row }))]));
  } finally { db.close(); }
}
function exec(path: string, sql: string): void {
  const db = new DatabaseSync(path);
  try { db.exec(sql); } finally { db.close(); }
}

async function seed(service: FormaService): Promise<void> {
  const workout = await service.workouts.create({ requestId: 'seed-create', date: '2026-10-01', splitDayId: 'lower', notes: 'Ünïcode 🏋️', durationMin: 61.25 });
  await service.workouts.addSet({ requestId: 'seed-set', workoutId: workout.id, exerciseId: 'hammer-curls', reps: 10, weightKg: 0.1 + 0.2, loadConvention: 'per-hand', implementCount: 1 });
  await service.workouts.finish({ requestId: 'seed-finish', workoutId: workout.id });
  const removed = await service.workouts.create({ requestId: 'seed-removed', date: '2026-10-02' });
  await service.workouts.delete({ requestId: 'seed-delete', workoutId: removed.id });
  await service.workouts.start({ requestId: 'seed-start', date: '2026-10-03' });
}

archiveContract('Node SQLite archive contract', async (t, ids) => (await database(t, ids[0]!.slice(0, -2))).service);

test('SQLite restore writes the exact raw rows and keeps catalog rows', async (t) => {
  const source = await database(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const target = await database(t, 'dst');
  await target.service.workouts.create({ requestId: 'target-only', date: '2026-09-01' });
  const before = rows(target.path);
  const inspection = await target.service.archive.inspect({ text });
  await target.service.archive.restore({ requestId: 'restore-1', text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision });
  const expected = rows(source.path);
  const actual = rows(target.path);
  for (const table of ['workouts', 'sets', 'exercises', 'aliases', 'groups', 'members']) assert.deepEqual(actual[table], expected[table], table);
  const receipts = actual.receipts as Record<string, unknown>[];
  assert.deepEqual(receipts.filter((row) => row.request_id !== 'restore-1'), expected.receipts);
  assert.equal(receipts.find((row) => row.request_id === 'restore-1')?.input_signature,
    JSON.stringify({ digest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision }));
  assert.deepEqual(actual.exercises, before.exercises);
  const [revision] = actual.revision as { revision: number }[];
  assert(revision!.revision > (before.revision as { revision: number }[])[0]!.revision);
});

test('memory and SQLite archives restore into each other exactly', async (t) => {
  const memory = memoryFixture(t).service;
  await seed(memory);
  const sqlite = await database(t, 'sql');
  const fromMemory = await memory.archive.export();
  const inspection = await sqlite.service.archive.inspect({ text: fromMemory.text });
  await sqlite.service.archive.restore({ requestId: 'to-sqlite', text: fromMemory.text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision });
  assert.deepEqual(await sqlite.service.workouts.list(), await memory.workouts.list());
  const fromSqlite = await sqlite.service.archive.export();
  const back = memoryFixture(t).service;
  const second = await back.archive.inspect({ text: fromSqlite.text });
  await back.archive.restore({ requestId: 'to-memory', text: fromSqlite.text, expectedDigest: second.digest, expectedHistoryRevision: second.currentHistoryRevision });
  assert.deepEqual(await back.workouts.list(), await memory.workouts.list());
  assert.deepEqual(await back.exercises.list(), await sqlite.service.exercises.list());
  assert.equal(second.archive.receipts, fromMemory.counts.receipts + 1);
});

test('late SQLite failures roll back replacement, receipt import, and the restore receipt', async (t) => {
  const source = await database(t, 'src');
  await seed(source.service);
  const { text } = await source.service.archive.export();
  const archive = JSON.parse(text) as { modules: { requests: { receipts: { requestId: string }[] }; workouts: { workouts: { id: string }[] } } };
  const lastReceipt = archive.modules.requests.receipts.at(-1)!.requestId;
  const lastWorkout = archive.modules.workouts.workouts.at(-1)!.id;
  const target = await database(t, 'dst');
  const kept = await target.service.workouts.start({ requestId: 'kept', date: '2026-09-01' });
  await target.service.workouts.addSet({ requestId: 'kept-set', workoutId: kept.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  const triggers = [
    `CREATE TRIGGER fail_import BEFORE INSERT ON request_receipts WHEN NEW.request_id = '${lastReceipt}' BEGIN SELECT RAISE(ABORT, 'Injected receipt import failure'); END`,
    `CREATE TRIGGER fail_import BEFORE INSERT ON workouts WHEN NEW.id = '${lastWorkout}' BEGIN SELECT RAISE(ABORT, 'Injected workout import failure'); END`,
    `CREATE TRIGGER fail_import BEFORE INSERT ON request_receipts WHEN NEW.operation = 'archive.restore' BEGIN SELECT RAISE(ABORT, 'Injected restore receipt failure'); END`,
    `CREATE TRIGGER fail_import BEFORE UPDATE ON workout_history_state BEGIN SELECT RAISE(ABORT, 'Injected revision failure'); END`,
  ];
  for (const trigger of triggers) {
    const inspection = await target.service.archive.inspect({ text });
    const before = rows(target.path);
    exec(target.path, trigger);
    await assert.rejects(target.service.archive.restore({ requestId: 'restore-fail', text, expectedDigest: inspection.digest,
      expectedHistoryRevision: inspection.currentHistoryRevision }), errorCode('STORAGE_FAILURE'), trigger);
    exec(target.path, 'DROP TRIGGER fail_import');
    assert.deepEqual(rows(target.path), before, trigger);
    // The exclusion ended. The current records stay usable.
    assert.equal((await target.service.workouts.inProgress())?.id, kept.id);
  }
  const inspection = await target.service.archive.inspect({ text });
  await target.service.archive.restore({ requestId: 'restore-fail', text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision });
  assert.deepEqual(await target.service.workouts.list(), await source.service.workouts.list());
});

test('new archive members obey read-only and expired-view rules', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-archive-view-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = SqliteWorkoutStore.open({ databasePath: join(directory, 'records.sqlite') });
  t.after(() => store.close());
  await assert.rejects(store.read(async (reader) => (reader as WorkoutWriter).replaceArchiveRecords({ workouts: [], receipts: [] })),
    errorCode('STORAGE_FAILURE'));
  let expired: WorkoutWriter | undefined;
  await store.write(async (writer) => { expired = writer; });
  for (const run of [() => expired!.listRequestReceipts(), () => expired!.countArchiveRecords(),
    () => expired!.replaceArchiveRecords({ workouts: [], receipts: [] })]) {
    await assert.rejects(run(), errorCode('STORAGE_FAILURE'));
  }
  assert.deepEqual(await store.read((reader) => reader.countArchiveRecords()), { workouts: 0, sets: 0, receipts: 0, inProgress: 0 });
});

test('export reads one coherent snapshot between queued writes', async (t) => {
  const { service } = await database(t);
  const first = service.workouts.create({ requestId: 'first', date: '2026-10-01' });
  const exporting = service.archive.export();
  const second = service.workouts.create({ requestId: 'second', date: '2026-10-02' });
  await Promise.all([first, second]);
  const exported = await exporting;
  assert.deepEqual(exported.counts, { workouts: 1, sets: 0, receipts: 1, inProgress: 0 });
  assert.match(exported.text, /"requestId":"first"/);
  assert.doesNotMatch(exported.text, /"requestId":"second"/);
});

test('the Node service exposes the archive through its own composition root', async (t) => {
  const { service } = await database(t);
  const custom = createFormaService({ store: SqliteWorkoutStore.open({ databasePath: ':memory:' }), clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'x' } });
  t.after(() => custom.close());
  assert.equal((await service.archive.export()).counts.workouts, 0);
  assert.equal((await custom.archive.export()).createdAt, TEST_TIME);
});
