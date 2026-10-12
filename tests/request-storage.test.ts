import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteWorkoutStore } from '@forma/adapters/node';
import type { RequestReceipt, Workout, WorkoutWriter } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';

const receipt: RequestReceipt = {
  requestId: 'storage-request', operation: 'future.test', inputSignature: '{"input":1}',
  resultJson: '{"answer":"ok"}', formatVersion: 1,
};
const workout: Workout = {
  id: 'storage-workout', date: '2026-10-12', splitDayId: 'lower', notes: 'Storage test',
  durationMin: null, createdAt: TEST_TIME, updatedAt: TEST_TIME, sets: [], status: 'finished', finishedAt: null,
};

test('the adapter stores a generic receipt without a module-specific schema', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  await store.write((writer) => writer.saveRequestReceipt(receipt));
  assert.deepEqual(await store.read((reader) => reader.getRequestReceipt(receipt.requestId)), receipt);
  assert.equal(await store.read((reader) => reader.getRequestReceipt('missing')), null);
});

test('receipt and primary record changes roll back after a callback failure', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  await assert.rejects(store.write(async (writer) => {
    await writer.saveWorkout(workout);
    await writer.saveRequestReceipt(receipt);
    throw new Error('Failure after both saves');
  }), errorCode('STORAGE_FAILURE'));
  assert.equal(await store.read((reader) => reader.getWorkout(workout.id)), null);
  assert.equal(await store.read((reader) => reader.getRequestReceipt(receipt.requestId)), null);
});

test('a duplicate receipt cannot replace its original result or commit a primary record', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  await store.write((writer) => writer.saveRequestReceipt(receipt));
  await assert.rejects(store.write(async (writer) => {
    await writer.saveWorkout(workout);
    await writer.saveRequestReceipt({ ...receipt, resultJson: 'null' });
  }), errorCode('CONFLICT'));
  assert.deepEqual(await store.read((reader) => reader.getRequestReceipt(receipt.requestId)), receipt);
  assert.equal(await store.read((reader) => reader.getWorkout(workout.id)), null);
});

test('receipt methods enforce read-only and expired transaction views', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: ':memory:' });
  t.after(() => store.close());
  await assert.rejects(store.read((reader) => (reader as WorkoutWriter).saveRequestReceipt(receipt)), errorCode('STORAGE_FAILURE'));
  let expired: WorkoutWriter | undefined;
  await store.write(async (writer) => { expired = writer; });
  assert(expired);
  await assert.rejects(expired.getRequestReceipt(receipt.requestId), errorCode('STORAGE_FAILURE'));
  await assert.rejects(expired.saveRequestReceipt(receipt), errorCode('STORAGE_FAILURE'));
  assert.equal(await store.read((reader) => reader.getRequestReceipt(receipt.requestId)), null);
});
