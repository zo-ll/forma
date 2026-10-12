import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openNodeForma } from '@forma/adapters/node';
import { runSqliteMigrations, SCHEMA_VERSION, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import { calculateSetLoad } from '@forma/core';
import type { FormaService, WorkoutSet } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';
import { migrationDriver } from './sqlite-helpers.js';

function signature(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function inspect(path: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path);
  try { run(db); } finally { db.close(); }
}

test('version 2 upgrade preserves old command signatures, snapshots, and primary records', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-load-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  const db = new DatabaseSync(path);
  const create = { requestId: 'old-create', date: '2024-02-29' };
  const add = { requestId: 'old-add', workoutId: 'old-workout', exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
  const update = { requestId: 'old-update', workoutId: 'old-workout', setId: 'deleted-set', reps: 10 };
  const deletion = { requestId: 'old-delete', workoutId: 'old-workout', setId: 'deleted-set' };
  const legacySet = { id: 'deleted-set', exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: null, position: 0 };
  const legacyWorkout = { id: 'old-workout', date: '2024-02-29', splitDayId: null, notes: '', durationMin: null,
    createdAt: TEST_TIME, updatedAt: TEST_TIME, sets: [] };
  let beforeReceipts: unknown;
  try {
    runSqliteMigrations(migrationDriver(db), SQLITE_MIGRATIONS.slice(0, 2));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('old-workout', '2024-02-29', null, 'Keep exact note', 30, TEST_TIME, TEST_TIME);
    db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('current-set', 'old-workout', 'incline-dumbbell-press', 8, 22.5, 7.5, 0);
    const insert = db.prepare('INSERT INTO request_receipts VALUES (?, ?, ?, ?, ?)');
    insert.run(create.requestId, 'workouts.create', signature({ date: create.date, splitDayId: null, notes: '', durationMin: null }),
      JSON.stringify(legacyWorkout), 1);
    insert.run(add.requestId, 'workouts.addSet', signature({ workoutId: add.workoutId, exerciseId: add.exerciseId,
      reps: add.reps, weightKg: add.weightKg, rpe: null }), JSON.stringify(legacySet), 1);
    insert.run(update.requestId, 'workouts.updateSet', signature({ workoutId: update.workoutId, setId: update.setId, reps: 10 }),
      JSON.stringify({ ...legacySet, reps: 10 }), 1);
    insert.run(deletion.requestId, 'workouts.deleteSet', signature({ workoutId: deletion.workoutId, setId: deletion.setId }), 'null', 1);
    beforeReceipts = db.prepare('SELECT * FROM request_receipts ORDER BY request_id').all();
  } finally { db.close(); }

  let service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const original = await service.workouts.get('old-workout');
  assert.equal(original.date, '2024-02-29'); assert.equal(original.notes, 'Keep exact note');
  assert.equal(original.durationMin, 30); assert.equal(original.createdAt, TEST_TIME);
  const current = original.sets[0]; assert(current);
  assert.deepEqual(current, { id: 'current-set', exerciseId: 'incline-dumbbell-press', reps: 8,
    weightKg: 22.5, rpe: 7.5, position: 0, loadConvention: 'unknown', implementCount: null });
  assert.throws(() => calculateSetLoad(current), errorCode('INVALID_INPUT', 'loadConvention'));
  const confirm = { requestId: 'confirm-old', workoutId: original.id, setId: current.id,
    loadConvention: 'per-hand' as const, implementCount: 2 as const };
  const confirmed = await service.workouts.updateSet(confirm);
  await service.close();
  service = openNodeForma({ databasePath: path,
    clock: { nowUtc: () => { assert.fail('Replays must not use the clock'); } },
    ids: { next: () => { assert.fail('Replays must not generate IDs'); } } });
  assert.deepEqual((await service.workouts.get(original.id)).sets, [confirmed]);
  assert.deepEqual(await service.workouts.updateSet(confirm), confirmed);
  assert.deepEqual(await service.workouts.create(create), { ...legacyWorkout, status: 'finished', finishedAt: null });
  const unknown = { loadConvention: 'unknown', implementCount: null };
  assert.deepEqual(await service.workouts.addSet(add), { ...legacySet, ...unknown });
  assert.deepEqual(await service.workouts.updateSet(update), { ...legacySet, reps: 10, ...unknown });
  assert.equal(await service.workouts.deleteSet(deletion), undefined);
  await assert.rejects(service.workouts.addSet({ ...add, loadConvention: 'entered' }), errorCode('CONFLICT', 'requestId'));
  assert.deepEqual((await service.workouts.get(original.id)).sets, [confirmed]);
  await service.close();
  inspect(path, (check) => {
    assert.deepEqual(check.prepare("SELECT * FROM request_receipts WHERE request_id <> 'confirm-old' ORDER BY request_id").all(), beforeReceipts);
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
    assert.equal(check.prepare('SELECT count(*) AS count FROM exercises').get()?.count, 19);
    assert.equal(check.prepare('SELECT count(*) AS count FROM workout_group_exercises').get()?.count, 20);
  });
});

test('a failed version 3 statement rolls back both new columns and all old data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const driver = migrationDriver(db);
    runSqliteMigrations(driver, SQLITE_MIGRATIONS.slice(0, 2));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('saved', '2024-02-29', 'lower', 'Keep exact note', 40, TEST_TIME, TEST_TIME);
    db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('saved-set', 'saved', 'leg-curls', 8, 22.5, 7.5, 0);
    db.prepare('INSERT INTO request_receipts VALUES (?, ?, ?, ?, ?)')
      .run('saved-request', 'workouts.deleteSet', '{}', 'null', 1);
    const tables = ['exercises', 'exercise_aliases', 'workout_groups', 'workout_group_exercises', 'workouts', 'sets', 'request_receipts'];
    const data = () => tables.map((name) => db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all());
    const before = data();
    let statements = 0;
    assert.throws(() => runSqliteMigrations({ ...driver, execute: (statement) => {
      if (++statements === 2) throw new Error('Injected second-column failure');
      return driver.execute(statement);
    } }, SQLITE_MIGRATIONS.slice(0, 3)), errorCode('STORAGE_FAILURE'));
    assert.equal(driver.getVersion(), 2);
    assert.deepEqual(db.prepare('PRAGMA table_info(sets)').all().map((row) => row.name),
      ['id', 'workout_id', 'exercise_id', 'reps', 'weight_kg', 'rpe', 'position']);
    assert.deepEqual(data(), before);
    assert.deepEqual(runSqliteMigrations(driver, SQLITE_MIGRATIONS.slice(0, 3)), [3]);
  } finally { db.close(); }
});

