import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createFormaService } from '@forma/core';
import type { WorkoutWriter } from '@forma/core';
import { AndroidSqliteWorkoutStore, openAndroidForma } from '@forma/adapters/android';
import type { OpSqliteDatabase, OpSqliteOpener } from '@forma/adapters/android';
import { errorCode, TEST_TIME } from './helpers.js';
import { workoutContract } from './workout-contract.js';
import { requestContract } from './request-contract.js';
import { loadContract } from './load-contract.js';
import { sessionContract } from './session-contract.js';
import { historyContract } from './history-contract.js';

// This checks adapter mapping and lifecycle only. It does NOT establish Android readiness.
function shim(path: string, closed: () => void = () => {}): OpSqliteDatabase {
  const db = new DatabaseSync(path);
  return {
    executeSync: (sql, parameters = []) => {
      try { return { rows: db.prepare(sql).all(...parameters) }; }
      catch (cause) {
        if (cause !== null && typeof cause === 'object' && 'errcode' in cause && typeof cause.errcode === 'number') {
          throw Object.assign(new Error('Injected OP-style native failure', { cause }), {
            code: cause.errcode & 255, extendedCode: cause.errcode,
          });
        }
        throw cause;
      }
    },
    close: () => { db.close(); closed(); },
  };
}
let sequence = 0;
async function fixture(t: TestContext, ids?: readonly string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-android-binding-'));
  const name = 'fixture-' + ++sequence + '.sqlite';
  const openDatabase: OpSqliteOpener = ({ name }) => shim(join(directory, name));
  const store = AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase });
  let next = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME },
    ids: { next: () => { const id = ids?.[next]; next++; return id ?? 'id-' + next; } } });
  t.after(async () => { await service.close(); await rm(directory, { force: true, recursive: true }); });
  return { service, store, name, openDatabase };
}
workoutContract('Android binding, Node shim', fixture);
requestContract('Android binding, Node shim', fixture);
loadContract('Android binding, Node shim', fixture);
sessionContract('Android binding, Node shim', fixture);
historyContract('Android binding, Node shim', fixture);

test('the Android composition root injects its native binding, clock, and IDs', async (t) => {
  const name = 'composition-' + ++sequence;
  const service = openAndroidForma({ databaseName: name, openDatabase: () => shim(':memory:'),
    clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'host-id' } }); t.after(() => service.close());
  const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
  assert.equal(workout.id, 'host-id'); assert.equal(workout.createdAt, TEST_TIME);
});

test('Android database names reject paths and malformed options before opening native storage', () => {
  let calls = 0; const openDatabase = () => { calls++; return shim(':memory:'); };
  for (const name of ['', ' ', 'a/b.sqlite', '../records.sqlite', 'a\\b.sqlite', '.', '..', ' a', 'a ', 'x'.repeat(129)]) {
    assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase }), errorCode('INVALID_INPUT', 'databaseName'));
  }
  assert.throws(() => AndroidSqliteWorkoutStore.open(null as never), errorCode('INVALID_INPUT', 'input'));
  assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: 'valid', openDatabase: null as never }), errorCode('INVALID_INPUT', 'openDatabase'));
  assert.equal(calls, 0);
});

test('one Android owner persists through queued work and close before reopen', async (t) => {
  const item = await fixture(t);
  assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: item.name, openDatabase: item.openDatabase }), errorCode('CONFLICT', 'databaseName'));
  const accepted = item.service.workouts.create({ requestId: 'accepted', date: '2026-10-12' });
  const closing = item.service.close();
  assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: item.name, openDatabase: item.openDatabase }), errorCode('CONFLICT', 'databaseName'));
  const saved = await accepted; await closing;
  const reopened = AndroidSqliteWorkoutStore.open({ databaseName: item.name, openDatabase: item.openDatabase });
  try { assert.deepEqual(await reopened.read((reader) => reader.getWorkout(saved.id)), saved); }
  finally { await reopened.close(); }
});

test('Android native close is idempotent and releases the database exactly once', async () => {
  let closes = 0;
  const store = AndroidSqliteWorkoutStore.open({ databaseName: 'once-' + ++sequence, openDatabase: () => shim(':memory:', () => { closes++; }) });
  await Promise.all([store.close(), store.close()]); await store.close(); assert.equal(closes, 1);
  await assert.rejects(store.read((reader) => reader.getHistoryRevision()), errorCode('SERVICE_CLOSED'));
});

