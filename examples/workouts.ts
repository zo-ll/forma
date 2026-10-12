import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeForma } from '@forma/adapters/node';
import type { FormaService } from '@forma/core';

const directory = await mkdtemp(join(tmpdir(), 'forma-demo-'));
const databasePath = join(directory, 'workouts.sqlite');
let service: FormaService | undefined;

try {
  service = openNodeForma({ databasePath });
  const splitDays = await service.splitDays.list();
  console.log('Split days:', splitDays.map((splitDay) => splitDay.name).join(', '));
  console.log('Exercise count:', (await service.exercises.list()).length);

  const exercise = await service.exercises.resolveAlias('Incline DB Press');
  const createCommand = {
    requestId: randomUUID(), date: '2026-10-12', splitDayId: 'upper', notes: 'Fictional demonstration workout.',
  };
  const workout = await service.workouts.create(createCommand);
  const first = await service.workouts.addSet({ requestId: randomUUID(),
    workoutId: workout.id, exerciseId: exercise.id, reps: 8, weightKg: 20, rpe: 7.5,
  });
  const second = await service.workouts.addSet({ requestId: randomUUID(),
    workoutId: workout.id, exerciseId: exercise.id, reps: 7, weightKg: 20,
  });
  await service.workouts.updateSet({ requestId: randomUUID(), workoutId: workout.id, setId: second.id, reps: 8, rpe: 8 });
  await service.workouts.deleteSet({ requestId: randomUUID(), workoutId: workout.id, setId: first.id });
  const beforeClose = await service.workouts.get(workout.id);
  await service.close();

  service = openNodeForma({ databasePath });
  const restored = await service.workouts.get(workout.id);
  assert.deepEqual(restored, beforeClose);
  assert.deepEqual(await service.workouts.create(createCommand), workout);
  assert.equal((await service.workouts.list()).length, 1);
  assert.equal(restored.sets[0]?.position, 0);
  console.log('Saved workout after reopen:', JSON.stringify(restored, null, 2));
  console.log('Persistence check passed. No app or model was required.');
} finally {
  await service?.close();
  await rm(directory, { recursive: true, force: true });
}
