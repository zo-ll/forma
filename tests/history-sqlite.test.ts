import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openNodeForma, SqliteWorkoutStore } from '@forma/adapters/node';
import { SQLITE_MIGRATIONS, runSqliteMigrations } from '@forma/adapters/sqlite';
import type { FormaService, WorkoutWriter } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';
import { migrationDriver } from './sqlite-helpers.js';

async function pathFor(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'forma-history-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  return join(directory, 'records.sqlite');
}
function inspect(path: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path);
  try { run(db); } finally { db.close(); }
}

test('history cursors survive reopen but primary SQL changes invalidate them', async (t) => {
  const path = await pathFor(t);
  let service: FormaService = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  for (let day = 1; day <= 3; day++) await service.workouts.create({ requestId: 'create-' + day, date: '2026-10-0' + day });
  const first = await service.workouts.history({ limit: 1 }); assert(first.nextCursor);
  await service.close(); service = openNodeForma({ databasePath: path });
  const next = await service.workouts.history({ limit: 1, cursor: first.nextCursor });
  assert.equal(next.items[0]?.date, '2026-10-02'); assert.equal(next.revision, first.revision);
  inspect(path, (db) => db.prepare('UPDATE workouts SET notes = ? WHERE date = ?').run('Changed', '2026-10-01'));
  await assert.rejects(service.workouts.history({ cursor: first.nextCursor }), errorCode('CONFLICT', 'cursor'));
});

test('failed writes roll back history revision and preserve continuation cursors', async (t) => {
  const path = await pathFor(t);
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const a = await service.workouts.create({ requestId: 'a', date: '2026-10-01' });
  await service.workouts.create({ requestId: 'b', date: '2026-10-02' });
  const first = await service.workouts.history({ limit: 1 }); assert(first.nextCursor);
  inspect(path, (db) => db.exec("CREATE TRIGGER fail_history_write BEFORE INSERT ON request_receipts WHEN NEW.request_id = 'fail' BEGIN SELECT RAISE(ABORT, 'Injected failure'); END"));
  await assert.rejects(service.workouts.update({ requestId: 'fail', workoutId: a.id, notes: 'Must roll back' }), errorCode('STORAGE_FAILURE'));
  const next = await service.workouts.history({ cursor: first.nextCursor });
  assert.equal(next.revision, first.revision); assert.equal(next.items[0]?.notes, '');
});

test('set triggers invalidate cursors on direct insert, update, and delete', async (t) => {
  const path = await pathFor(t);
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'a', date: '2026-10-01' });
  await service.workouts.create({ requestId: 'b', date: '2026-10-02' });
  let page = await service.workouts.history({ limit: 1 }); assert(page.nextCursor);
  inspect(path, (db) => db.prepare('INSERT INTO sets (id, workout_id, exercise_id, reps, weight_kg, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run('direct-set', workout.id, 'leg-curls', 8, 20, 0));
  await assert.rejects(service.workouts.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
  page = await service.workouts.history({ limit: 1 }); assert(page.nextCursor);
  inspect(path, (db) => db.prepare('UPDATE sets SET reps = ? WHERE id = ?').run(10, 'direct-set'));
  await assert.rejects(service.workouts.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
  page = await service.workouts.history({ limit: 1 }); assert(page.nextCursor);
  inspect(path, (db) => db.prepare('DELETE FROM sets WHERE id = ?').run('direct-set'));
  await assert.rejects(service.workouts.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
});

test('schema 4 upgrade preserves primary records and receipts and starts history revision at zero', async (t) => {
  const path = await pathFor(t); let before: unknown;
  inspect(path, (db) => {
    runSqliteMigrations(migrationDriver(db), SQLITE_MIGRATIONS.slice(0, 4));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('old', '2024-02-29', 'upper', 'Keep exact note', 30.5, TEST_TIME, TEST_TIME, 'finished', null);
    db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('set', 'old', 'incline-dumbbell-press', 8, 22.5, 7.5, 0, 'per-hand', 2);
    db.prepare('INSERT INTO request_receipts VALUES (?, ?, ?, ?, ?)').run('old-receipt', 'workouts.deleteSet', '{}', 'null', 1);
    before = ['workouts', 'sets', 'request_receipts'].map((name) => db.prepare('SELECT * FROM ' + name).all());
  });
  const service = openNodeForma({ databasePath: path }); t.after(() => service.close());
  const page = await service.workouts.history(); assert.equal(page.revision, 0); assert.equal(page.items[0]?.sets[0]?.implementCount, 2);
  const statistics = await service.workouts.statistics({ exerciseId: 'incline-dumbbell-press', dateFrom: '2024-02-29', dateTo: '2024-02-29' });
  assert.equal(statistics.groups[0]?.volume.value, 360);
  inspect(path, (db) => {
    assert.deepEqual(['workouts', 'sets', 'request_receipts'].map((name) => db.prepare('SELECT * FROM ' + name).all()), before);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, SQLITE_MIGRATIONS.length);
    assert.equal(db.prepare('SELECT count(*) AS count FROM exercises').get()?.count, 19);
  });
});

test('a failed history migration rolls back its table, triggers, index, and version marker', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const driver = migrationDriver(db);
    runSqliteMigrations(driver, SQLITE_MIGRATIONS.slice(0, 4));
    db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('old', '2024-02-29', 'upper', 'Keep', 30, TEST_TIME, TEST_TIME, 'finished', null);
    const before = db.prepare('SELECT * FROM workouts').all();
    assert.throws(() => runSqliteMigrations({ ...driver, execute: (statement) => {
      if (statement.sql.startsWith('CREATE INDEX workouts_history')) throw new Error('Injected final statement failure');
      return driver.execute(statement);
    } }, SQLITE_MIGRATIONS), errorCode('STORAGE_FAILURE'));
    assert.equal(driver.getVersion(), 4); assert.deepEqual(db.prepare('SELECT * FROM workouts').all(), before);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'workout_history_state' OR name = 'workouts_history' OR name LIKE 'history_%'").get()?.count, 0);
    assert.deepEqual(runSqliteMigrations(driver, SQLITE_MIGRATIONS), SQLITE_MIGRATIONS.slice(4).map((m) => m.version));
  } finally { db.close(); }
});

