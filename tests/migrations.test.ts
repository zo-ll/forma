import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { pendingMigrations, runSqliteMigrations, SCHEMA_VERSION, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import type { MigrationDriver, SqliteMigration } from '@forma/adapters/sqlite';
import { FormaError } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';
import { migrationDriver as driverFor } from './sqlite-helpers.js';

const initial = SQLITE_MIGRATIONS.slice(0, 1);

function database(t: TestContext): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return db;
}

const version2: SqliteMigration = {
  version: 2, name: 'Add preferences',
  statements: [
    { sql: 'CREATE TABLE preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT' },
    { sql: 'INSERT INTO preferences VALUES (?, ?)', parameters: ['unit', 'kg'] },
  ],
};
const version3: SqliteMigration = {
  version: 3, name: 'Extend preferences',
  statements: [{ sql: 'ALTER TABLE preferences ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0' }],
};
const future = [...initial, version2, version3];

function primaryData(db: DatabaseSync): unknown {
  return ['exercises', 'exercise_aliases', 'workout_groups', 'workout_group_exercises', 'workouts', 'sets']
    .map((table) => ({ table, rows: db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all() }));
}

function addPersonalRecords(db: DatabaseSync): void {
  db.prepare('UPDATE exercises SET name = ? WHERE id = ?').run('My Cable Row', 'cable-row');
  db.prepare('UPDATE exercise_aliases SET normalized_alias = ?, alias = ? WHERE normalized_alias = ?')
    .run('my cable row', 'My Cable Row', 'cable row');
  db.prepare('INSERT INTO exercises VALUES (?, ?, ?, ?, ?)').run('personal-exercise', 'Personal Exercise', null, null, 19);
  db.prepare('INSERT INTO exercise_aliases VALUES (?, ?, ?)').run('personal exercise', 'Personal Exercise', 'personal-exercise');
  db.exec("DELETE FROM workout_group_exercises WHERE group_id = 'lower'");
  const lower = ['leg-curls', 'leg-extensions', 'hammer-curls', 'calf-raises', 'bulgarian-split-squat', 'hack-squat'];
  lower.forEach((id, position) => db.prepare('INSERT INTO workout_group_exercises VALUES (?, ?, ?)').run('lower', id, position));
  db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('saved-workout', '2026-10-12', 'lower', 'Retain this note', 40, TEST_TIME, TEST_TIME);
  db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('saved-set', 'saved-workout', 'leg-curls', 10, 25.5, 8.5, 0);
}

test('the released version 1 migration and catalog have a fixed digest', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(SQLITE_MIGRATIONS[0])).digest('hex'),
    'da6152dbcf761642b0cc76b20919dde7cc85f88a1801fe7a2fd2ad9f5c6208fc');
  assert.equal(SCHEMA_VERSION, SQLITE_MIGRATIONS.length);
  assert(Object.isFrozen(SQLITE_MIGRATIONS));
  assert(Object.isFrozen(SQLITE_MIGRATIONS[0]?.statements));
});

test('the shared SQLite entry point has no platform imports', async () => {
  for (const file of ['index.ts', 'migrations.ts', 'registry.ts', 'schema.ts', 'schema-v2.ts', 'schema-v3.ts']) {
    const source = await readFile('packages/adapters/src/sqlite/' + file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*(?:\(\s*)?['"]([^'"]+)['"]/gu)) {
      assert(match[1]?.startsWith('.') || match[1] === '@forma/core', 'Unexpected platform import: ' + match[1]);
    }
  }
});

test('migration drivers reject asynchronous operations at compile time', () => {
  // @ts-expect-error Migration drivers must return undefined, not a promise.
  const execute: MigrationDriver['execute'] = async () => {};
  assert.equal(typeof execute, 'function');
});

test('an empty database receives the initial catalog and one version marker', (t) => {
  const db = database(t);
  assert.deepEqual(runSqliteMigrations(driverFor(db), initial), [1]);
  assert.equal(driverFor(db).getVersion(), 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM exercises').get()?.count, 19);
  assert.equal(db.prepare('SELECT count(*) AS count FROM workout_groups').get()?.count, 3);
  assert.equal(db.prepare('SELECT count(*) AS count FROM workout_group_exercises').get()?.count, 20);
});

test('the registry works with a binding that executes one prepared statement at a time', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  runSqliteMigrations({
    ...driver,
    execute: (statement) => {
      db.prepare(statement.sql).run(...(statement.parameters ?? []));
      return undefined;
    },
  }, SQLITE_MIGRATIONS);
  assert.equal(driver.getVersion(), SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS count FROM exercises').get()?.count, 19);
  assert.equal(db.prepare('SELECT count(*) AS count FROM workout_group_exercises').get()?.count, 20);
});

test('several new versions apply in order without a catalog reset', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  runSqliteMigrations(driver, initial);
  addPersonalRecords(db);
  const before = primaryData(db);
  assert.deepEqual(runSqliteMigrations(driver, future), [2, 3]);
  assert.equal(driver.getVersion(), 3);
  assert.equal(db.prepare('SELECT value, confirmed FROM preferences').get()?.value, 'kg');
  assert.equal(db.prepare('SELECT confirmed FROM preferences').get()?.confirmed, 0);
  assert.deepEqual(primaryData(db), before);
});

test('an up-to-date database does not start a transaction or execute SQL', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  runSqliteMigrations(driver, initial);
  const before = primaryData(db);
  const guarded: MigrationDriver = {
    ...driver,
    beginImmediate: () => { assert.fail('Unexpected transaction'); },
    execute: () => { assert.fail('Unexpected SQL'); },
    setVersion: () => { assert.fail('Unexpected version change'); },
  };
  assert.deepEqual(runSqliteMigrations(guarded, initial), []);
  assert.deepEqual(primaryData(db), before);
});

