import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { CreateWorkoutInput, WorkoutSet } from '@forma/core';
import { errorCode, nextRequestId } from './helpers.js';
import type { Fixture } from './helpers.js';

export function requestContract(label: string, fixture: (t: TestContext) => Fixture | Promise<Fixture>): void {
  function check(name: string, run: (service: Fixture['service']) => Promise<void>): void {
    test(label + ': ' + name, async (t) => run((await fixture(t)).service));
  }

  check('a repeated create returns its original snapshot rather than the current workout', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12', notes: 'Original command' };
    const original = await service.workouts.create(input);
    await service.workouts.addSet({ requestId: nextRequestId(), workoutId: original.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    assert.deepEqual(await service.workouts.create(input), original);
    assert.equal((await service.workouts.list()).length, 1);
    assert.equal((await service.workouts.get(original.id)).sets.length, 1);
  });

  check('normalized defaults and property order do not change a command signature', async (service) => {
    const requestId = nextRequestId();
    const original = await service.workouts.create({ requestId, date: '2026-10-12' });
    assert.deepEqual(await service.workouts.create({ notes: '', date: '2026-10-12', requestId }), original);
  });

  check('a repeated add returns the original set after a later change', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input = { requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: 7.5 };
    const original = await service.workouts.addSet(input);
    await service.workouts.updateSet({ requestId: nextRequestId(), workoutId: workout.id, setId: original.id, weightKg: 25 });
    assert.deepEqual(await service.workouts.addSet(input), original);
    assert.equal((await service.workouts.get(workout.id)).sets[0]?.weightKg, 25);
  });

  check('an add and update can replay after the set no longer exists', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const add = { requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
    const original = await service.workouts.addSet(add);
    const update = { requestId: nextRequestId(), workoutId: workout.id, setId: original.id, reps: 10, rpe: null };
    const updated = await service.workouts.updateSet(update);
    await service.workouts.deleteSet({ requestId: nextRequestId(), workoutId: workout.id, setId: original.id });
    assert.deepEqual(await service.workouts.addSet(add), original);
    assert.deepEqual(await service.workouts.updateSet({ rpe: null, reps: 10, setId: original.id, requestId: update.requestId, workoutId: workout.id }), updated);
    assert.deepEqual((await service.workouts.get(workout.id)).sets, []);
  });

  check('a repeated delete returns undefined without another change', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const set = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const input = { requestId: nextRequestId(), workoutId: workout.id, setId: set.id };
    assert.equal(await service.workouts.deleteSet(input), undefined);
    assert.equal(await service.workouts.deleteSet(input), undefined);
    await assert.rejects(service.workouts.deleteSet({ ...input, requestId: nextRequestId() }), errorCode('NOT_FOUND', 'setId'));
  });

  check('concurrent duplicate creates produce one workout', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12' };
    const results = await Promise.all(Array.from({ length: 20 }, () => service.workouts.create(input)));
    results.forEach((result) => assert.deepEqual(result, results[0]));
    assert.equal((await service.workouts.list()).length, 1);
  });

  check('concurrent duplicate adds produce one set', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input = { requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
    const results = await Promise.all(Array.from({ length: 20 }, () => service.workouts.addSet(input)));
    results.forEach((result) => assert.deepEqual(result, results[0]));
    assert.equal((await service.workouts.get(workout.id)).sets.length, 1);
  });

  check('concurrent duplicate updates and deletes return the same outcomes', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const set = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const update = { requestId: nextRequestId(), workoutId: workout.id, setId: set.id, reps: 10 };
    const updates = await Promise.all(Array.from({ length: 20 }, () => service.workouts.updateSet(update)));
    updates.forEach((result) => assert.deepEqual(result, updates[0]));
    const deletion = { requestId: nextRequestId(), workoutId: workout.id, setId: set.id };
    assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => service.workouts.deleteSet(deletion))), Array(20).fill(undefined));
    assert.deepEqual((await service.workouts.get(workout.id)).sets, []);
  });

  for (const patch of [{ date: '2026-10-11' }, { splitDayId: 'upper' }, { notes: ' ' }, { durationMin: 1 }]) {
    check('a reused create key rejects a different ' + Object.keys(patch)[0], async (service) => {
      const input = { requestId: nextRequestId(), date: '2026-10-12' };
      const original = await service.workouts.create(input);
      await assert.rejects(service.workouts.create({ ...input, ...patch }), errorCode('CONFLICT', 'requestId'));
      assert.deepEqual(await service.workouts.get(original.id), original);
      assert.equal((await service.workouts.list()).length, 1);
    });
  }

  check('a reused set key rejects different values or relationships', async (service) => {
    const first = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const second = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-11' });
    const input = { requestId: nextRequestId(), workoutId: first.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
    const original = await service.workouts.addSet(input);
    for (const patch of [{ workoutId: second.id }, { exerciseId: 'leg-extensions' }, { reps: 9 }, { weightKg: 25 }, { rpe: 8 }]) {
      await assert.rejects(service.workouts.addSet({ ...input, ...patch }), errorCode('CONFLICT', 'requestId'));
    }
    assert.deepEqual((await service.workouts.get(first.id)).sets, [original]);
    assert.deepEqual((await service.workouts.get(second.id)).sets, []);
  });

  check('update and delete keys reject different set relationships or patches', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const first = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const second = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const update = { requestId: nextRequestId(), workoutId: workout.id, setId: first.id, reps: 10 };
    await service.workouts.updateSet(update);
    await assert.rejects(service.workouts.updateSet({ ...update, reps: 11 }), errorCode('CONFLICT', 'requestId'));
    await assert.rejects(service.workouts.updateSet({ ...update, setId: second.id }), errorCode('CONFLICT', 'requestId'));
    const deletion = { requestId: nextRequestId(), workoutId: workout.id, setId: first.id };
    await service.workouts.deleteSet(deletion);
    await assert.rejects(service.workouts.deleteSet({ ...deletion, setId: second.id }), errorCode('CONFLICT', 'requestId'));
    assert.deepEqual((await service.workouts.get(workout.id)).sets, [{ ...second, position: 0 }]);
  });

  check('a request key cannot identify two operation names', async (service) => {
    const requestId = nextRequestId();
    const workout = await service.workouts.create({ requestId, date: '2026-10-12' });
    await assert.rejects(service.workouts.addSet({ requestId, workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 }),
      errorCode('CONFLICT', 'requestId'));
    assert.deepEqual((await service.workouts.get(workout.id)).sets, []);
  });

  check('new request keys permit distinct writes with identical inputs', async (service) => {
    const first = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const second = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    assert.notEqual(first.id, second.id);
    assert.equal((await service.workouts.list()).length, 2);
  });

  check('a queued command captures its request key and input before caller mutation', async (service) => {
    const originalInput = { requestId: nextRequestId(), date: '2026-10-12', notes: 'Original' };
    const input = { ...originalInput };
    const pending = service.workouts.create(input);
    input.requestId = nextRequestId();
    input.date = '2026-10-11';
    input.notes = 'Changed';
    const original = await pending;
    assert.equal(original.notes, 'Original');
    assert.deepEqual(await service.workouts.create(originalInput), original);
    assert.equal((await service.workouts.list()).length, 1);
  });

  check('caller mutation cannot alter a receipt snapshot', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12' };
    const original = await service.workouts.create(input);
    const expected = structuredClone(original);
    (original.sets as WorkoutSet[]).push({ id: 'fake', exerciseId: 'leg-curls', reps: 1, weightKg: 0, rpe: null, position: 0, loadConvention: 'unknown', implementCount: null });
    assert.deepEqual(await service.workouts.create(input), expected);
  });

  check('negative zero has the same result before and after replay', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12', durationMin: -0 };
    const workout = await service.workouts.create(input);
    assert.equal(Object.is(workout.durationMin, -0), false);
    assert.deepEqual(await service.workouts.create({ ...input, durationMin: 0 }), workout);
    const add = { requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: -0 };
    const set = await service.workouts.addSet(add);
    assert.equal(Object.is(set.weightKg, -0), false);
    assert.deepEqual(await service.workouts.addSet({ ...add, weightKg: 0 }), set);
    assert.deepEqual((await service.workouts.get(workout.id)).sets, [set]);
  });

  check('a failed command leaves its request key available for a corrected command', async (service) => {
    const requestId = nextRequestId();
    await assert.rejects(service.workouts.create({ requestId, date: '2026-10-12', splitDayId: 'missing' }), errorCode('NOT_FOUND'));
    const original = await service.workouts.create({ requestId, date: '2026-10-12', splitDayId: 'lower' });
    assert.deepEqual(await service.workouts.create({ requestId, date: '2026-10-12', splitDayId: 'lower' }), original);
    assert.equal((await service.workouts.list()).length, 1);
  });

  for (const requestId of [undefined, null, '', ' leading', 'trailing ', 123, '\ud800', '\udfff', 'nul\u0000key']) {
    check('rejects invalid requestId ' + JSON.stringify(requestId), async (service) => {
      const input = { requestId, date: '2026-10-12' } as unknown as CreateWorkoutInput;
      await assert.rejects(service.workouts.create(input), errorCode('INVALID_INPUT', 'requestId'));
      assert.deepEqual(await service.workouts.list(), []);
    });
  }

  check('valid Unicode and SQL-shaped request keys remain opaque values', async (service) => {
    const input = { requestId: "💪'; DROP TABLE exercises; --", date: '2026-10-12' };
    const original = await service.workouts.create(input);
    assert.deepEqual(await service.workouts.create(input), original);
    assert.equal((await service.exercises.list()).length, 19);
  });
}
