import { AndroidSqliteWorkoutStore } from '@forma/adapters/android';
import type { OpSqliteDatabase, OpSqliteOpener } from '@forma/adapters/android';
import { createFormaService, createNotesModule } from '@forma/core';
import type { FormaService, WorkoutWriter } from '@forma/core';
import { runSqliteMigrations, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import type { MigrationDriver } from '@forma/adapters/sqlite';
import { TEST_TIME, errorCode } from './contract-helpers.js';
import { createPortableAssert } from './portable-assert.js';
import type { ContractAssert } from './contract-types.js';

const assert: ContractAssert = createPortableAssert();
let sequence = 0;
export function nativeDatabaseName(): string { return 'fixture-' + Date.now().toString(36) + '-' + ++sequence + '.sqlite'; }
export interface NativeFixture {
  readonly service: FormaService;
  readonly store: AndroidSqliteWorkoutStore;
  readonly native: OpSqliteDatabase;
  readonly name: string;
}
export function nativeFixture(open: OpSqliteOpener, ids?: readonly string[], name = nativeDatabaseName()): NativeFixture {
  let native: OpSqliteDatabase | undefined;
  const store = AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: (options) => { native = open(options); return native; } });
  assert(native);
  let next = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME },
    ids: { next: () => { const id = ids?.[next]; next++; return id ?? 'native-id-' + next; } } });
  return { service, store, native, name };
}
/** A standalone owner, not a second lifetime attached to nativeFixture().service. */
export function nativeNotesFixture(open: OpSqliteOpener) {
  const store = AndroidSqliteWorkoutStore.open({ databaseName: nativeDatabaseName(), openDatabase: open });
  let next = 0;
  return createNotesModule({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'native-note-' + ++next } });
}

