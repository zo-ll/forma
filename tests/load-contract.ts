import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { calculateSetLoad, compareSetLoads, resolveCalendarRange } from '@forma/core';
import type { AddSetInput, LoadConvention, UpdateSetInput } from '@forma/core';
import { errorCode, nextRequestId } from './helpers.js';
import type { Fixture } from './helpers.js';

export function loadContract(label: string, fixture: (t: TestContext) => Fixture | Promise<Fixture>): void {
  function check(name: string, run: (service: Fixture['service']) => Promise<void>): void {
    test(label + ': ' + name, async (t) => run((await fixture(t)).service));
  }

  check('no name or equipment supplies an assumed convention', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    for (const exercise of await service.exercises.list()) {
      const set = await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id,
        exerciseId: exercise.id, reps: 8, weightKg: 20 });
      assert.equal(set.loadConvention, 'unknown');
      assert.equal(set.implementCount, null);
      assert.throws(() => calculateSetLoad(set), errorCode('INVALID_INPUT', 'loadConvention'));
    }
  });

  check('each convention preserves the entered kilograms and survives reads', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    for (const loadConvention of ['unknown', 'entered', 'combined', 'body-weight', 'per-hand'] as const) {
      const input: AddSetInput = { requestId: nextRequestId(), workoutId: workout.id,
        exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 22.5, loadConvention,
        implementCount: loadConvention === 'per-hand' ? 2 : null };
      const set = await service.workouts.addSet(input);
      assert.equal(set.weightKg, 22.5);
      assert.equal(set.loadConvention, loadConvention);
      assert.deepEqual(await service.workouts.addSet(input), set);
      assert.deepEqual((await service.workouts.get(workout.id)).sets.at(-1), set);
    }
  });

  check('confirmation changes metadata only and old request replay remains unknown', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input = { requestId: nextRequestId(), workoutId: workout.id,
      exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 20 };
    const original = await service.workouts.addSet(input);
    const confirmation: UpdateSetInput = { requestId: nextRequestId(), workoutId: workout.id,
      setId: original.id, loadConvention: 'per-hand', implementCount: 2 };
    const confirmed = await service.workouts.updateSet(confirmation);
    assert.deepEqual(confirmed, { ...original, loadConvention: 'per-hand', implementCount: 2 });
    assert.deepEqual(await service.workouts.updateSet(confirmation), confirmed);
    assert.deepEqual(await service.workouts.addSet(input), original);
    assert.deepEqual(await service.workouts.addSet({ ...input, loadConvention: 'unknown', implementCount: null }), original);
    assert.deepEqual((await service.workouts.get(workout.id)).sets, [confirmed]);
    assert.equal(calculateSetLoad(confirmed).value, 40);
    const edited = await service.workouts.updateSet({ requestId: nextRequestId(), workoutId: workout.id,
      setId: original.id, reps: 10 });
    assert.equal(edited.loadConvention, 'per-hand');
    assert.equal(edited.implementCount, 2);
    const reset = await service.workouts.updateSet({ requestId: nextRequestId(), workoutId: workout.id,
      setId: original.id, loadConvention: 'unknown' });
    assert.equal(reset.implementCount, null);
    assert.throws(() => compareSetLoads(reset, confirmed), errorCode('INVALID_INPUT', 'loadConvention'));
  });

  check('convention and count changes conflict on a reused request key', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input: AddSetInput = { requestId: nextRequestId(), workoutId: workout.id,
      exerciseId: 'leg-curls', reps: 8, weightKg: 20, loadConvention: 'per-hand', implementCount: 2 };
    const set = await service.workouts.addSet(input);
    for (const patch of [{ loadConvention: 'combined' as const, implementCount: null }, { implementCount: 1 as const }]) {
      await assert.rejects(service.workouts.addSet({ ...input, ...patch }), errorCode('CONFLICT', 'requestId'));
    }
    const update: UpdateSetInput = { requestId: nextRequestId(), workoutId: workout.id,
      setId: set.id, loadConvention: 'entered' };
    await service.workouts.updateSet(update);
    await assert.rejects(service.workouts.updateSet({ ...update, loadConvention: 'combined' }), errorCode('CONFLICT', 'requestId'));
    await assert.rejects(service.workouts.updateSet({ ...update, loadConvention: 'per-hand', implementCount: 1 }), errorCode('CONFLICT', 'requestId'));
  });

  check('invalid metadata is validated before receipt lookup', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input: AddSetInput = { requestId: nextRequestId(), workoutId: workout.id,
      exerciseId: 'leg-curls', reps: 8, weightKg: 20, loadConvention: 'entered' };
    await service.workouts.addSet(input);
    await assert.rejects(service.workouts.addSet({ ...input, loadConvention: 'per-hand' }), errorCode('INVALID_INPUT', 'implementCount'));
  });

  check('queued load metadata cannot be changed by the caller', async (service) => {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    const input: AddSetInput & { loadConvention: LoadConvention; implementCount: 1 | 2 } = {
      requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8,
      weightKg: 20, loadConvention: 'per-hand', implementCount: 2,
    };
    const mutable = input as { loadConvention: LoadConvention; implementCount: 1 | 2 };
    const pending = service.workouts.addSet(input);
    mutable.loadConvention = 'entered'; mutable.implementCount = 1;
    const set = await pending;
    assert.equal(set.loadConvention, 'per-hand'); assert.equal(set.implementCount, 2);
    const update = { requestId: nextRequestId(), workoutId: workout.id, setId: set.id,
      loadConvention: 'per-hand' as LoadConvention, implementCount: 1 as 1 | 2 };
    const editing = service.workouts.updateSet(update);
    update.implementCount = 2; update.loadConvention = 'unknown';
    const edited = await editing;
    assert.equal(edited.loadConvention, 'per-hand'); assert.equal(edited.implementCount, 1);
  });

  check('timezone changes never alter the stored workout calendar date', async (service) => {
    const instant = '2026-10-12T00:30:00.000Z';
    const date = resolveCalendarRange({ nowUtc: instant, timeZone: 'Europe/Rome', period: 'today' }).dateFrom;
    const workout = await service.workouts.create({ requestId: nextRequestId(), date });
    const other = resolveCalendarRange({ nowUtc: instant, timeZone: 'America/New_York', period: 'today' });
    assert.equal((await service.workouts.get(workout.id)).date, date);
    assert.deepEqual(await service.workouts.list({ dateFrom: other.dateFrom, dateTo: other.dateTo }), []);
    assert.deepEqual(await service.workouts.list({ dateFrom: date, dateTo: date }), [workout]);
  });

  const invalid: [Record<string, unknown>, string][] = [
    [{ loadConvention: 'guess' }, 'loadConvention'], [{ loadConvention: null }, 'loadConvention'],
    [{ loadConvention: 'per-hand' }, 'implementCount'], [{ loadConvention: 'per-hand', implementCount: null }, 'implementCount'],
    [{ loadConvention: 'per-hand', implementCount: 0 }, 'implementCount'], [{ loadConvention: 'per-hand', implementCount: 3 }, 'implementCount'],
    [{ loadConvention: 'per-hand', implementCount: 1.5 }, 'implementCount'], [{ loadConvention: 'per-hand', implementCount: '2' }, 'implementCount'],
    [{ loadConvention: 'entered', implementCount: 2 }, 'implementCount'], [{ loadConvention: 'unknown', implementCount: 1 }, 'implementCount'],
    [{ loadConvention: 'combined', implementCount: 1 }, 'implementCount'], [{ loadConvention: 'body-weight', implementCount: 2 }, 'implementCount'],
  ];
  for (const [patch, field] of invalid) {
    check('invalid load metadata ' + JSON.stringify(patch) + ' leaves records unchanged', async (service) => {
      const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
      const add = { requestId: nextRequestId(), workoutId: workout.id,
        exerciseId: 'leg-curls', reps: 8, weightKg: 20 };
      await assert.rejects(service.workouts.addSet({ ...add, ...patch } as AddSetInput), errorCode('INVALID_INPUT', field));
      const set = await service.workouts.addSet(add);
      const before = await service.workouts.get(workout.id);
      await assert.rejects(service.workouts.updateSet({ requestId: nextRequestId(), workoutId: workout.id,
        setId: set.id, ...patch } as UpdateSetInput), errorCode('INVALID_INPUT', field));
      assert.deepEqual(await service.workouts.get(workout.id), before);
    });
  }

  check('a count-only update is invalid and cannot keep an implicit convention', async (service) => {
    await assert.rejects(service.workouts.updateSet({ requestId: nextRequestId(), workoutId: 'missing',
      setId: 'missing', implementCount: 2 }), errorCode('INVALID_INPUT', 'loadConvention'));
  });
}
