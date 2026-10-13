import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { FormaError, createFormaService } from '@forma/core';
import type { FormaService } from '@forma/core';
import { createMobileHost } from '@forma/mobile-host';
import type { MobileHost } from '@forma/mobile-host';
import { createCommandLedger, createDraftStore } from '../apps/mobile/src/forms/index.js';
import { errorCode, MemoryWorkoutStore, TEST_TIME } from './helpers.js';

interface Setup { readonly host: MobileHost; readonly store: MemoryWorkoutStore; }
async function started(t: TestContext, prefix: string): Promise<Setup> {
  const store = new MemoryWorkoutStore();
  let next = 0;
  let saved: string | null = null;
  const host = createMobileHost({
    openService: () => createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => prefix + '-' + ++next } }),
    preferences: { read: () => saved, write: (value) => { saved = value; } },
    platform: { timeZone: () => 'Europe/Rome', nowUtc: () => TEST_TIME },
  });
  t.after(() => host.close());
  await host.start();
  return { host, store };
}

async function archiveOf(t: TestContext): Promise<string> {
  const { host } = await started(t, 'src');
  const service = host.service();
  const workout = await service.workouts.start({ requestId: 'src-start', date: '2026-10-01' });
  await service.workouts.addSet({ requestId: 'src-set', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
  return (await service.archive.export()).text;
}

async function confirmed(service: FormaService, text: string, requestId: string) {
  const inspection = await service.archive.inspect({ text });
  return { requestId, text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision };
}

test('replaceRecords shows the restoring phase, advances the epoch, and keeps the core exclusion', async (t) => {
  const text = await archiveOf(t);
  const { host, store } = await started(t, 'dst');
  const cached = host.service();
  const input = await confirmed(cached, text, 'restore-1');
  const phases: string[] = [];
  host.subscribe(() => phases.push(host.snapshot().phase));
  assert.equal(host.snapshot().recordsEpoch, 0);
  let during: unknown;
  const result = await host.replaceRecords(async (service) => {
    assert.equal(host.snapshot().phase, 'restoring');
    assert.throws(() => host.service(), errorCode('CONFLICT', 'restore'));
    const restoring = service.archive.restore(input);
    // A service reference saved before the restore cannot bypass the core exclusion.
    during = await cached.workouts.list().catch((error: unknown) => error);
    return restoring;
  });
  assert(during instanceof FormaError && during.code === 'CONFLICT' && during.field === 'restore');
  assert.equal(result.counts.workouts, 1);
  assert.equal(store.replacements, 1);
  assert.deepEqual(phases, ['restoring', 'ready']);
  assert.equal(host.snapshot().recordsEpoch, 1);
  assert.equal((await host.service().workouts.inProgress())?.id, 'src-1');
});

test('a definitive rejection keeps the epoch, and an unconfirmed failure advances it', async (t) => {
  const text = await archiveOf(t);
  const { host } = await started(t, 'dst');
  const input = await confirmed(host.service(), text, 'restore-2');
  await host.service().workouts.create({ requestId: 'between', date: '2026-10-02' });
  await assert.rejects(host.replaceRecords((service) => service.archive.restore(input)), errorCode('CONFLICT', 'expectedHistoryRevision'));
  assert.equal(host.snapshot().recordsEpoch, 0);
  assert.equal(host.snapshot().phase, 'ready');
  await assert.rejects(host.replaceRecords(async () => { throw new FormaError('STORAGE_FAILURE', 'Unknown commit state.'); }),
    errorCode('STORAGE_FAILURE'));
  assert.equal(host.snapshot().recordsEpoch, 1);
  await assert.rejects(host.replaceRecords(async () => { throw new Error('Native failure'); }), /Native failure/);
  assert.equal(host.snapshot().recordsEpoch, 2);
  assert.equal(host.snapshot().phase, 'ready');
});

test('background during restore, queued close, and a closed host behave safely', async (t) => {
  const text = await archiveOf(t);
  const { host } = await started(t, 'dst');
  const input = await confirmed(host.service(), text, 'restore-3');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const replacing = host.replaceRecords(async (service) => { await gate; return service.archive.restore(input); });
  await Promise.resolve();
  host.background();
  assert.equal(host.snapshot().phase, 'restoring');
  const closing = host.close();
  release();
  assert.equal((await replacing).counts.workouts, 1);
  await closing;
  assert.equal(host.snapshot().phase, 'closed');
  assert.equal(host.snapshot().recordsEpoch, 1);
  await assert.rejects(host.replaceRecords(async () => 1), errorCode('SERVICE_CLOSED'));
});

test('background during restore returns to background', async (t) => {
  const { host } = await started(t, 'dst');
  await host.replaceRecords(async () => { host.background(); });
  assert.equal(host.snapshot().phase, 'background');
  await host.resume();
  assert.equal(host.snapshot().phase, 'ready');
});

test('form reset drops saved commands and drafts after a records change', async () => {
  let id = 0;
  const ledger = createCommandLedger({ next: () => 'req-' + ++id });
  const drafts = createDraftStore();
  await assert.rejects(ledger.run('slot', { value: 1 }, async () => { throw new FormaError('STORAGE_FAILURE', 'Unknown'); }));
  assert.equal(ledger.pending('slot')?.unconfirmed, true);
  let release!: () => void;
  const running = ledger.run('running', { value: 2 }, () => new Promise<string>((resolve) => { release = () => resolve('done'); }));
  drafts.set('draft', { reps: '8' });
  ledger.clear();
  drafts.clearAll();
  assert.equal(ledger.pending('slot'), null);
  assert.equal(ledger.busy('running'), false);
  assert.equal(drafts.get('draft'), null);
  release();
  assert.equal(await running, 'done');
  assert.equal(ledger.pending('running'), null);
  // A new command after the reset gets a new key.
  let key = '';
  await ledger.run('slot', { value: 1 }, async (requestId) => { key = requestId; });
  assert.equal(key, 'req-3');
});
