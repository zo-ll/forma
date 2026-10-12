import type { CreateWorkoutInput, UpdateWorkoutInput, WorkoutCommandInput } from '@forma/core';
import { errorCode, nextRequestId, TEST_TIME } from './contract-helpers.js';
import type { ContractAssert, ContractCase } from './contract-types.js';

export function collectSessionCases(assert: ContractAssert): readonly ContractCase[] {
  const cases: ContractCase[] = [];
  function check(name: string, run: ContractCase['run']): void {
    cases.push({ name, run });
  }

  check('manual records are finished but have no invented finish instant', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2024-02-29' });
    assert.equal(workout.status, 'finished'); assert.equal(workout.finishedAt, null);
    assert.equal(await service.workouts.inProgress(), null);
    await assert.rejects(service.workouts.resume(workout.id), errorCode('CONFLICT', 'status'));
    await assert.rejects(service.workouts.discard({ requestId: nextRequestId(), workoutId: workout.id }), errorCode('CONFLICT', 'status'));
    assert.deepEqual(await service.workouts.get(workout.id), workout);
    assert.deepEqual(await service.workouts.finish({ requestId: nextRequestId(), workoutId: workout.id }), workout);
  });

  check('start, resume, and finish preserve saved sets and the assigned date', async (service) => {
    const start = { requestId: nextRequestId(), date: '2026-10-11', splitDayId: 'upper', notes: 'Exact 🏋 note' };
    const workout = await service.workouts.start(start);
    assert.equal(workout.status, 'in-progress'); assert.equal(workout.finishedAt, null);
    assert.deepEqual(await service.workouts.inProgress(), workout);
    const set = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id,
      exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 20, loadConvention: 'per-hand', implementCount: 2 });
    const current = await service.workouts.get(workout.id);
    assert.deepEqual(await service.workouts.resume(workout.id), current);
    assert.deepEqual(await service.workouts.start(start), workout);
    const finish = { requestId: nextRequestId(), workoutId: workout.id };
    const finished = await service.workouts.finish(finish);
    assert.deepEqual(finished, { ...current, status: 'finished', finishedAt: TEST_TIME, updatedAt: TEST_TIME });
    assert.equal(finished.date, '2026-10-11'); assert.equal(finished.durationMin, null);
    assert.deepEqual(finished.sets, [set]); assert.equal(await service.workouts.inProgress(), null);
    assert.deepEqual(await service.workouts.finish(finish), finished);
    await assert.rejects(service.workouts.resume(workout.id), errorCode('CONFLICT', 'status'));
  });

  check('one in-progress workout does not prevent manual historical records', async (service) => {
    const active = await service.workouts.start({ requestId: nextRequestId(), date: '2026-10-12' });
    const second = { requestId: nextRequestId(), date: '2026-10-13' };
    await assert.rejects(service.workouts.start(second), errorCode('CONFLICT', 'status'));
    await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-10' });
    assert.deepEqual(await service.workouts.inProgress(), active);
    await service.workouts.finish({ requestId: nextRequestId(), workoutId: active.id });
    assert.equal((await service.workouts.start(second)).status, 'in-progress');
  });

  check('duplicate starts and competing starts cannot create two live sessions', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12' };
    const same = await Promise.all(Array.from({ length: 5 }, () => service.workouts.start(input)));
    assert(same[0]); for (const result of same) assert.deepEqual(result, same[0]);
    assert.equal((await service.workouts.list()).length, 1);
    await service.workouts.discard({ requestId: nextRequestId(), workoutId: same[0].id });
    const competing = await Promise.allSettled(Array.from({ length: 5 }, () => service.workouts.start({ requestId: nextRequestId(), date: '2026-10-12' })));
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    for (const result of competing) if (result.status === 'rejected') assert(errorCode('CONFLICT', 'status')(result.reason));
    assert.equal((await service.workouts.list()).length, 1);
  });

  check('finished records allow metadata and set edits without reopening', async (service) => {
    const original = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12', splitDayId: 'upper', durationMin: 20 });
    const set = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: original.id,
      exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const input = { requestId: nextRequestId(), workoutId: original.id, date: '2024-02-29', splitDayId: 'lower',
      notes: "Exact '; DROP TABLE workouts; -- 🏋", durationMin: 30.5 };
    const updated = await service.workouts.update(input);
    assert.deepEqual(updated, { ...original, date: input.date, splitDayId: input.splitDayId,
      notes: input.notes, durationMin: 30.5, sets: [set], updatedAt: TEST_TIME });
    const edited = await service.workouts.updateSet({ requestId: nextRequestId(), workoutId: original.id, setId: set.id, reps: 10 });
    assert.equal((await service.workouts.get(original.id)).status, 'finished');
    assert.deepEqual(await service.workouts.update(input), updated);
    assert.deepEqual((await service.workouts.get(original.id)).sets, [edited]);
    const cleared = await service.workouts.update({ requestId: nextRequestId(), workoutId: original.id,
      splitDayId: null, durationMin: null, notes: '' });
    assert.equal(cleared.splitDayId, null); assert.equal(cleared.durationMin, null); assert.equal(cleared.notes, '');
    assert.equal(cleared.date, input.date); assert.equal(cleared.finishedAt, null);
  });

  check('finish replay remains the original snapshot after edits and deletion', async (service) => {
    const workout = await service.workouts.start({ requestId: nextRequestId(), date: '2026-10-12' });
    const finish = { requestId: nextRequestId(), workoutId: workout.id };
    const finished = await service.workouts.finish(finish);
    await service.workouts.update({ requestId: nextRequestId(), workoutId: workout.id, notes: 'Changed after finish' });
    assert.deepEqual(await service.workouts.finish(finish), finished);
    await service.workouts.delete({ requestId: nextRequestId(), workoutId: workout.id });
    assert.deepEqual(await service.workouts.finish(finish), finished);
    await assert.rejects(service.workouts.finish({ requestId: nextRequestId(), workoutId: workout.id }), errorCode('NOT_FOUND', 'workoutId'));
  });

  for (const operation of ['delete', 'discard'] as const) {
    check(operation + ' deletes the workout and sets but preserves original request results', async (service) => {
      const start = { requestId: nextRequestId(), date: '2026-10-12' };
      const workout = await service.workouts.start(start);
      const add = { requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
      const set = await service.workouts.addSet(add);
      const edit = { requestId: nextRequestId(), workoutId: workout.id, notes: 'Saved before deletion' };
      const updated = await service.workouts.update(edit);
      const removal = { requestId: nextRequestId(), workoutId: workout.id };
      await service.workouts[operation](removal);
      assert.equal(await service.workouts.inProgress(), null); assert.deepEqual(await service.workouts.list(), []);
      assert.equal(await service.workouts[operation](removal), undefined);
      assert.deepEqual(await service.workouts.start(start), workout);
      assert.deepEqual(await service.workouts.addSet(add), set);
      assert.deepEqual(await service.workouts.update(edit), updated);
      await assert.rejects(service.workouts.get(workout.id), errorCode('NOT_FOUND', 'workoutId'));
      await assert.rejects(service.workouts[operation]({ requestId: nextRequestId(), workoutId: workout.id }), errorCode('NOT_FOUND', 'workoutId'));
      assert.equal((await service.workouts.start({ requestId: nextRequestId(), date: '2026-10-13' })).status, 'in-progress');
    });
  }

  check('whole-workout deletion preserves other workouts and the catalog', async (service) => {
    const original = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const other = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-11' });
    await service.workouts.delete({ requestId: nextRequestId(), workoutId: original.id });
    assert.deepEqual(await service.workouts.list(), [other]);
    assert.equal((await service.exercises.list()).length, 19);
    assert.equal((await service.splitDays.list()).length, 3);
  });

  check('new operations against deleted records cannot resurrect them', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const set = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    await service.workouts.delete({ requestId: nextRequestId(), workoutId: workout.id });
    for (const command of [
      () => service.workouts.update({ requestId: nextRequestId(), workoutId: workout.id, notes: 'New' }),
      () => service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 }),
      () => service.workouts.updateSet({ requestId: nextRequestId(), workoutId: workout.id, setId: set.id, reps: 10 }),
      () => service.workouts.deleteSet({ requestId: nextRequestId(), workoutId: workout.id, setId: set.id }),
      () => service.workouts.resume(workout.id),
    ]) await assert.rejects(command(), errorCode('NOT_FOUND', 'workoutId'));
    assert.deepEqual(await service.workouts.list(), []);
  });

  check('unknown split days and invalid starts leave records unchanged', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12', splitDayId: 'missing' };
    await assert.rejects(service.workouts.start(input), errorCode('NOT_FOUND', 'splitDayId'));
    assert.equal(await service.workouts.inProgress(), null);
    assert.equal((await service.workouts.start({ ...input, splitDayId: 'upper' })).splitDayId, 'upper');
  });

  check('metadata updates capture input before asynchronous storage work', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input = { requestId: nextRequestId(), workoutId: workout.id, notes: 'Original input', splitDayId: 'lower', durationMin: 20 };
    const pending = service.workouts.update(input);
    input.notes = 'Mutated'; input.splitDayId = 'missing'; input.durationMin = -1;
    const result = await pending;
    assert.equal(result.notes, 'Original input'); assert.equal(result.splitDayId, 'lower'); assert.equal(result.durationMin, 20);
  });

  check('reused keys reject different record inputs or operation names', async (service) => {
    const input = { requestId: nextRequestId(), date: '2026-10-12' };
    const workout = await service.workouts.start(input);
    await assert.rejects(service.workouts.create(input), errorCode('CONFLICT', 'requestId'));
    const edit = { requestId: nextRequestId(), workoutId: workout.id, notes: 'Saved' };
    await service.workouts.update(edit);
    await assert.rejects(service.workouts.update({ ...edit, notes: 'Different' }), errorCode('CONFLICT', 'requestId'));
    await assert.rejects(service.workouts.finish({ requestId: edit.requestId, workoutId: workout.id }), errorCode('CONFLICT', 'requestId'));
    const removal = { requestId: nextRequestId(), workoutId: workout.id };
    await service.workouts.discard(removal);
    await assert.rejects(service.workouts.delete(removal), errorCode('CONFLICT', 'requestId'));
  });

  const invalid: [Record<string, unknown>, string][] = [
    [{}, 'input'], [{ date: '2026-02-29' }, 'date'], [{ date: null }, 'date'],
    [{ notes: null }, 'notes'], [{ durationMin: -1 }, 'durationMin'], [{ durationMin: Infinity }, 'durationMin'],
    [{ splitDayId: '' }, 'splitDayId'], [{ status: 'in-progress' }, 'status'], [{ finishedAt: TEST_TIME }, 'finishedAt'],
    [{ notes: '', unexpected: true }, 'unexpected'],
  ];
  for (const [patch, field] of invalid) {
    check('invalid metadata patch ' + JSON.stringify(patch) + ' preserves records', async (service) => {
      const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
      await assert.rejects(service.workouts.update({ requestId: nextRequestId(), workoutId: workout.id, ...patch } as UpdateWorkoutInput),
        errorCode('INVALID_INPUT', field));
      assert.deepEqual(await service.workouts.get(workout.id), workout);
    });
  }

  check('invalid split-day references roll back metadata edits', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12', notes: 'Keep' });
    await assert.rejects(service.workouts.update({ requestId: nextRequestId(), workoutId: workout.id,
      notes: 'Must roll back', splitDayId: 'missing' }), errorCode('NOT_FOUND', 'splitDayId'));
    assert.deepEqual(await service.workouts.get(workout.id), workout);
  });

  check('null and unsupported command inputs produce typed errors before mutation', async (service) => {
    await assert.rejects(service.workouts.start(null as unknown as CreateWorkoutInput), errorCode('INVALID_INPUT', 'input'));
    await assert.rejects(service.workouts.update(null as unknown as UpdateWorkoutInput), errorCode('INVALID_INPUT', 'input'));
    for (const operation of ['finish', 'delete', 'discard'] as const) {
      await assert.rejects(service.workouts[operation](null as unknown as WorkoutCommandInput), errorCode('INVALID_INPUT', 'input'));
      await assert.rejects(service.workouts[operation]({ requestId: nextRequestId(), workoutId: 'missing', abortSignal: true } as WorkoutCommandInput),
        errorCode('INVALID_INPUT', 'abortSignal'));
    }
    assert.deepEqual(await service.workouts.list(), []);
  });

  check('all new methods reject calls after close', async (service) => {
    await service.close();
    for (const command of [
      () => service.workouts.start({ requestId: nextRequestId(), date: '2026-10-12' }),
      () => service.workouts.inProgress(), () => service.workouts.resume('missing'),
      () => service.workouts.update({ requestId: nextRequestId(), workoutId: 'missing', notes: '' }),
      ...(['finish', 'delete', 'discard'] as const).map((operation) => () => service.workouts[operation]({ requestId: nextRequestId(), workoutId: 'missing' })),
    ]) await assert.rejects(command(), errorCode('SERVICE_CLOSED'));
  });

  return cases;
}
