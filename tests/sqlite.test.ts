import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openNodeForma, SqliteWorkoutStore } from '@forma/adapters/node';
import { createFormaService } from '@forma/core';
import { runSqliteMigrations, SCHEMA_VERSION, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import { migrationDriver } from './sqlite-helpers.js';
import type { FormaService, WorkoutWriter } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';
import type { Fixture } from './helpers.js';
import { workoutContract } from './workout-contract.js';

interface SqliteFixture extends Fixture {
  readonly databasePath: string;
  reopen(): Promise<FormaService>;
}

async function sqliteFixture(t: TestContext): Promise<SqliteFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'forma-test-'));
  const databasePath = join(directory, 'workouts.sqlite');
  let next = 0;
  const open = (): FormaService => openNodeForma({
    databasePath, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id-' + ++next },
  });
  let service: FormaService;
  try { service = open(); }
  catch (cause) { await rm(directory, { recursive: true, force: true }); throw cause; }
  t.after(async () => {
    try { await service.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  return {
    databasePath,
    get service() { return service; },
    async reopen() {
      await service.close();
      service = open();
      return service;
    },
  };
}

workoutContract('Node SQLite adapter', sqliteFixture);

test('a real SQLite file retains exact records after close and reopen', async (t) => {
  const fixture = await sqliteFixture(t);
  const workout = await fixture.service.workouts.create({
    date: '2026-10-12', splitDayId: 'lower', notes: 'Persistence test', durationMin: 40,
  });
  const first = await fixture.service.workouts.addSet({
    workoutId: workout.id, exerciseId: 'leg-curls', reps: 10, weightKg: 25.5, rpe: 8.5,
  });
  const second = await fixture.service.workouts.addSet({
    workoutId: workout.id, exerciseId: 'leg-extensions', reps: 8, weightKg: 30,
  });
  await fixture.service.workouts.updateSet({ workoutId: workout.id, setId: second.id, reps: 9 });
  await fixture.service.workouts.deleteSet({ workoutId: workout.id, setId: first.id });
  const before = await fixture.service.workouts.get(workout.id);
  const reopened = await fixture.reopen();
  assert.deepEqual(await reopened.workouts.get(workout.id), before);
  assert.equal((await reopened.exercises.list()).length, 19);
  assert.equal((await reopened.splitDays.get('lower')).exerciseIds.length, 6);
});

test('existing version 1 records retain group_id through the receipt migration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-v1-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'workouts.sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    runSqliteMigrations(migrationDriver(db), SQLITE_MIGRATIONS.slice(0, 1));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
    db.prepare(
      'INSERT INTO workouts (id, date, group_id, notes, duration_min, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('existing-workout', '2026-10-12', 'lower', 'Existing workout', 40, TEST_TIME, TEST_TIME);
    db.prepare(
      'INSERT INTO sets (id, workout_id, exercise_id, reps, weight_kg, rpe, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('existing-set', 'existing-workout', 'leg-curls', 10, 20.5, 8, 0);
  } finally { db.close(); }

  const service = openNodeForma({ databasePath, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.get('existing-workout');
  assert.deepEqual(workout, {
    id: 'existing-workout', date: '2026-10-12', splitDayId: 'lower',
    notes: 'Existing workout', durationMin: 40, createdAt: TEST_TIME, updatedAt: TEST_TIME,
    sets: [{ id: 'existing-set', exerciseId: 'leg-curls', reps: 10, weightKg: 20.5, rpe: 8, position: 0 }],
  });
  assert.equal(Object.hasOwn(workout, 'groupId'), false);
  assert.equal((await service.splitDays.get('lower')).exerciseIds.length, 6);
  await service.workouts.updateSet({ workoutId: workout.id, setId: 'existing-set', weightKg: 25.5 });
  await service.close();

  const check = new DatabaseSync(databasePath);
  try {
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
    assert.equal(check.prepare('SELECT group_id FROM workouts WHERE id = ?').get(workout.id)?.group_id, 'lower');
    assert.equal(check.prepare('SELECT weight_kg FROM sets WHERE id = ?').get('existing-set')?.weight_kg, 25.5);
  } finally { check.close(); }
});

test('catalog and schema initialization do not duplicate records on reopen', async (t) => {
  const fixture = await sqliteFixture(t);
  await fixture.reopen();
  await fixture.reopen();
  const db = new DatabaseSync(fixture.databasePath);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT count(*) AS count FROM exercises').get()?.count, 19);
    assert.equal(db.prepare('SELECT count(*) AS count FROM workout_groups').get()?.count, 3);
    assert.equal(db.prepare('SELECT count(*) AS count FROM workout_group_exercises').get()?.count, 20);
  } finally { db.close(); }
});

test('a failed write rolls back both the workout and its sets', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  let next = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id-' + ++next } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ date: '2026-10-12', notes: 'Original' });
  await service.workouts.addSet({ workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  const before = await service.workouts.get(workout.id);
  await assert.rejects(store.write(async (writer) => {
    await writer.saveWorkout({ ...before, notes: 'Must roll back' });
    await writer.saveWorkout({
      ...before,
      sets: [{ id: 'invalid-reference', exerciseId: 'missing', reps: 8, weightKg: 20, rpe: null, position: 0 }],
    });
  }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await service.workouts.get(workout.id), before);
  await service.workouts.addSet({ workoutId: workout.id, exerciseId: 'leg-curls', reps: 9, weightKg: 20 });
  assert.equal((await service.workouts.get(workout.id)).sets.length, 2);
});

test('a callback failure rolls back a completed save', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id' } });
  const workout = await service.workouts.create({ date: '2026-10-12', notes: 'Original' });
  await assert.rejects(store.write(async (writer) => {
    await writer.saveWorkout({ ...workout, notes: 'Changed' });
    throw new Error('Simulated failure after a save');
  }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await service.workouts.get(workout.id), workout);
});

test('duplicate set IDs across workouts have typed conflict errors and no partial write', async (t) => {
  const sequence = ['workout-1', 'workout-2', 'same-set', 'same-set', 'new-set'];
  const service = openNodeForma({
    databasePath: ':memory:', clock: { nowUtc: () => TEST_TIME },
    ids: { next: () => { const id = sequence.shift(); assert(id); return id; } },
  });
  t.after(() => service.close());
  const first = await service.workouts.create({ date: '2026-10-12' });
  const second = await service.workouts.create({ date: '2026-10-11' });
  await service.workouts.addSet({ workoutId: first.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  await assert.rejects(service.workouts.addSet({
    workoutId: second.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20,
  }), errorCode('CONFLICT'));
  assert.deepEqual(await service.workouts.get(second.id), second);
  assert.equal((await service.workouts.get(first.id)).sets.length, 1);
  await service.workouts.addSet({ workoutId: second.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  assert.equal((await service.workouts.get(second.id)).sets.length, 1);
});

test('service close drains already accepted write commands', async (t) => {
  const fixture = await sqliteFixture(t);
  const service = fixture.service;
  const workout = await service.workouts.create({ date: '2026-10-12' });
  const writes = Array.from({ length: 5 }, (_, index) => service.workouts.addSet({
    workoutId: workout.id, exerciseId: 'leg-curls', reps: index + 1, weightKg: 20,
  }));
  await Promise.all([...writes, service.close()]);
  const reopened = await fixture.reopen();
  assert.equal((await reopened.workouts.get(workout.id)).sets.length, 5);
});

test('read views reject a write and transaction views expire', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id' } });
  const workout = await service.workouts.create({ date: '2026-10-12' });
  await assert.rejects(store.read((reader) => (reader as WorkoutWriter).saveWorkout({ ...workout, notes: 'Not allowed' })),
    errorCode('STORAGE_FAILURE'));
  let expired: WorkoutWriter | undefined;
  await store.write(async (writer) => { expired = writer; });
  assert(expired);
  await assert.rejects(expired.getWorkout(workout.id), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await service.workouts.get(workout.id), workout);
});

test('a newer database schema is rejected without changes', async (t) => {
  const fixture = await sqliteFixture(t);
  await fixture.service.close();
  const db = new DatabaseSync(fixture.databasePath);
  db.exec('PRAGMA user_version = 999; CREATE TABLE future_data (value TEXT);');
  db.prepare('INSERT INTO future_data VALUES (?)').run('Retain this');
  db.close();
  assert.throws(() => SqliteWorkoutStore.open({ databasePath: fixture.databasePath }), errorCode('STORAGE_FAILURE'));
  const check = new DatabaseSync(fixture.databasePath);
  try {
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 999);
    assert.equal(check.prepare('SELECT value FROM future_data').get()?.value, 'Retain this');
    assert.equal(check.prepare('SELECT count(*) AS count FROM exercises').get()?.count, 19);
  } finally { check.close(); }
});

test('a failed initial migration leaves the original database intact', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-migration-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'old.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE exercises (legacy_value TEXT);');
  db.prepare('INSERT INTO exercises VALUES (?)').run('Original');
  db.close();
  assert.throws(() => SqliteWorkoutStore.open({ databasePath }), errorCode('STORAGE_FAILURE'));
  const check = new DatabaseSync(databasePath);
  try {
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 0);
    assert.equal(check.prepare('SELECT legacy_value FROM exercises').get()?.legacy_value, 'Original');
    assert.equal(check.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'sets'").get()?.count, 0);
  } finally { check.close(); }
});

test('SQL-shaped input remains a bound value, not executable SQL', async (t) => {
  const fixture = await sqliteFixture(t);
  const attack = "' OR 1=1; DROP TABLE exercises; --";
  await assert.rejects(fixture.service.exercises.get(attack), errorCode('NOT_FOUND', 'exerciseId'));
  await assert.rejects(fixture.service.exercises.resolveAlias(attack), errorCode('NOT_FOUND', 'alias'));
  assert.equal((await fixture.service.exercises.list()).length, 19);
});

test('Node adapter uses default clock and IDs when the host omits overrides', async (t) => {
  const service = openNodeForma({ databasePath: ':memory:' });
  t.after(() => service.close());
  const workout = await service.workouts.create({ date: '2026-10-12' });
  assert.match(workout.id, /^[a-f0-9-]{36}$/);
  assert.equal(new Date(workout.createdAt).toISOString(), workout.createdAt);
});

test('empty paths and database open failures have typed errors', () => {
  assert.throws(() => SqliteWorkoutStore.open({ databasePath: '' }), errorCode('INVALID_INPUT', 'databasePath'));
  assert.throws(() => SqliteWorkoutStore.open({ databasePath: '/dev/null/forma.sqlite' }), errorCode('STORAGE_FAILURE'));
});