test('an Android open failure releases ownership and preserves its cause', async () => {
  const name = 'open-failure-' + ++sequence; const cause = new Error('Cannot open');
  assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => { throw cause; } }),
    (error) => errorCode('STORAGE_FAILURE')(error) && (error as Error).cause === cause);
  const store = AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => shim(':memory:') }); await store.close();
});

test('Android initialization failure closes the native handle and permits a corrected reopen', async () => {
  const name = 'migration-failure-' + ++sequence; let closes = 0;
  const native = shim(':memory:', () => { closes++; }); const original = native.executeSync;
  native.executeSync = (sql, parameters) => {
    if (sql.startsWith('CREATE TABLE workouts')) throw new Error('Injected migration failure');
    return original(sql, parameters);
  };
  assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => native }), errorCode('STORAGE_FAILURE'));
  assert.equal(closes, 1);
  const store = AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => shim(':memory:') }); await store.close();
});

test('unknown Android close state retains ownership until a runtime restart', async () => {
  const name = 'close-failure-' + ++sequence;
  const native = shim(':memory:'); const cleanup = native.close;
  native.close = () => { throw new Error('Unknown native close state'); };
  const store = AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => native });
  try {
    await assert.rejects(store.close(), errorCode('STORAGE_FAILURE'));
    assert.throws(() => AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => shim(':memory:') }), errorCode('CONFLICT', 'databaseName'));
  } finally { cleanup(); }
});

test('Android unique IDs translate extended errors to CONFLICT without partial writes', async () => {
  const name = 'unique-' + ++sequence;
  const store = AndroidSqliteWorkoutStore.open({ databaseName: name, openDatabase: () => shim(':memory:') });
  const make = (id: string) => ({ id, date: '2026-10-12', splitDayId: null, notes: '', durationMin: null,
    createdAt: TEST_TIME, updatedAt: TEST_TIME, status: 'finished' as const, finishedAt: null,
    sets: [{ id: 'shared-set', exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: null, position: 0,
      loadConvention: 'entered' as const, implementCount: null }] });
  try {
    await store.write(async (writer) => writer.saveWorkout(make('a')));
    const revision = await store.read((reader) => reader.getHistoryRevision());
    await assert.rejects(store.write(async (writer) => writer.saveWorkout(make('b'))), errorCode('CONFLICT'));
    assert.equal(await store.read((reader) => reader.getWorkout('b')), null);
    assert.equal(await store.read((reader) => reader.getHistoryRevision()), revision);
  } finally { await store.close(); }
});

test('other Android SQLite constraints stay STORAGE_FAILURE, not invented ID conflicts', async () => {
  const native = shim(':memory:'); const original = native.executeSync;
  const store = AndroidSqliteWorkoutStore.open({ databaseName: 'constraint-' + ++sequence, openDatabase: () => native });
  try {
    for (const extendedCode of [275, 787, undefined]) {
      native.executeSync = (sql, parameters) => {
        if (sql.startsWith('SELECT * FROM exercises')) throw Object.assign(new Error('Constraint'), { code: 19, extendedCode });
        return original(sql, parameters);
      };
      await assert.rejects(store.read((reader) => reader.listExercises()), errorCode('STORAGE_FAILURE'));
    }
  } finally { await store.close(); }
});

test('Android views are read-only and expire after the callback', async (t) => {
  const item = await fixture(t); let expired: WorkoutWriter | undefined;
  await item.store.write(async (writer) => { expired = writer; }); assert(expired);
  await assert.rejects(expired.getHistoryRevision(), errorCode('STORAGE_FAILURE'));
  await assert.rejects(item.store.read((reader) => (reader as WorkoutWriter).deleteWorkout('a')),
    errorCode('STORAGE_FAILURE'));
});

test('Android queries bind hostile text and never execute it as SQL', async (t) => {
  const item = await fixture(t);
  const notes = "'); DROP TABLE exercises; -- 🏋";
  const workout = await item.service.workouts.create({ requestId: 'text', date: '2026-10-12', notes });
  assert.equal((await item.service.workouts.get(workout.id)).notes, notes);
  assert.equal((await item.service.exercises.list()).length, 19);
});
