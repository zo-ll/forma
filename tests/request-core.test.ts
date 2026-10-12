import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFormaService, FormaError, withRequest } from '@forma/core';
import type { RequestWriter, ResultCodec, WorkoutWriter } from '@forma/core';
import { errorCode, MemoryWorkoutStore, TEST_TIME } from './helpers.js';

test('all cached command kinds skip record saves, the clock, and ID generation', async (t) => {
  const store = new MemoryWorkoutStore();
  let clockCalls = 0;
  let idCalls = 0;
  let unavailable = false;
  const service = createFormaService({
    store,
    clock: { nowUtc: () => { if (unavailable) assert.fail('The replay must not use the clock'); clockCalls++; return TEST_TIME; } },
    ids: { next: () => { if (unavailable) assert.fail('The replay must not create an ID'); return 'id-' + ++idCalls; } },
  });
  t.after(() => service.close());
  const create = { requestId: 'count-create', date: '2026-10-12' };
  const workout = await service.workouts.create(create);
  const add = { requestId: 'count-add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
  const set = await service.workouts.addSet(add);
  const update = { requestId: 'count-update', workoutId: workout.id, setId: set.id, reps: 10 };
  const updated = await service.workouts.updateSet(update);
  const deletion = { requestId: 'count-delete', workoutId: workout.id, setId: set.id };
  await service.workouts.deleteSet(deletion);
  unavailable = true;
  await Promise.all(Array.from({ length: 10 }, async () => {
    assert.deepEqual(await service.workouts.create(create), workout);
    assert.deepEqual(await service.workouts.addSet(add), set);
    assert.deepEqual(await service.workouts.updateSet(update), updated);
    assert.equal(await service.workouts.deleteSet(deletion), undefined);
  }));
  assert.equal(store.saves, 4);
  assert.equal(clockCalls, 4);
  assert.equal(idCalls, 2);
  assert.equal(store.receipts.size, 4);
});

test('a receipt save failure rolls back the command and permits a safe retry', async (t) => {
  class FaultStore extends MemoryWorkoutStore {
    fail = true;
    override write<T>(run: (writer: WorkoutWriter) => Promise<T>): Promise<T> {
      return super.write((writer) => run({
        ...writer,
        saveRequestReceipt: async (receipt) => {
          if (this.fail) throw new FormaError('STORAGE_FAILURE', 'Simulated receipt failure.');
          await writer.saveRequestReceipt(receipt);
        },
      }));
    }
  }
  const store = new FaultStore();
  let id = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id-' + ++id } });
  t.after(() => service.close());
  const input = { requestId: 'retry-after-failure', date: '2026-10-12' };
  await assert.rejects(service.workouts.create(input), errorCode('STORAGE_FAILURE'));
  assert.equal(store.workouts.size, 0);
  assert.equal(store.receipts.size, 0);
  store.fail = false;
  const original = await service.workouts.create(input);
  assert.deepEqual(await service.workouts.create(input), original);
  assert.equal(store.workouts.size, 1);
  assert.equal(store.receipts.size, 1);
});

test('a result codec failure rolls back a generic module write', async (t) => {
  const store = new MemoryWorkoutStore();
  t.after(() => store.close());
  const codec: ResultCodec<string> = { parse: () => { throw new Error('Invalid result'); } };
  await assert.rejects(withRequest(store, 'invalid-result', 'generic.write', {}, codec, async (writer) => {
    await writer.saveWorkout({
      id: 'must-rollback', date: '2026-10-12', splitDayId: null, notes: '', durationMin: null,
      createdAt: TEST_TIME, updatedAt: TEST_TIME, sets: [], status: 'finished', finishedAt: null,
    });
    return 'result';
  }), errorCode('STORAGE_FAILURE'));
  assert.equal(store.workouts.size, 0);
  assert.equal(store.receipts.size, 0);
});

test('the shared mechanism supports a writer with no workout capabilities and nested input', async (t) => {
  const store = new MemoryWorkoutStore();
  t.after(() => store.close());
  const receiptOnly = {
    write<T>(run: (writer: RequestWriter) => Promise<T>): Promise<T> {
      return store.write((writer) => run({
        getRequestReceipt: (id) => writer.getRequestReceipt(id),
        saveRequestReceipt: (receipt) => writer.saveRequestReceipt(receipt),
      }));
    },
  };
  const codec: ResultCodec<number> = {
    parse(value) { assert.equal(typeof value, 'number'); return value as number; },
  };
  let calls = 0;
  const run = async (): Promise<number> => { calls++; return 42; };
  const input = { nested: { b: 'text', a: 1 }, sequence: [1, null, 2] };
  assert.equal(await withRequest(receiptOnly, 'generic-key', 'generic.test', input, codec, run), 42);
  assert.equal(await withRequest(receiptOnly, 'generic-key', 'generic.test', { sequence: [1, null, 2], nested: { a: 1, b: 'text' } }, codec, run), 42);
  assert.equal(calls, 1);
  assert.equal(store.receipts.size, 1);
  assert.equal(store.workouts.size, 0);
  await assert.rejects(withRequest(receiptOnly, 'generic-key', 'other.test', input, codec, run), errorCode('CONFLICT', 'requestId'));
  assert.throws(() => withRequest(receiptOnly, 'sparse-array', 'generic.test', { values: Array(1) }, codec, run), errorCode('INVALID_INPUT'));
  assert.equal(calls, 1);
  for (const operation of ['', ' outer', 'nul\u0000operation', '\ud800']) {
    assert.throws(() => withRequest(receiptOnly, 'invalid-operation', operation, input, codec, run), errorCode('INVALID_INPUT', 'operation'));
  }
  assert.equal(store.receipts.size, 1);
});
