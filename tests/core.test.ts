import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFormaService } from '@forma/core';
import { nextRequestId, MemoryWorkoutStore, memoryFixture, errorCode, TEST_TIME } from './helpers.js';
import { workoutContract } from './workout-contract.js';

workoutContract('portable core with memory port', memoryFixture);

test('the core has no runtime package dependencies or platform imports', async () => {
  const packagePath = resolve('packages/core/package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as { dependencies?: unknown };
  assert.equal(manifest.dependencies, undefined);
  const source = resolve('packages/core/src');
  async function checkDirectory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await checkDirectory(path);
      else if (entry.name.endsWith('.ts')) {
        const text = await readFile(path, 'utf8');
        for (const match of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/gu)) {
          assert(match[1]?.startsWith('.'), 'Core imports a platform or runtime package: ' + match[1]);
        }
      }
    }
  }
  await checkDirectory(source);
});

test('invalid set input is rejected before the storage port receives a write', async () => {
  const store = new MemoryWorkoutStore();
  const service = createFormaService({
    store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id' },
  });
  try {
    await assert.rejects(service.workouts.addSet({ requestId: nextRequestId(),
      workoutId: 'not-loaded', exerciseId: 'leg-curls', reps: 0, weightKg: 20,
    }), errorCode('INVALID_INPUT', 'reps'));
    assert.equal(store.writes, 0);
    assert.equal(store.saves, 0);
  } finally { await service.close(); }
});

test('injected clock controls audit time but not the explicit workout day', async () => {
  const store = new MemoryWorkoutStore();
  let time = '2026-10-12T23:59:59.000Z';
  let id = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => time }, ids: { next: () => 'id-' + ++id } });
  try {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-13' });
    assert.equal(workout.date, '2026-10-13');
    time = '2026-10-13T00:00:01.000Z';
    await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const updated = await service.workouts.get(workout.id);
    assert.equal(updated.createdAt, '2026-10-12T23:59:59.000Z');
    assert.equal(updated.updatedAt, time);
  } finally { await service.close(); }
});

test('duplicate generated workout IDs do not replace an existing workout', async () => {
  const store = new MemoryWorkoutStore();
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'same' } });
  try {
    const first = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    await assert.rejects(service.workouts.create({ requestId: nextRequestId(), date: '2026-10-11' }), errorCode('CONFLICT', 'id'));
    assert.deepEqual(await service.workouts.get(first.id), first);
  } finally { await service.close(); }
});

test('duplicate generated set IDs are rejected by the core', async () => {
  const store = new MemoryWorkoutStore();
  let next = 0;
  const service = createFormaService({
    store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => next++ === 0 ? 'workout' : 'same-set' },
  });
  try {
    const workout = await service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' });
    await service.workouts.addSet({ requestId: nextRequestId(), workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    await assert.rejects(service.workouts.addSet({ requestId: nextRequestId(),
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20,
    }), errorCode('CONFLICT', 'id'));
    assert.equal((await service.workouts.get(workout.id)).sets.length, 1);
  } finally { await service.close(); }
});

test('invalid injected IDs and clock values cannot create records', async () => {
  for (const [id, clock, field] of [
    ['', TEST_TIME, 'id'],
    ['new', 'not-a-time', 'clock'],
    ['new', '2026-02-30T09:00:00.000Z', 'clock'],
  ]) {
    assert(id !== undefined && clock !== undefined && field !== undefined);
    const store = new MemoryWorkoutStore();
    const service = createFormaService({ store, clock: { nowUtc: () => clock }, ids: { next: () => id } });
    try {
      await assert.rejects(service.workouts.create({ requestId: nextRequestId(), date: '2026-10-12' }), errorCode('INVALID_INPUT', field));
      assert.equal(store.workouts.size, 0);
    } finally { await service.close(); }
  }
});

test('service close calls the adapter once', async () => {
  const store = new MemoryWorkoutStore();
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id' } });
  await Promise.all([service.close(), service.close()]);
  assert.equal(store.closeCalls, 1);
});
