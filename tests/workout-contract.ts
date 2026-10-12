import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { DEFAULT_EXERCISES, DEFAULT_SPLIT_DAYS } from '@forma/core';
import type { AddSetInput, CreateWorkoutInput, WorkoutSet } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';
import type { Fixture } from './helpers.js';

export function workoutContract(
  label: string,
  fixture: (t: TestContext) => Fixture | Promise<Fixture>,
): void {
  function check(name: string, run: (service: Fixture['service']) => Promise<void>): void {
    test(label + ': ' + name, async (t) => run((await fixture(t)).service));
  }

  check('the exact 19-exercise catalog is available', async (service) => {
    assert.deepEqual(await service.exercises.list(), DEFAULT_EXERCISES);
    assert.equal((await service.exercises.list()).length, 19);
  });

  check('the three split days preserve membership and order', async (service) => {
    assert.deepEqual(await service.splitDays.list(), DEFAULT_SPLIT_DAYS);
    const lower = await service.splitDays.get('lower');
    assert.deepEqual(lower.exerciseIds, [
      'hack-squat', 'bulgarian-split-squat', 'calf-raises', 'hammer-curls', 'leg-extensions', 'leg-curls',
    ]);
    assert.equal((await service.splitDays.get('upper')).exerciseIds.length, 7);
    assert.equal((await service.splitDays.get('arms-shoulders')).exerciseIds.length, 7);
  });

  check('the public API uses split day names and rejects the old groupId field', async (service) => {
    assert.equal(Object.hasOwn(service, 'groups'), false);
    assert.equal(Object.hasOwn(service, 'splitDays'), true);
    const input = { date: '2026-10-12', groupId: 'upper' } as unknown as CreateWorkoutInput;
    await assert.rejects(service.workouts.create(input), errorCode('INVALID_INPUT', 'groupId'));
    assert.deepEqual(await service.workouts.list(), []);
  });

  check('Triceps Pushdowns shares one exercise ID across split days', async (service) => {
    const exercises = await service.exercises.list();
    assert.equal(exercises.filter((exercise) => exercise.name === 'Triceps Pushdowns').length, 1);
    assert((await service.splitDays.get('upper')).exerciseIds.includes('triceps-pushdowns'));
    assert((await service.splitDays.get('arms-shoulders')).exerciseIds.includes('triceps-pushdowns'));
  });

  check('Preacher Curl and Preacher Curl Machine remain distinct', async (service) => {
    assert.equal((await service.exercises.resolveAlias('Preacher Curl')).id, 'preacher-curl');
    assert.equal((await service.exercises.resolveAlias('Preacher Curl Machine')).id, 'preacher-curl-machine');
    assert.equal((await service.exercises.get('hack-squat')).equipment, null);
  });

  check('alias resolution normalizes case and whitespace', async (service) => {
    assert.equal((await service.exercises.resolveAlias('  iNCLiNe   DB PRESS  ')).id, 'incline-dumbbell-press');
    assert.equal((await service.exercises.resolveAlias(' cable  row ')).id, 'cable-row');
    await assert.rejects(service.exercises.resolveAlias('bench'), errorCode('NOT_FOUND', 'alias'));
    await assert.rejects(service.exercises.resolveAlias('  '), errorCode('INVALID_INPUT', 'alias'));
  });

  check('unknown catalog records have typed errors', async (service) => {
    await assert.rejects(service.exercises.get('missing'), errorCode('NOT_FOUND', 'exerciseId'));
    await assert.rejects(service.splitDays.get('missing'), errorCode('NOT_FOUND', 'splitDayId'));
    await assert.rejects(service.exercises.get(''), errorCode('INVALID_INPUT', 'exerciseId'));
    await assert.rejects(service.splitDays.get(''), errorCode('INVALID_INPUT', 'splitDayId'));
  });

  check('a workout has explicit date, defaults, and UTC audit times', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-11', splitDayId: 'upper' });
    assert.equal(workout.date, '2026-10-11');
    assert.equal(workout.splitDayId, 'upper');
    assert.equal(workout.notes, '');
    assert.equal(workout.durationMin, null);
    assert.equal(workout.createdAt, TEST_TIME);
    assert.equal(workout.updatedAt, TEST_TIME);
    assert.deepEqual(workout.sets, []);
    assert.deepEqual(await service.workouts.get(workout.id), workout);
  });

  check('notes and duration survive storage without text alteration', async (service) => {
    const notes = "Quote: '; DROP TABLE exercises; -- 🏋";
    const workout = await service.workouts.create({ date: '2026-10-12', notes, durationMin: 45.5 });
    assert.equal((await service.workouts.get(workout.id)).notes, notes);
    assert.equal((await service.exercises.list()).length, 19);
    assert.equal(workout.durationMin, 45.5);
  });

  check('sets use kg, decimal RPE, optional RPE, and zero-based positions', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const first = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 22.5, rpe: 7.5,
    });
    const second = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'bulgarian-split-squat', reps: 10, weightKg: 0,
    });
    assert.equal(first.position, 0);
    assert.equal(first.weightKg, 22.5);
    assert.equal(first.rpe, 7.5);
    assert.equal(second.position, 1);
    assert.equal(second.rpe, null);
    assert.equal(second.weightKg, 0);
    assert.deepEqual((await service.workouts.get(workout.id)).sets, [first, second]);
    assert.deepEqual(workout.sets, []);
  });

  check('split days suggest exercises but do not restrict a workout', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12', splitDayId: 'lower' });
    await service.workouts.addSet({ workoutId: workout.id, exerciseId: 'cable-row', reps: 8, weightKg: 20 });
    assert.equal((await service.workouts.get(workout.id)).sets[0]?.exerciseId, 'cable-row');
  });

  check('set updates preserve identity and position and can clear RPE', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const set = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: 7,
    });
    const updated = await service.workouts.updateSet({
      workoutId: workout.id, setId: set.id, exerciseId: 'leg-extensions', reps: 10, weightKg: 0, rpe: null,
    });
    assert.deepEqual(updated, {
      id: set.id, exerciseId: 'leg-extensions', reps: 10, weightKg: 0, rpe: null, position: 0,
    });
    assert.equal((await service.workouts.get(workout.id)).sets[0]?.rpe, null);
  });

  check('a partial set update preserves omitted fields', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const set = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: 7,
    });
    assert.deepEqual(await service.workouts.updateSet({ workoutId: workout.id, setId: set.id, reps: 9 }),
      { ...set, reps: 9 });
  });

  check('a set update copies its validated payload before asynchronous work', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const set = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: 7,
    });
    const input = {
      workoutId: workout.id, setId: set.id, exerciseId: 'leg-extensions', reps: 9, weightKg: 25, rpe: 8,
    };
    const pending = service.workouts.updateSet(input);
    input.exerciseId = 'missing';
    input.reps = -1;
    input.weightKg = -1;
    input.rpe = 0;
    const updated = await pending;
    assert.deepEqual(updated, {
      id: set.id, exerciseId: 'leg-extensions', reps: 9, weightKg: 25, rpe: 8, position: 0,
    });
    assert.deepEqual((await service.workouts.get(workout.id)).sets, [updated]);
  });

  check('an unknown replacement exercise does not alter a set', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    await service.workouts.addSet({ workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const before = await service.workouts.get(workout.id);
    const set = before.sets[0];
    assert(set);
    await assert.rejects(service.workouts.updateSet({
      workoutId: workout.id, setId: set.id, exerciseId: 'missing', reps: 9,
    }), errorCode('NOT_FOUND', 'exerciseId'));
    assert.deepEqual(await service.workouts.get(workout.id), before);
  });

  check('set deletion compacts positions and leaves other workouts unchanged', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const other = await service.workouts.create({ date: '2026-10-11' });
    const sets: WorkoutSet[] = [];
    for (let reps = 1; reps <= 3; reps++) {
      sets.push(await service.workouts.addSet({ workoutId: workout.id, exerciseId: 'leg-curls', reps, weightKg: 20 }));
    }
    const middle = sets[1];
    assert(middle);
    await service.workouts.deleteSet({ workoutId: workout.id, setId: middle.id });
    assert.deepEqual((await service.workouts.get(workout.id)).sets.map((set) => [set.reps, set.position]), [[1, 0], [3, 1]]);
    assert.deepEqual(await service.workouts.get(other.id), other);
  });

  check('concurrent set commands preserve every set', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    await Promise.all(Array.from({ length: 10 }, (_, index) => service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: index + 1, weightKg: 20,
    })));
    const sets = (await service.workouts.get(workout.id)).sets;
    assert.equal(sets.length, 10);
    assert.deepEqual(sets.map((set) => set.position), Array.from({ length: 10 }, (_, index) => index));
    assert.equal(new Set(sets.map((set) => set.id)).size, 10);
  });

  check('workout lists use inclusive date filters and stable date order', async (service) => {
    const early = await service.workouts.create({ date: '2026-10-05' });
    const middle = await service.workouts.create({ date: '2026-10-07' });
    const late = await service.workouts.create({ date: '2026-10-11' });
    assert.deepEqual((await service.workouts.list()).map((workout) => workout.id), [late.id, middle.id, early.id]);
    assert.deepEqual((await service.workouts.list({ dateFrom: '2026-10-07', dateTo: '2026-10-11' }))
      .map((workout) => workout.id), [late.id, middle.id]);
    assert.equal((await service.workouts.list({ dateFrom: '2026-10-12' })).length, 0);
    assert.equal((await service.workouts.list({ dateTo: '2026-10-05' })).length, 1);
    await assert.rejects(service.workouts.list({ dateFrom: '2026-10-12', dateTo: '2026-10-11' }),
      errorCode('INVALID_INPUT', 'dateTo'));
  });

  check('missing relationships never create partial records', async (service) => {
    await assert.rejects(service.workouts.create({ date: '2026-10-12', splitDayId: 'missing' }),
      errorCode('NOT_FOUND', 'splitDayId'));
    assert.equal((await service.workouts.list()).length, 0);
    const workout = await service.workouts.create({ date: '2026-10-12' });
    await assert.rejects(service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'missing', reps: 8, weightKg: 20,
    }), errorCode('NOT_FOUND', 'exerciseId'));
    assert.deepEqual((await service.workouts.get(workout.id)).sets, []);
    await assert.rejects(service.workouts.get('missing'), errorCode('NOT_FOUND', 'workoutId'));
    await assert.rejects(service.workouts.addSet({
      workoutId: 'missing', exerciseId: 'leg-curls', reps: 8, weightKg: 20,
    }), errorCode('NOT_FOUND', 'workoutId'));
  });

  check('a set cannot be edited or deleted through another workout', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const other = await service.workouts.create({ date: '2026-10-11' });
    const set = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20,
    });
    await assert.rejects(service.workouts.updateSet({ workoutId: other.id, setId: set.id, reps: 9 }),
      errorCode('NOT_FOUND', 'setId'));
    await assert.rejects(service.workouts.deleteSet({ workoutId: other.id, setId: set.id }),
      errorCode('NOT_FOUND', 'setId'));
    assert.equal((await service.workouts.get(workout.id)).sets[0]?.reps, 8);
  });

  check('empty patches and unsupported fields are rejected', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const set = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20,
    });
    await assert.rejects(service.workouts.updateSet({ workoutId: workout.id, setId: set.id }),
      errorCode('INVALID_INPUT', 'input'));
    const input = { date: '2026-10-12', unexpected: true } as CreateWorkoutInput;
    await assert.rejects(service.workouts.create(input), errorCode('INVALID_INPUT', 'unexpected'));
  });

  check('returned data cannot mutate stored records', async (service) => {
    const workout = await service.workouts.create({ date: '2026-10-12' });
    const set = await service.workouts.addSet({
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20,
    });
    const loaded = await service.workouts.get(workout.id);
    (loaded.sets as WorkoutSet[]).splice(0);
    assert.deepEqual((await service.workouts.get(workout.id)).sets, [set]);
  });

  check('all APIs reject calls after service close', async (service) => {
    await service.close();
    await service.close();
    await assert.rejects(service.exercises.list(), errorCode('SERVICE_CLOSED'));
    await assert.rejects(service.splitDays.list(), errorCode('SERVICE_CLOSED'));
    await assert.rejects(service.workouts.list(), errorCode('SERVICE_CLOSED'));
    await assert.rejects(service.workouts.create({ date: '2026-10-12' }), errorCode('SERVICE_CLOSED'));
  });

  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '12/10/2026']) {
    check('rejects invalid calendar date ' + date, async (service) => {
      await assert.rejects(service.workouts.create({ date }), errorCode('INVALID_INPUT', 'date'));
      assert.equal((await service.workouts.list()).length, 0);
    });
  }

  check('accepts a leap day and rejects invalid object inputs', async (service) => {
    assert.equal((await service.workouts.create({ date: '2024-02-29' })).date, '2024-02-29');
    await assert.rejects(service.workouts.create(null as unknown as CreateWorkoutInput), errorCode('INVALID_INPUT', 'input'));
    await assert.rejects(service.workouts.create({ date: '2026-10-12', durationMin: -1 }), errorCode('INVALID_INPUT', 'durationMin'));
  });

  const badSetValues: { name: string; field: string; patch: Record<string, unknown> }[] = [
    { name: 'zero reps', field: 'reps', patch: { reps: 0 } },
    { name: 'fractional reps', field: 'reps', patch: { reps: 2.5 } },
    { name: 'unsafe integer reps', field: 'reps', patch: { reps: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'text reps', field: 'reps', patch: { reps: '8' } },
    { name: 'negative weight', field: 'weightKg', patch: { weightKg: -1 } },
    { name: 'infinite weight', field: 'weightKg', patch: { weightKg: Infinity } },
    { name: 'NaN weight', field: 'weightKg', patch: { weightKg: NaN } },
    { name: 'RPE below one', field: 'rpe', patch: { rpe: 0 } },
    { name: 'RPE above ten', field: 'rpe', patch: { rpe: 11 } },
  ];
  for (const invalid of badSetValues) {
    check('rejects ' + invalid.name + ' without a write', async (service) => {
      const workout = await service.workouts.create({ date: '2026-10-12' });
      const input = {
        workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, ...invalid.patch,
      } as AddSetInput;
      await assert.rejects(service.workouts.addSet(input), errorCode('INVALID_INPUT', invalid.field));
      assert.deepEqual((await service.workouts.get(workout.id)).sets, []);
    });
  }
}
