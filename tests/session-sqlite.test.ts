import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openNodeForma, SqliteWorkoutStore } from '@forma/adapters/node';
import { runSqliteMigrations, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import type { FormaService, Workout, WorkoutWriter } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';
import { migrationDriver } from './sqlite-helpers.js';

async function pathFor(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forma-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'records.sqlite');
}

function inspect(path: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path);
  try { run(db); } finally { db.close(); }
}

test('saved in-progress sets survive service shutdown and resume after reopen', async (t) => {
  const path = await pathFor(t);
  let service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const input = { requestId: 'start', date: '2026-10-11', splitDayId: 'upper' };
  const workout = await service.workouts.start(input);
  await service.workouts.addSet({ requestId: 'add', workoutId: workout.id, exerciseId: 'incline-dumbbell-press',
    reps: 8, weightKg: 22.5, loadConvention: 'per-hand', implementCount: 2, rpe: 7.5 });
  const saved = await service.workouts.get(workout.id);
  await service.close();
  service = openNodeForma({ databasePath: path, clock: { nowUtc: () => '2026-10-13T01:00:00.000Z' } });
  assert.deepEqual(await service.workouts.inProgress(), saved);
  assert.deepEqual(await service.workouts.resume(saved.id), saved);
  const finished = await service.workouts.finish({ requestId: 'finish', workoutId: saved.id });
  assert.equal(finished.date, '2026-10-11');
  assert.equal(finished.finishedAt, '2026-10-13T01:00:00.000Z');
  await service.close();
  service = openNodeForma({ databasePath: path });
  assert.deepEqual(await service.workouts.get(saved.id), finished);
  assert.equal(await service.workouts.inProgress(), null);
});

test('committed in-progress sets survive an abrupt process stop without service close', async (t) => {
  const path = await pathFor(t);
  const script = `
    import { openNodeForma } from '@forma/adapters/node';
    let id = 0;
    const service = openNodeForma({ databasePath: process.argv[1],
      clock: { nowUtc: () => '${TEST_TIME}' }, ids: { next: () => 'id-' + ++id } });
    const workout = await service.workouts.start({ requestId: 'process-start', date: '2026-10-12' });
    await service.workouts.addSet({ requestId: 'process-add', workoutId: workout.id,
      exerciseId: 'leg-curls', reps: 8, weightKg: 22.5, loadConvention: 'entered' });
    process.kill(process.pid, 'SIGKILL');
  `;
  const stopped = spawnSync(process.execPath, ['--input-type=module', '-e', script, path], { timeout: 15000 });
  assert.equal(stopped.error, undefined); assert.equal(stopped.signal, 'SIGKILL');
  const service = openNodeForma({ databasePath: path });
  t.after(() => service.close());
  const saved = await service.workouts.resume('id-1');
  assert.equal(saved.status, 'in-progress'); assert.equal(saved.finishedAt, null);
  assert.equal(saved.sets[0]?.weightKg, 22.5); assert.equal(saved.sets[0]?.loadConvention, 'entered');
  assert.deepEqual(await service.workouts.addSet({ requestId: 'process-add', workoutId: 'id-1',
    exerciseId: 'leg-curls', reps: 8, weightKg: 22.5, loadConvention: 'entered' }), saved.sets[0]);
});