test('a failure in a later version rolls back every pending version on a new database', (t) => {
  const db = database(t);
  const failed: SqliteMigration = { version: 3, name: 'Failure', statements: [{ sql: 'INVALID SQL' }] };
  assert.throws(() => runSqliteMigrations(driverFor(db), [...initial, version2, failed]), errorCode('STORAGE_FAILURE'));
  assert.equal(driverFor(db).getVersion(), 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get()?.count, 0);
  assert.deepEqual(runSqliteMigrations(driverFor(db), future), [1, 2, 3]);
});

test('a failed upgrade retains the old schema, personal records, and version', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  runSqliteMigrations(driver, initial);
  addPersonalRecords(db);
  const before = primaryData(db);
  const failed: SqliteMigration = { version: 3, name: 'Failure', statements: [{ sql: 'INSERT INTO missing_table VALUES (1)' }] };
  assert.throws(() => runSqliteMigrations(driver, [...initial, version2, failed]), errorCode('STORAGE_FAILURE'));
  assert.equal(driver.getVersion(), 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'preferences'").get()?.count, 0);
  assert.deepEqual(primaryData(db), before);
  assert.deepEqual(runSqliteMigrations(driver, future), [2, 3]);
  assert.deepEqual(primaryData(db), before);
});

test('a newer schema fails before any database write', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  runSqliteMigrations(driver, future);
  addPersonalRecords(db);
  const before = primaryData(db);
  const guarded: MigrationDriver = {
    ...driver,
    beginImmediate: () => { assert.fail('Unexpected transaction'); },
    execute: () => { assert.fail('Unexpected SQL'); },
    setVersion: () => { assert.fail('Unexpected version change'); },
  };
  assert.throws(() => runSqliteMigrations(guarded, initial), errorCode('STORAGE_FAILURE'));
  assert.equal(driver.getVersion(), 3);
  assert.deepEqual(primaryData(db), before);
});

for (const versions of [[0], [2], [1, 1], [1, 3], [2, 1], [1.5], [NaN]]) {
  test('invalid migration sequence ' + JSON.stringify(versions) + ' fails before a transaction', (t) => {
    const db = database(t);
    const driver = driverFor(db);
    const migrations = versions.map((version) => ({ version, name: 'Invalid', statements: [] }));
    assert.throws(() => runSqliteMigrations({
      ...driver, beginImmediate: () => { assert.fail('Unexpected transaction'); },
    }, migrations), errorCode('STORAGE_FAILURE'));
    assert.equal(driver.getVersion(), 0);
  });
}

for (const version of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test('invalid current version ' + String(version) + ' has a typed error', () => {
    assert.throws(() => pendingMigrations(version, initial), errorCode('STORAGE_FAILURE'));
  });
}

test('the runner rechecks the version after the write lock', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  runSqliteMigrations(driver, initial);
  let reads = 0;
  assert.deepEqual(runSqliteMigrations({
    ...driver,
    getVersion: () => ++reads === 1 ? 0 : driver.getVersion(),
    execute: () => { assert.fail('The initial migration must not run twice'); },
  }, initial), []);
  assert.equal(reads, 2);
  assert.equal(driver.getVersion(), 1);
});

test('a future version after lock acquisition causes rollback before migration SQL', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  let reads = 0;
  let rollbacks = 0;
  assert.throws(() => runSqliteMigrations({
    ...driver,
    getVersion: () => ++reads === 1 ? 0 : 2,
    execute: () => { assert.fail('Unexpected SQL'); },
    rollback: () => { rollbacks++; driver.rollback(); return undefined; },
  }, initial), errorCode('STORAGE_FAILURE'));
  assert.equal(rollbacks, 1);
});

test('a begin failure preserves its cause without an unnecessary rollback', (t) => {
  const db = database(t);
  const cause = new Error('Simulated lock failure');
  assert.throws(() => runSqliteMigrations({
    ...driverFor(db),
    beginImmediate: () => { throw cause; },
    rollback: () => { assert.fail('No transaction started'); },
  }, initial), (error: unknown) => error instanceof FormaError && error.cause === cause);
});

test('a commit failure rolls back schema and the version marker', (t) => {
  const db = database(t);
  const cause = new Error('Simulated commit failure');
  assert.throws(() => runSqliteMigrations({
    ...driverFor(db), commit: () => { throw cause; },
  }, initial), (error: unknown) => error instanceof FormaError && error.cause === cause);
  assert.equal(driverFor(db).getVersion(), 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get()?.count, 0);
});

test('a rollback failure does not replace the original migration error', (t) => {
  const db = database(t);
  const driver = driverFor(db);
  const cause = new Error('Original failure');
  assert.throws(() => runSqliteMigrations({
    ...driver,
    execute: () => { throw cause; },
    rollback: () => { driver.rollback(); throw new Error('Secondary failure'); },
  }, initial), (error: unknown) => error instanceof FormaError && error.cause === cause);
});

test('upgraded records survive close and reopen without another migration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'records.sqlite');
  const first = new DatabaseSync(path);
  let before: unknown;
  try {
    runSqliteMigrations(driverFor(first), initial);
    addPersonalRecords(first);
    before = primaryData(first);
    runSqliteMigrations(driverFor(first), future);
  } finally { first.close(); }
  const reopened = new DatabaseSync(path);
  try {
    assert.deepEqual(runSqliteMigrations(driverFor(reopened), future), []);
    assert.equal(driverFor(reopened).getVersion(), 3);
    assert.deepEqual(primaryData(reopened), before);
  } finally { reopened.close(); }
});
