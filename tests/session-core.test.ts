import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFormaService, validateWorkoutSession } from '@forma/core';
import { MemoryWorkoutStore, TEST_TIME, errorCode } from './helpers.js';

test('resume does not write; repeated finish does not change timestamps or call the clock', async (t) => {
  const store = new MemoryWorkoutStore();
  let now = TEST_TIME;
  let clockCalls = 0;
  let id = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => { clockCalls++; return now; } },
    ids: { next: () => 'id-' + ++id } });
  t.after(() => service.close());
  const started = await service.workouts.start({ requestId: 'start', date: '2026-10-12' });
  const writes = store.writes; const saves = store.saves;
  assert.deepEqual(await service.workouts.resume(started.id), started);
  assert.deepEqual(await service.workouts.inProgress(), started);
  assert.equal(store.writes, writes); assert.equal(store.saves, saves); assert.equal(clockCalls, 1);
  now = '2026-10-12T10:00:00.000Z';
  const input = { requestId: 'finish', workoutId: started.id };
  const finished = await service.workouts.finish(input);
  assert.equal(finished.finishedAt, now);
  now = '2026-10-13T12:00:00.000Z';
  const calls = clockCalls;
  assert.deepEqual(await service.workouts.finish(input), finished);
  assert.deepEqual(await service.workouts.finish({ ...input, requestId: 'new-finish-key' }), finished);
  assert.equal(clockCalls, calls);
  assert.equal(store.saves, 2);
});

test('failed finish clock validation leaves the session resumable and its request key reusable', async (t) => {
  const store = new MemoryWorkoutStore();
  let now = TEST_TIME;
  const service = createFormaService({ store, clock: { nowUtc: () => now }, ids: { next: () => 'one' } });
  t.after(() => service.close());
  const workout = await service.workouts.start({ requestId: 'start', date: '2026-10-12' });
  const input = { requestId: 'finish', workoutId: workout.id };
  now = 'invalid';
  await assert.rejects(service.workouts.finish(input), errorCode('INVALID_INPUT', 'clock'));
  assert.deepEqual(await service.workouts.resume(workout.id), workout);
  assert.equal(store.receipts.has(input.requestId), false);
  now = TEST_TIME;
  assert.equal((await service.workouts.finish(input)).status, 'finished');
});

test('session metadata validation rejects unsupported or impossible persisted states', () => {
  assert.deepEqual(validateWorkoutSession('finished', null), { status: 'finished', finishedAt: null });
  assert.deepEqual(validateWorkoutSession('in-progress', null), { status: 'in-progress', finishedAt: null });
  assert.throws(() => validateWorkoutSession('paused', null), errorCode('INVALID_INPUT', 'status'));
  assert.throws(() => validateWorkoutSession('in-progress', TEST_TIME), errorCode('INVALID_INPUT', 'finishedAt'));
  assert.throws(() => validateWorkoutSession('finished', 'not-a-time'), errorCode('INVALID_INPUT', 'clock'));
});