test('schema 3 records gain finished state without losing confirmed loads or legacy receipts', async (t) => {
  const path = await pathFor(t);
  const oldWorkout = { id: 'old', date: '2024-02-29', splitDayId: null, notes: '', durationMin: null,
    createdAt: TEST_TIME, updatedAt: TEST_TIME, sets: [] };
  const inputSignature = '{"date":"2024-02-29","durationMin":null,"notes":"","splitDayId":null}';
  const resultJson = JSON.stringify(oldWorkout);
  inspect(path, (db) => {
    runSqliteMigrations(migrationDriver(db), SQLITE_MIGRATIONS.slice(0, 3));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)').run('old', '2024-02-29', 'upper', 'Keep 🏋', 40, TEST_TIME, TEST_TIME);
    db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('set', 'old', 'incline-dumbbell-press', 8, 22.5, 7.5, 0, 'per-hand', 2);
    db.prepare('INSERT INTO request_receipts VALUES (?, ?, ?, ?, ?)').run('old-create', 'workouts.create', inputSignature, resultJson, 1);
  });
  const service = openNodeForma({ databasePath: path,
    clock: { nowUtc: () => { assert.fail('Migration and replay must not use the clock'); } },
    ids: { next: () => { assert.fail('Migration and replay must not create IDs'); } } });
  t.after(() => service.close());
  const saved = await service.workouts.get('old');
  assert.equal(saved.status, 'finished'); assert.equal(saved.finishedAt, null);
  assert.equal(saved.date, '2024-02-29'); assert.equal(saved.notes, 'Keep 🏋'); assert.equal(saved.durationMin, 40);
  assert.equal(saved.createdAt, TEST_TIME); assert.equal(saved.updatedAt, TEST_TIME);
  assert.equal(saved.sets[0]?.loadConvention, 'per-hand'); assert.equal(saved.sets[0]?.implementCount, 2);
  assert.equal(saved.sets[0]?.weightKg, 22.5);
  assert.deepEqual(await service.workouts.create({ requestId: 'old-create', date: '2024-02-29' }),
    { ...oldWorkout, status: 'finished', finishedAt: null });
  inspect(path, (db) => {
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 4);
    assert.equal(db.prepare('SELECT input_signature FROM request_receipts').get()?.input_signature, inputSignature);
    assert.equal(db.prepare('SELECT result_json FROM request_receipts').get()?.result_json, resultJson);
  });
});

test('failure at the session index rolls back every version 4 schema change and old data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const driver = migrationDriver(db);
    runSqliteMigrations(driver, SQLITE_MIGRATIONS.slice(0, 3));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)').run('old', '2024-02-29', 'upper', 'Keep', 40, TEST_TIME, TEST_TIME);
    const before = db.prepare('SELECT * FROM workouts').all();
    let statements = 0;
    assert.throws(() => runSqliteMigrations({ ...driver, execute: (statement) => {
      if (++statements === 3) throw new Error('Injected index failure');
      return driver.execute(statement);
    } }, SQLITE_MIGRATIONS), errorCode('STORAGE_FAILURE'));
    assert.equal(driver.getVersion(), 3);
    assert.deepEqual(db.prepare('SELECT * FROM workouts').all(), before);
    assert.deepEqual(runSqliteMigrations(driver, SQLITE_MIGRATIONS), [4]);
  } finally { db.close(); }
});