function driver(db: OpSqliteDatabase): MigrationDriver {
  return {
    getVersion: () => Number(db.executeSync('PRAGMA user_version').rows[0]?.user_version),
    beginImmediate: () => { db.executeSync('BEGIN IMMEDIATE'); },
    execute: ({ sql, parameters }) => { db.executeSync(sql, parameters === undefined ? undefined : [...parameters]); },
    setVersion: (version) => { db.executeSync('PRAGMA user_version = ' + version); },
    commit: () => { db.executeSync('COMMIT'); }, rollback: () => { db.executeSync('ROLLBACK'); },
  };
}
function withDatabase(open: OpSqliteOpener, name: string, run: (db: OpSqliteDatabase) => void): void {
  const db = open({ name }); try { run(db); } finally { db.close(); }
}
export interface NativeStorageCase { readonly name: string; run(open: OpSqliteOpener): Promise<void>; }
export const NATIVE_STORAGE_CASES: readonly NativeStorageCase[] = [
  { name: 'native pragmas, SQLite version, and schema are supported', async run(open) {
    const f = nativeFixture(open);
    try {
      assert.equal(f.native.executeSync('PRAGMA foreign_keys').rows[0]?.foreign_keys, 1);
      assert.equal(f.native.executeSync('PRAGMA journal_mode').rows[0]?.journal_mode, 'wal');
      assert.equal(f.native.executeSync('PRAGMA busy_timeout').rows[0]?.timeout, 5000);
      assert.equal(f.native.executeSync('PRAGMA user_version').rows[0]?.user_version, SQLITE_MIGRATIONS.length);
      const version = String(f.native.executeSync('SELECT sqlite_version() AS version').rows[0]?.version).split('.').map(Number);
      assert((version[0] ?? 0) > 3 || (version[0] === 3 && (version[1] ?? 0) >= 37));
    } finally { await f.service.close(); }
  } },
  { name: 'native receipt failure rolls back records, receipts, and history revision', async run(open) {
    const f = nativeFixture(open);
    try {
      const workout = await f.service.workouts.create({ requestId: 'create', date: '2026-10-12' });
      const before = await f.service.workouts.history();
      f.native.executeSync("CREATE TRIGGER inject_receipt_failure BEFORE INSERT ON request_receipts WHEN NEW.request_id = 'fail' BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
      await assert.rejects(f.service.workouts.addSet({ requestId: 'fail', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 }), errorCode('STORAGE_FAILURE'));
      assert.deepEqual(await f.service.workouts.get(workout.id), workout);
      assert.deepEqual(await f.service.workouts.history(), before);
      assert.equal(f.native.executeSync("SELECT count(*) AS count FROM request_receipts WHERE request_id = 'fail'").rows[0]?.count, 0);
      f.native.executeSync('DROP TRIGGER inject_receipt_failure');
      await f.service.workouts.addSet({ requestId: 'fail', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
      assert.equal((await f.service.workouts.get(workout.id)).sets.length, 1);
    } finally { await f.service.close(); }
  } },
  { name: 'native callback failures roll back completed saves', async run(open) {
    const f = nativeFixture(open);
    try {
      const workout = await f.service.workouts.create({ requestId: 'create', date: '2026-10-12' });
      const revision = await f.store.read((reader) => reader.getHistoryRevision());
      await assert.rejects(f.store.write(async (writer) => { await writer.saveWorkout({ ...workout, notes: 'Must roll back' }); throw new Error('Injected callback'); }), errorCode('STORAGE_FAILURE'));
      assert.deepEqual(await f.service.workouts.get(workout.id), workout);
      assert.equal(await f.store.read((reader) => reader.getHistoryRevision()), revision);
    } finally { await f.service.close(); }
  } },
  { name: 'native unique errors translate to CONFLICT with verified native evidence', async run(open) {
    const f = nativeFixture(open);
    try {
      const a = await f.service.workouts.create({ requestId: 'a', date: '2026-10-12' });
      const b = await f.service.workouts.create({ requestId: 'b', date: '2026-10-11' });
      const set = await f.service.workouts.addSet({ requestId: 'set', workoutId: a.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
      const revision = await f.store.read((reader) => reader.getHistoryRevision());
      await assert.rejects(f.store.write(async (writer) => writer.saveWorkout({ ...b, sets: [set] })), (error) => {
        const cause = (error as Error).cause as { code?: number; extendedCode?: number; message?: string } | undefined;
        const numeric = cause?.code === 19 && (cause.extendedCode === 1555 || cause.extendedCode === 2067);
        const messageOnly = cause?.extendedCode === undefined && typeof cause?.message === 'string'
          && /^(?:Exception in HostFunction: )?\[op-sqlite\] statement execution error: UNIQUE constraint failed: sets\.id$/.test(cause.message);
        if (!errorCode('CONFLICT')(error) || (!numeric && !messageOnly)) {
          throw new Error('Native unique diagnostic: public=' + String((error as { code?: string }).code)
            + ', code=' + String(cause?.code) + ', extendedCode=' + String(cause?.extendedCode) + ', message=' + String(cause?.message));
        }
        return true;
      });
      assert.deepEqual(await f.service.workouts.get(b.id), b);
      assert.equal(await f.store.read((reader) => reader.getHistoryRevision()), revision);
    } finally { await f.service.close(); }
  } },
  { name: 'native CHECK errors stay STORAGE_FAILURE rather than ID conflicts', async run(open) {
    const f = nativeFixture(open);
    try {
      const workout = await f.service.workouts.create({ requestId: 'create', date: '2026-10-12' });
      await assert.rejects(f.store.write(async (writer) => writer.saveWorkout({ ...workout, durationMin: -1 })), (error) => {
        if (!errorCode('STORAGE_FAILURE')(error)) return false;
        const cause = (error as Error).cause as { code?: number; extendedCode?: number; message?: string } | undefined;
        return (cause?.code === 19 && cause.extendedCode === 275)
          || (cause?.extendedCode === undefined && typeof cause?.message === 'string'
            && /^(?:Exception in HostFunction: )?\[op-sqlite\] statement execution error: CHECK constraint failed: /.test(cause.message));
      });
      assert.deepEqual(await f.service.workouts.get(workout.id), workout);
    } finally { await f.service.close(); }
  } },
  { name: 'native reads hold a coherent snapshot and serialize subsequent writes', async run(open) {
    const f = nativeFixture(open);
    try {
      const workout = await f.service.workouts.create({ requestId: 'create', date: '2026-10-12' });
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const ready = new Promise<void>((resolve) => { entered = resolve; });
      const read = f.store.read(async (reader) => { const first = await reader.getWorkout(workout.id); entered(); await gate;
        assert.deepEqual(await reader.getWorkout(workout.id), first); });
      await ready;
      const write = f.service.workouts.update({ requestId: 'edit', workoutId: workout.id, notes: 'After read' });
      release(); await read; await write;
      assert.equal((await f.service.workouts.get(workout.id)).notes, 'After read');
    } finally { await f.service.close(); }
  } },
  { name: 'native owner closes accepted work before exact reopen and receipt replay', async run(open) {
    const f = nativeFixture(open);
    assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: f.name, openDatabase: open }), errorCode('CONFLICT', 'databaseName'));
    const input = { requestId: 'create', date: '2026-10-12', notes: 'Exact 🏋 text', durationMin: 30.5 };
    const accepted = f.service.workouts.create(input); const closing = f.service.close();
    assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: f.name, openDatabase: open }), errorCode('CONFLICT', 'databaseName'));
    const saved = await accepted; await closing; await f.service.close();
    const reopened = nativeFixture(open, undefined, f.name);
    try {
      assert.deepEqual(await reopened.service.workouts.get(saved.id), saved);
      assert.deepEqual(await reopened.service.workouts.create(input), saved);
    } finally { await reopened.service.close(); }
  } },
  { name: 'native read views reject writes and all views expire', async run(open) {
    const f = nativeFixture(open);
    try {
      let expired: WorkoutWriter | undefined;
      await f.store.write(async (writer) => { expired = writer; }); assert(expired);
      await assert.rejects(expired.getHistoryRevision(), errorCode('STORAGE_FAILURE'));
      await assert.rejects(f.store.read((reader) => (reader as WorkoutWriter).deleteWorkout('missing')), errorCode('STORAGE_FAILURE'));
    } finally { await f.service.close(); }
  } },
  { name: 'native version 4 upgrade preserves exact records, receipts, and load facts', async run(open) {
    const name = nativeDatabaseName(); let original: unknown;
    withDatabase(open, name, (db) => {
      runSqliteMigrations(driver(db), SQLITE_MIGRATIONS.slice(0, 4));
      db.executeSync('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['old', '2024-02-29', 'upper', 'Legacy exact 🏋', 30.5, TEST_TIME, TEST_TIME, 'finished', null]);
      db.executeSync('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['old-set', 'old', 'incline-dumbbell-press', 8, 22.5, 7.5, 0, 'per-hand', 2]);
      db.executeSync('INSERT INTO request_receipts VALUES (?, ?, ?, ?, ?)', ['old-receipt', 'workouts.deleteSet', '{}', 'null', 1]);
      original = ['workouts', 'sets', 'request_receipts'].map((table) => db.executeSync('SELECT * FROM ' + table).rows);
    });
    const f = nativeFixture(open, undefined, name);
    try {
      assert.deepEqual(['workouts', 'sets', 'request_receipts'].map((table) => f.native.executeSync('SELECT * FROM ' + table).rows), original);
      assert.equal((await f.service.workouts.history()).revision, 0);
      const result = await f.service.workouts.statistics({ exerciseId: 'incline-dumbbell-press', dateFrom: '2024-02-29', dateTo: '2024-02-29' });
      assert.equal(result.groups[0]?.volume.value, 360);
    } finally { await f.service.close(); }
  } },
  { name: 'native failed migration restores version and schema before a successful retry', async run(open) {
    const name = nativeDatabaseName();
    withDatabase(open, name, (db) => {
      runSqliteMigrations(driver(db), SQLITE_MIGRATIONS.slice(0, 4));
      db.executeSync('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['keep', '2024-02-29', null, 'Must survive', 30.5, TEST_TIME, TEST_TIME, 'finished', null]);
    });
    const fail: OpSqliteOpener = (options) => {
      const db = open(options);
      return { close: () => db.close(), executeSync: (sql, parameters) => {
        if (sql.startsWith('CREATE INDEX workouts_history')) throw new Error('Injected migration failure');
        return db.executeSync(sql, parameters);
      } };
    };
    assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: fail }), errorCode('STORAGE_FAILURE'));
    withDatabase(open, name, (db) => {
      assert.equal(db.executeSync('PRAGMA user_version').rows[0]?.user_version, 4);
      assert.equal(db.executeSync("SELECT notes FROM workouts WHERE id = 'keep'").rows[0]?.notes, 'Must survive');
      assert.equal(db.executeSync("SELECT count(*) AS count FROM sqlite_master WHERE name = 'workout_history_state' OR name LIKE 'history_%'").rows[0]?.count, 0);
    });
    const f = nativeFixture(open, undefined, name); try { assert.equal(f.native.executeSync('PRAGMA user_version').rows[0]?.user_version, SQLITE_MIGRATIONS.length); } finally { await f.service.close(); }
  } },
  { name: 'native newer schema rejection occurs before a changing pragma', async run(open) {
    const name = nativeDatabaseName();
    withDatabase(open, name, (db) => { db.executeSync('PRAGMA user_version = 99'); });
    const calls: string[] = [];
    const tracked: OpSqliteOpener = (options) => { const db = open(options); return {
      close: () => db.close(), executeSync: (sql, parameters) => { calls.push(sql); return db.executeSync(sql, parameters); },
    }; };
    assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: tracked }), errorCode('STORAGE_FAILURE'));
    assert.deepEqual(calls, ['PRAGMA user_version']);
    withDatabase(open, name, (db) => assert.equal(db.executeSync('PRAGMA user_version').rows[0]?.user_version, 99));
  } },
];

