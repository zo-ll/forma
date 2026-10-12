import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSetLoad, compareSetLoads, validateSetLoadDetails, createFormaService } from '@forma/core';
import type { WorkoutSet } from '@forma/core';
import { errorCode, MemoryWorkoutStore, TEST_TIME } from './helpers.js';

function set(patch: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id: 'set', exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 20,
    rpe: null, position: 0, loadConvention: 'entered', implementCount: null, ...patch };
}

test('entered and combined load facts carry their units, convention, and source IDs', () => {
  assert.deepEqual(calculateSetLoad(set()), {
    setId: 'set', exerciseId: 'incline-dumbbell-press', value: 20, unit: 'kg',
    convention: 'entered', enteredWeightKg: 20, recordedConvention: 'entered', implementCount: null,
  });
  assert.equal(calculateSetLoad(set({ loadConvention: 'combined' })).convention, 'combined');
});

test('per-hand conversion uses only the explicitly recorded implement count', () => {
  const pair = set({ loadConvention: 'per-hand', implementCount: 2, weightKg: 22.5 });
  assert.deepEqual(calculateSetLoad(pair), {
    setId: 'set', exerciseId: 'incline-dumbbell-press', value: 45, unit: 'kg',
    convention: 'combined', enteredWeightKg: 22.5, recordedConvention: 'per-hand', implementCount: 2,
  });
  assert.equal(calculateSetLoad({ ...pair, implementCount: 1 }).value, 22.5);
  assert.equal(pair.weightKg, 22.5);
  assert.equal(compareSetLoads(pair, set({ loadConvention: 'combined', weightKg: 45 })), 0);
});

test('load comparison supports only the same exercise and compatible kilogram facts', () => {
  assert.equal(compareSetLoads(set(), set({ weightKg: 21 })), -1);
  assert.equal(compareSetLoads(set(), set({ weightKg: 19 })), 1);
  assert.equal(compareSetLoads(set(), set({ reps: 10 })), 0);
  assert.throws(() => compareSetLoads(set(), set({ exerciseId: 'leg-curls' })), errorCode('INVALID_INPUT', 'exerciseId'));
  assert.throws(() => compareSetLoads(set(), set({ loadConvention: 'combined' })), errorCode('INVALID_INPUT', 'loadConvention'));
  assert.throws(() => compareSetLoads(set(), set({ loadConvention: 'per-hand', implementCount: 1 })), errorCode('INVALID_INPUT', 'loadConvention'));
});

for (const loadConvention of ['unknown', 'body-weight'] as const) {
  test(loadConvention + ' cannot supply comparable load facts, even for identical records', () => {
    const input = set({ loadConvention, weightKg: 0 });
    assert.throws(() => calculateSetLoad(input), errorCode('INVALID_INPUT', 'loadConvention'));
    assert.throws(() => compareSetLoads(input, input), errorCode('INVALID_INPUT', 'loadConvention'));
  });
}

test('load calculations reject overflow and invalid runtime DTOs', () => {
  assert.throws(() => calculateSetLoad(set({ loadConvention: 'per-hand', implementCount: 2, weightKg: Number.MAX_VALUE })),
    errorCode('INVALID_INPUT', 'weightKg'));
  for (const weightKg of [NaN, Infinity, -1]) {
    assert.throws(() => calculateSetLoad(set({ weightKg })), errorCode('INVALID_INPUT', 'weightKg'));
  }
  assert.throws(() => calculateSetLoad(set({ id: '' })), errorCode('INVALID_INPUT', 'setId'));
  assert.throws(() => calculateSetLoad(null as unknown as WorkoutSet), errorCode('INVALID_INPUT', 'input'));
  assert.throws(() => validateSetLoadDetails('per-hand', 3), errorCode('INVALID_INPUT', 'implementCount'));
  assert.throws(() => validateSetLoadDetails('entered', 1), errorCode('INVALID_INPUT', 'implementCount'));
});

test('zero stays nonnegative and does not become a negative-zero fact', () => {
  assert.equal(Object.is(calculateSetLoad(set({ weightKg: -0 })).value, -0), false);
});

test('invalid load metadata never reaches the storage write port', async (t) => {
  const store = new MemoryWorkoutStore();
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'unused' } });
  t.after(() => service.close());
  await assert.rejects(service.workouts.addSet({ requestId: 'bad', workoutId: 'not-loaded', exerciseId: 'leg-curls',
    reps: 8, weightKg: 20, loadConvention: 'per-hand' }), errorCode('INVALID_INPUT', 'implementCount'));
  await assert.rejects(service.workouts.updateSet({ requestId: 'bad', workoutId: 'not-loaded', setId: 'not-loaded',
    implementCount: 2 }), errorCode('INVALID_INPUT', 'loadConvention'));
  assert.equal(store.writes, 0);
});