test('history revision exhaustion fails atomically instead of losing precision', async (t) => {
  const path = await pathFor(t);
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'a', date: '2026-10-01' });
  inspect(path, (db) => db.prepare('UPDATE workout_history_state SET revision = ? WHERE id = 1').run(Number.MAX_SAFE_INTEGER));
  await assert.rejects(service.workouts.update({ requestId: 'overflow', workoutId: workout.id, notes: 'Must roll back' }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await service.workouts.get(workout.id), workout);
  assert.equal((await service.workouts.history()).revision, Number.MAX_SAFE_INTEGER);
  inspect(path, (db) => assert.equal(db.prepare("SELECT count(*) AS count FROM request_receipts WHERE request_id = 'overflow'").get()?.count, 0));
});

test('history reader methods reject expired transaction views', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' }); t.after(() => store.close());
  let expired: WorkoutWriter | undefined; await store.write(async (writer) => { expired = writer; }); assert(expired);
  await assert.rejects(expired.getHistoryRevision(), errorCode('STORAGE_FAILURE'));
  await assert.rejects(expired.listHistoryWorkouts({ filter: { dateFrom: null, dateTo: null, exerciseId: null, status: 'finished' },
    after: null, limit: 1, sets: 'all' }), errorCode('STORAGE_FAILURE'));
});

test('new history queries do not use successful request snapshots as primary records', async (t) => {
  const path = await pathFor(t);
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'a', date: '2026-10-01' });
  const input = { requestId: 'add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, loadConvention: 'entered' as const };
  await service.workouts.addSet(input);
  await service.workouts.delete({ requestId: 'delete', workoutId: workout.id });
  await service.workouts.addSet(input);
  assert.deepEqual((await service.workouts.history()).items, []);
  const statistics = await service.workouts.statistics({ exerciseId: 'leg-curls', dateFrom: '2026-10-01', dateTo: '2026-10-12' });
  assert.equal(statistics.setCount.value, 0); assert.deepEqual(statistics.groups, []);
  inspect(path, (db) => assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts').get()?.count, 3));
});

test('metadata-only lookahead does not spend the returned page set budget', async (t) => {
  const path = await pathFor(t);
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(() => service.close());
  const early = await service.workouts.create({ requestId: 'a', date: '2026-10-01' });
  const late = await service.workouts.create({ requestId: 'b', date: '2026-10-02' });
  inspect(path, (db) => {
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT INTO sets (id, workout_id, exercise_id, reps, weight_kg, position, load_convention) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const workout of [early, late]) for (let position = 0; position < 6000; position++) {
        insert.run(workout.id + '-' + position, workout.id, 'leg-curls', 1, 1, position, 'entered');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  await assert.rejects(service.workouts.history({ limit: 2 }), errorCode('INVALID_INPUT', 'limit'));
  const page = await service.workouts.history({ limit: 1 }); assert(page.nextCursor);
  assert.equal(page.items[0]?.sets.length, 6000);
  const next = await service.workouts.history({ limit: 1, cursor: page.nextCursor });
  assert.equal(next.items[0]?.sets.length, 6000); assert.equal(next.nextCursor, null);
  await assert.rejects(service.workouts.statistics({ exerciseId: 'leg-curls', dateFrom: '2026-10-01', dateTo: '2026-10-02' }),
    errorCode('INVALID_INPUT', 'dateRange'));
});

test('released version 4 session migration has a fixed digest', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(SQLITE_MIGRATIONS[3])).digest('hex'),
    'bbaa9970d291d4775afb28509a60325167b775ef55e4617aa2ede48e94a0cf20');
});