// Keep the service reachable and its native connection open until the host process is killed.
let retained: FormaService | undefined;
const restartName = 'process-restart.sqlite';
const startInput = { requestId: 'restart-start', date: '2026-10-12', splitDayId: 'upper', notes: 'Exact restart 🏋 note', durationMin: 45.5 };
const addInput = { requestId: 'restart-set', workoutId: 'restart-workout', exerciseId: 'incline-dumbbell-press', reps: 8,
  weightKg: 22.5, rpe: 7.5, loadConvention: 'per-hand' as const, implementCount: 2 as const };
export async function seedNativeRestart(open: OpSqliteOpener): Promise<void> {
  const f = nativeFixture(open, ['restart-workout', 'restart-set'], restartName); retained = f.service;
  f.native.executeSync('BEGIN IMMEDIATE');
  try {
    f.native.executeSync('DELETE FROM workouts'); f.native.executeSync('DELETE FROM request_receipts');
    f.native.executeSync('COMMIT');
  } catch (cause) { f.native.executeSync('ROLLBACK'); throw cause; }
  await f.service.workouts.start(startInput); await f.service.workouts.addSet(addInput);
  assert.equal((await f.service.workouts.inProgress())?.sets.length, 1);
  // Intentionally no close: the ADB host must force-stop this process before verification.
}
export async function verifyNativeRestart(open: OpSqliteOpener): Promise<void> {
  const f = nativeFixture(open, undefined, restartName);
  try {
    const expected = { id: 'restart-workout', date: '2026-10-12', splitDayId: 'upper', notes: 'Exact restart 🏋 note', durationMin: 45.5,
      createdAt: TEST_TIME, updatedAt: TEST_TIME, status: 'in-progress', finishedAt: null,
      sets: [{ id: 'restart-set', exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 22.5, rpe: 7.5, position: 0, loadConvention: 'per-hand', implementCount: 2 }] };
    assert.deepEqual(await f.service.workouts.get('restart-workout'), expected);
    assert.deepEqual(await f.service.workouts.resume('restart-workout'), expected);
    assert.deepEqual(await f.service.workouts.start(startInput), { ...expected, sets: [] });
    assert.deepEqual(await f.service.workouts.addSet(addInput), expected.sets[0]);
    assert.equal(f.native.executeSync('SELECT count(*) AS count FROM request_receipts').rows[0]?.count, 2);
  } finally { await f.service.close(); }
}
export function nativeRestartConnectionIsRetained(): boolean { return retained !== undefined; }
