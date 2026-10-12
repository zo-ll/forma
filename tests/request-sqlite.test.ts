import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openNodeForma } from '@forma/adapters/node';
import type { FormaService, Workout } from '@forma/core';
import { errorCode, TEST_TIME } from './helpers.js';

async function fixture(t: TestContext): Promise<{ path: string; service: FormaService; reopen(): Promise<FormaService> }> {
  const directory = await mkdtemp(join(tmpdir(), 'forma-requests-'));
  const path = join(directory, 'records.sqlite');
  let service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME } });
  t.after(async () => {
    try { await service.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  return {
    path, get service() { return service; },
    async reopen() {
      await service.close();
      service = openNodeForma({
        databasePath: path,
        clock: { nowUtc: () => { assert.fail('A replay must not use the clock'); } },
        ids: { next: () => { assert.fail('A replay must not create an ID'); } },
      });
      return service;
    },
  };
}

function inspect(path: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path);
  try { run(db); } finally { db.close(); }
}

test('all four command receipts survive restart and return their original results', async (t) => {
  const context = await fixture(t);
  const create = { requestId: 'restart-create', date: '2026-10-12', splitDayId: 'lower' };
  const workout = await context.service.workouts.create(create);
  const add = { requestId: 'restart-add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: 7.5 };
  const set = await context.service.workouts.addSet(add);
  const update = { requestId: 'restart-update', workoutId: workout.id, setId: set.id, reps: 10, rpe: null };
  const updated = await context.service.workouts.updateSet(update);
  const deletion = { requestId: 'restart-delete', workoutId: workout.id, setId: set.id };
  await context.service.workouts.deleteSet(deletion);
  const before = await context.service.workouts.get(workout.id);
  const reopened = await context.reopen();
  assert.deepEqual(await reopened.workouts.create(create), workout);
  assert.deepEqual(await reopened.workouts.addSet(add), set);
  assert.deepEqual(await reopened.workouts.updateSet(update), updated);
  assert.equal(await reopened.workouts.deleteSet(deletion), undefined);
  assert.deepEqual(await reopened.workouts.get(workout.id), before);
  await assert.rejects(reopened.workouts.create({ ...create, notes: 'Different input' }), errorCode('CONFLICT', 'requestId'));
  inspect(context.path, (db) => {
    assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts').get()?.count, 4);
    assert.equal(db.prepare('SELECT count(*) AS count FROM workouts').get()?.count, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sets').get()?.count, 0);
  });
});

test('a native receipt failure rolls back the primary record and leaves no successful receipt', async (t) => {
  const context = await fixture(t);
  inspect(context.path, (db) => db.exec(`
    CREATE TRIGGER fail_receipt BEFORE INSERT ON request_receipts
    BEGIN SELECT RAISE(ABORT, 'Simulated receipt failure'); END;
  `));
  const input = { requestId: 'native-retry', date: '2026-10-12' };
  await assert.rejects(context.service.workouts.create(input), errorCode('STORAGE_FAILURE'));
  inspect(context.path, (db) => {
    assert.equal(db.prepare('SELECT count(*) AS count FROM workouts').get()?.count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts').get()?.count, 0);
    db.exec('DROP TRIGGER fail_receipt');
  });
  const original = await context.service.workouts.create(input);
  assert.deepEqual(await context.service.workouts.create(input), original);
  inspect(context.path, (db) => {
    assert.equal(db.prepare('SELECT count(*) AS count FROM workouts').get()?.count, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts').get()?.count, 1);
  });
});

const corruptResults: { name: string; json: (original: Workout) => string }[] = [
  { name: 'invalid JSON', json: () => 'not-json' },
  { name: 'null', json: () => 'null' },
  { name: 'missing fields', json: () => '{}' },
  { name: 'invalid date', json: (original) => JSON.stringify({ ...original, date: '2026-02-30' }) },
  { name: 'invalid audit time', json: (original) => JSON.stringify({ ...original, updatedAt: 'invalid' }) },
  { name: 'negative duration', json: (original) => JSON.stringify({ ...original, durationMin: -1 }) },
  { name: 'invalid sets', json: (original) => JSON.stringify({ ...original, sets: {} }) },
  { name: 'invalid set reps', json: (original) => JSON.stringify({ ...original, sets: [
    { id: 'set', exerciseId: 'leg-curls', reps: 0, weightKg: 20, rpe: null, position: 0 },
  ] }) },
  { name: 'invalid set position', json: (original) => JSON.stringify({ ...original, sets: [
    { id: 'set', exerciseId: 'leg-curls', reps: 8, weightKg: 20, rpe: null, position: 1 },
  ] }) },
];
for (const corruption of corruptResults) {
  test('a cached result with ' + corruption.name + ' fails without a duplicate record', async (t) => {
    const context = await fixture(t);
    const input = { requestId: 'corrupt-receipt', date: '2026-10-12' };
    const original = await context.service.workouts.create(input);
    await context.service.close();
    inspect(context.path, (db) => {
      db.prepare('UPDATE request_receipts SET result_json = ? WHERE request_id = ?').run(corruption.json(original), input.requestId);
    });
    const reopened = await context.reopen();
    await assert.rejects(reopened.workouts.create(input), errorCode('STORAGE_FAILURE'));
    assert.deepEqual(await reopened.workouts.get(original.id), original);
    inspect(context.path, (db) => {
      assert.equal(db.prepare('SELECT count(*) AS count FROM workouts').get()?.count, 1);
      assert.equal(db.prepare('SELECT count(*) AS count FROM request_receipts').get()?.count, 1);
    });
  });
}

test('a corrupt deletion result does not restore or delete another set', async (t) => {
  const context = await fixture(t);
  const workout = await context.service.workouts.create({ requestId: 'void-create', date: '2026-10-12' });
  const set = await context.service.workouts.addSet({ requestId: 'void-add', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  const deletion = { requestId: 'void-delete', workoutId: workout.id, setId: set.id };
  await context.service.workouts.deleteSet(deletion);
  await context.service.close();
  inspect(context.path, (db) => db.prepare('UPDATE request_receipts SET result_json = ? WHERE request_id = ?').run('{}', deletion.requestId));
  const reopened = await context.reopen();
  await assert.rejects(reopened.workouts.deleteSet(deletion), errorCode('STORAGE_FAILURE'));
  assert.deepEqual((await reopened.workouts.get(workout.id)).sets, []);
});