test('schema version 3 rejects inconsistent metadata even through direct SQL', () => {
  const db = new DatabaseSync(':memory:');
  try {
    runSqliteMigrations(migrationDriver(db), SQLITE_MIGRATIONS.slice(0, 3));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)').run('w', '2026-10-12', null, '', null, TEST_TIME, TEST_TIME);
    const insert = db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [convention, count] of [['guessed', null], ['per-hand', null], ['per-hand', 3], ['entered', 2], ['unknown', 1]] as const) {
      assert.throws(() => insert.run('bad', 'w', 'leg-curls', 8, 20, null, 0, convention, count));
    }
    insert.run('ok', 'w', 'leg-curls', 8, 20, null, 0, 'per-hand', 2);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sets').get()?.count, 1);
  } finally { db.close(); }
});

test('load confirmation and its receipt roll back together on native receipt failure', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-load-rollback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
  const set = await service.workouts.addSet({ requestId: 'add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  const input = { requestId: 'confirm', workoutId: workout.id, setId: set.id, loadConvention: 'entered' as const };
  inspect(path, (db) => db.exec("CREATE TRIGGER fail_confirm BEFORE INSERT ON request_receipts WHEN NEW.request_id = 'confirm' BEGIN SELECT RAISE(ABORT, 'Injected failure'); END"));
  await assert.rejects(service.workouts.updateSet(input), errorCode('STORAGE_FAILURE'));
  assert.deepEqual((await service.workouts.get(workout.id)).sets, [set]);
  inspect(path, (db) => {
    assert.equal(db.prepare("SELECT count(*) AS count FROM request_receipts WHERE request_id = 'confirm'").get()?.count, 0);
    db.exec('DROP TRIGGER fail_confirm');
  });
  assert.equal((await service.workouts.updateSet(input)).loadConvention, 'entered');
});

test('every explicit load convention retains exact values and receipt results after reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-load-reopen-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  let service: FormaService = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
  const sets: WorkoutSet[] = [];
  const inputs = (['unknown', 'entered', 'combined', 'body-weight', 'per-hand'] as const).map((loadConvention) => ({
    requestId: loadConvention, workoutId: workout.id, exerciseId: 'leg-curls', reps: 8,
    weightKg: loadConvention === 'body-weight' ? 0 : 20.25, loadConvention,
    implementCount: loadConvention === 'per-hand' ? 2 as const : null,
  }));
  for (const input of inputs) sets.push(await service.workouts.addSet(input));
  const before = await service.workouts.get(workout.id);
  await service.close();
  service = openNodeForma({ databasePath: path, clock: { nowUtc: () => { assert.fail('Replay clock'); } } });
  assert.deepEqual(await service.workouts.get(workout.id), before);
  for (const [index, input] of inputs.entries()) assert.deepEqual(await service.workouts.addSet(input), sets[index]);
});

test('malformed load metadata in a persisted result fails without changing primary records', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-load-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
  const input = { requestId: 'add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
  const original = await service.workouts.addSet(input);
  const before = await service.workouts.get(workout.id);
  const { loadConvention: _convention, implementCount: _count, ...legacy } = original;
  const corrupt = [
    { ...legacy, loadConvention: 'entered' }, { ...legacy, implementCount: null },
    { ...original, loadConvention: 'per-hand', implementCount: null },
    { ...original, loadConvention: 'guessed' }, { ...original, implementCount: 2 },
  ];
  for (const value of corrupt) {
    inspect(path, (db) => db.prepare("UPDATE request_receipts SET result_json = ? WHERE request_id = 'add'").run(JSON.stringify(value)));
    await assert.rejects(service.workouts.addSet(input), errorCode('STORAGE_FAILURE'));
    assert.deepEqual(await service.workouts.get(workout.id), before);
  }
});

test('invalid primary load metadata produces a storage error rather than an inferred convention', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-load-row-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
  await service.workouts.addSet({ requestId: 'add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  inspect(path, (db) => {
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.exec("UPDATE sets SET load_convention = 'guessed'");
  });
  await assert.rejects(service.workouts.get(workout.id), errorCode('STORAGE_FAILURE'));
});

test('released version 2 receipt migration has a fixed digest', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(SQLITE_MIGRATIONS[1])).digest('hex'),
    '282e280427933fd56a59bb7802c1400b04382df5bc3f5455c51a21df6b46fdb8');
});