for (const operation of ['start', 'update', 'finish', 'delete', 'discard'] as const) {
  test(operation + ' and its request receipt roll back together on a native failure', async (t) => {
    const path = await pathFor(t);
    const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
    t.after(() => service.close());
    const workout = operation === 'start' ? null : await service.workouts.start({ requestId: 'initial-start', date: '2026-10-12' });
    if (workout) await service.workouts.addSet({ requestId: 'initial-add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const before = await service.workouts.list();
    const requestId = 'fail-' + operation;
    const run = () => operation === 'start' ? service.workouts.start({ requestId, date: '2026-10-12' })
      : operation === 'update' ? service.workouts.update({ requestId, workoutId: workout!.id, notes: 'Must roll back' })
      : service.workouts[operation]({ requestId, workoutId: workout!.id });
    inspect(path, (db) => db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON request_receipts WHEN NEW.request_id LIKE 'fail-%' BEGIN SELECT RAISE(ABORT, 'Injected failure'); END"));
    await assert.rejects(run(), errorCode('STORAGE_FAILURE'));
    assert.deepEqual(await service.workouts.list(), before);
    inspect(path, (db) => {
      assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts WHERE request_id = ?').get(requestId)?.count, 0);
      db.exec('DROP TRIGGER fail_receipt');
    });
    const result = await run();
    assert.deepEqual(await run(), result);
  });
}

test('session command snapshots replay after reopen and whole-workout deletion', async (t) => {
  const path = await pathFor(t);
  let service: FormaService = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const start = { requestId: 'start', date: '2026-10-12' };
  const workout = await service.workouts.start(start);
  const update = { requestId: 'update', workoutId: workout.id, notes: 'Original edit' };
  const updated = await service.workouts.update(update);
  const finish = { requestId: 'finish', workoutId: workout.id };
  const finished = await service.workouts.finish(finish);
  const deletion = { requestId: 'delete', workoutId: workout.id };
  await service.workouts.delete(deletion);
  const secondStart = { requestId: 'second-start', date: '2026-10-13' };
  const second = await service.workouts.start(secondStart);
  const discard = { requestId: 'discard', workoutId: second.id };
  await service.workouts.discard(discard);
  await service.close();
  service = openNodeForma({ databasePath: path,
    clock: { nowUtc: () => { assert.fail('Replay clock'); } }, ids: { next: () => { assert.fail('Replay ID'); } } });
  assert.deepEqual(await service.workouts.start(start), workout);
  assert.deepEqual(await service.workouts.update(update), updated);
  assert.deepEqual(await service.workouts.finish(finish), finished);
  assert.equal(await service.workouts.delete(deletion), undefined);
  assert.deepEqual(await service.workouts.start(secondStart), second);
  assert.equal(await service.workouts.discard(discard), undefined);
  assert.deepEqual(await service.workouts.list(), []);
  inspect(path, (db) => {
    assert.equal(db.prepare('SELECT count(*) AS count FROM workouts').get()?.count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sets').get()?.count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts').get()?.count, 6);
  });
});

test('delete capabilities enforce read-only and expired transaction views', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  await assert.rejects(store.read((reader) => (reader as WorkoutWriter).deleteWorkout('missing')), errorCode('STORAGE_FAILURE'));
  let expired: WorkoutWriter | undefined;
  await store.write(async (writer) => { expired = writer; });
  assert(expired);
  await assert.rejects(expired.deleteWorkout('missing'), errorCode('STORAGE_FAILURE'));
  await assert.rejects(expired.getInProgressWorkout(), errorCode('STORAGE_FAILURE'));
});

test('SQL enforces one live session even through direct store writes', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  const first: Workout = { id: 'one', date: '2026-10-12', splitDayId: null, notes: '', durationMin: null,
    createdAt: TEST_TIME, updatedAt: TEST_TIME, sets: [], status: 'in-progress', finishedAt: null };
  await store.write((writer) => writer.saveWorkout(first));
  await assert.rejects(store.write((writer) => writer.saveWorkout({ ...first, id: 'two' })), errorCode('CONFLICT'));
  assert.deepEqual(await store.read((reader) => reader.getInProgressWorkout()), first);
  assert.equal(await store.read((reader) => reader.getWorkout('two')), null);
});

test('malformed session receipt metadata fails without altering primary records', async (t) => {
  const path = await pathFor(t);
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const input = { requestId: 'start', date: '2026-10-12' };
  const original = await service.workouts.start(input);
  const { status: _status, finishedAt: _time, ...legacy } = original;
  for (const corrupt of [legacy, { ...legacy, status: 'finished' }, { ...legacy, finishedAt: null },
    { ...original, status: 'paused' }, { ...original, finishedAt: TEST_TIME }]) {
    inspect(path, (db) => db.prepare("UPDATE request_receipts SET result_json = ? WHERE request_id = 'start'").run(JSON.stringify(corrupt)));
    await assert.rejects(service.workouts.start(input), errorCode('STORAGE_FAILURE'));
    assert.deepEqual(await service.workouts.get(original.id), original);
  }
});

test('released version 3 load migration has a fixed digest', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(SQLITE_MIGRATIONS[2])).digest('hex'),
    'd56d1918c7c95ac4db1d842350917ad102e96c032281b40783e347f2d75467fd');
});
