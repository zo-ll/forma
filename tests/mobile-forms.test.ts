import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FormaError } from '@forma/core';
import {
  EMPTY_SET_DRAFT, addSetSlot, commandSignature, createCommandLedger, createDraftStore, draftHasText, parseDecimal,
  parseOptionalDecimal, parseSetDraft, parseWholeNumber,
} from '../apps/mobile/src/forms/index.js';
import { memoryFixture } from './helpers.js';

function sequence(prefix: string): { next(): string } {
  let count = 0;
  return { next: () => prefix + '-' + ++count };
}

test('a double tap sends one command and both taps get the same result', async () => {
  const ledger = createCommandLedger(sequence('req'));
  const sent: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const send = async (requestId: string): Promise<string> => { sent.push(requestId); await gate; return 'saved-' + requestId; };
  const first = ledger.run('add', { reps: 8 }, send);
  const second = ledger.run('add', { reps: 8 }, send);
  assert.equal(first, second);
  assert.equal(ledger.current('add'), first);
  assert.equal(ledger.busy('add'), true);
  assert.deepEqual(ledger.pending('add'), { requestId: 'req-1', input: { reps: 8 }, unconfirmed: false });
  release();
  assert.equal(await first, 'saved-req-1');
  assert.deepEqual(sent, ['req-1']);
  assert.equal(ledger.pending('add'), null);
  assert.equal(ledger.current('add'), null);
});

test('a confirmed result clears the slot so the next set gets a new key', async () => {
  const ledger = createCommandLedger(sequence('req'));
  const keys: string[] = [];
  const send = async (requestId: string) => { keys.push(requestId); };
  await ledger.run('add', { reps: 8 }, send);
  await ledger.run('add', { reps: 8 }, send);
  assert.deepEqual(keys, ['req-1', 'req-2']);
});

test('an unconfirmed failure keeps the saved key and input for a retry', async () => {
  const ledger = createCommandLedger(sequence('req'));
  const keys: string[] = [];
  let fail = true;
  const send = async (requestId: string, input: { reps: number }) => {
    keys.push(requestId + ':' + input.reps);
    if (fail) throw new FormaError('STORAGE_FAILURE', 'disk');
  };
  await assert.rejects(ledger.run('add', { reps: 8 }, send));
  assert.deepEqual(ledger.pending('add'), { requestId: 'req-1', input: { reps: 8 }, unconfirmed: true });
  await assert.rejects(ledger.run('add', { reps: 8 }, send));
  fail = false;
  await ledger.run('add', { reps: 8 }, send);
  assert.deepEqual(keys, ['req-1:8', 'req-1:8', 'req-1:8']);
});

test('a non-Forma failure is also unconfirmed', async () => {
  const ledger = createCommandLedger(sequence('req'));
  await assert.rejects(ledger.run('add', { reps: 8 }, async () => { throw new Error('bridge lost'); }));
  assert.equal(ledger.pending('add')?.unconfirmed, true);
});

test('changed input after an unconfirmed failure is a new command with a new key', async () => {
  const ledger = createCommandLedger(sequence('req'));
  await assert.rejects(ledger.run('add', { reps: 8 }, async () => { throw new FormaError('STORAGE_FAILURE', 'disk'); }));
  const keys: string[] = [];
  await ledger.run('add', { reps: 9 }, async (requestId) => { keys.push(requestId); });
  assert.deepEqual(keys, ['req-2']);
});

test('a definitive core rejection frees the slot', async () => {
  for (const code of ['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT'] as const) {
    const ledger = createCommandLedger(sequence('req'));
    await assert.rejects(ledger.run('add', { reps: 0 }, async () => { throw new FormaError(code, 'no'); }));
    assert.equal(ledger.pending('add'), null, code);
  }
});

test('forget drops only an idle slot', async () => {
  const ledger = createCommandLedger(sequence('req'));
  await assert.rejects(ledger.run('add', { reps: 8 }, async () => { throw new FormaError('SERVICE_CLOSED', 'closed'); }));
  ledger.forget('add');
  assert.equal(ledger.pending('add'), null);
  let release!: () => void;
  const running = ledger.run('add', { reps: 8 }, () => new Promise<void>((done) => { release = done; }));
  ledger.forget('add');
  assert.equal(ledger.busy('add'), true);
  release();
  await running;
});

test('signatures ignore property order and undefined fields', () => {
  assert.equal(commandSignature({ a: 1, b: [1, { c: 2 }] }), commandSignature({ b: [1, { c: 2 }], a: 1, d: undefined }));
  assert.notEqual(commandSignature({ a: 1 }), commandSignature({ a: '1' }));
});

test('double tap on start through the real service saves one in-progress workout', async (t) => {
  const { service } = memoryFixture(t);
  const ledger = createCommandLedger(sequence('start'));
  const input = { date: '2026-10-12', splitDayId: 'upper' };
  const send = (requestId: string, saved: typeof input) => service.workouts.start({ requestId, ...saved });
  const [first, second] = await Promise.all([ledger.run('start', input, send), ledger.run('start', input, send)]);
  assert.equal(first.id, second.id);
  const all = await service.workouts.history({ status: 'all' });
  assert.equal(all.items.length, 1);
  assert.equal((await service.workouts.inProgress())?.splitDayId, 'upper');
});

test('a retry after an unconfirmed set add replays the receipt without a duplicate set', async (t) => {
  const { service } = memoryFixture(t);
  const workout = await service.workouts.start({ requestId: 'start-1', date: '2026-10-12', splitDayId: 'upper' });
  const ledger = createCommandLedger(sequence('set'));
  const input = { workoutId: workout.id, exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 22.5 };
  let lose = true;
  const send = async (requestId: string, saved: typeof input) => {
    const result = await service.workouts.addSet({ requestId, ...saved });
    // The write commits, but the UI loses the answer.
    if (lose) throw new Error('bridge lost');
    return result;
  };
  await assert.rejects(ledger.run('add', input, send));
  lose = false;
  const replay = await ledger.run('add', input, send);
  const saved = await service.workouts.get(workout.id);
  assert.equal(saved.sets.length, 1);
  assert.equal(saved.sets[0]?.id, replay.id);
});

test('an unconfirmed add survives another exercise save and replays without a duplicate', async (t) => {
  const { service } = memoryFixture(t);
  const workout = await service.workouts.start({ requestId: 'start-1', date: '2026-10-12', splitDayId: 'upper' });
  const ledger = createCommandLedger(sequence('set'));
  const first = { workoutId: workout.id, exerciseId: 'incline-dumbbell-press', reps: 8, weightKg: 22.5 };
  const second = { ...first, exerciseId: 'lat-pulldown', weightKg: 50 };
  const firstSlot = addSetSlot(workout.id, first.exerciseId);
  const secondSlot = addSetSlot(workout.id, second.exerciseId);
  const keys: string[] = [];
  const send = async (requestId: string, saved: typeof first) => {
    keys.push(requestId);
    return service.workouts.addSet({ requestId, ...saved });
  };
  await assert.rejects(ledger.run(firstSlot, first, async (requestId, saved) => {
    await send(requestId, saved);
    throw new Error('answer lost after commit');
  }));
  const pending = ledger.pending(firstSlot);
  assert.equal(pending?.unconfirmed, true);
  await ledger.run(secondSlot, second, send);
  // Switching exercises must not remove the original key or input.
  assert.deepEqual(ledger.pending(firstSlot), pending);
  const replay = await ledger.run(firstSlot, first, send);
  const saved = await service.workouts.get(workout.id);
  assert.equal(saved.sets.length, 2);
  assert.equal(saved.sets.filter(set => set.exerciseId === first.exerciseId).length, 1);
  assert.equal(saved.sets[0]?.id, replay.id);
  assert.deepEqual(keys, ['set-1', 'set-2', 'set-1']);
  assert.equal(ledger.pending(firstSlot), null);
});

test('add-set slots distinguish workouts and exercises even when IDs contain separators', () => {
  assert.notEqual(addSetSlot('workout', 'a'), addSetSlot('workout', 'b'));
  assert.notEqual(addSetSlot('workout-a', 'a'), addSetSlot('workout-b', 'a'));
  assert.notEqual(addSetSlot('a:b', 'c'), addSetSlot('a', 'b:c'));
});

test('drafts keep values until cleared', () => {
  const drafts = createDraftStore();
  assert.equal(drafts.get('set'), null);
  drafts.set('set', { reps: '8', weight: '57.5' });
  assert.deepEqual(drafts.get('set'), { reps: '8', weight: '57.5' });
  drafts.clear('set');
  assert.equal(drafts.get('set'), null);
});

test('keyboard parsing reports the field and leaves ranges to the core', () => {
  assert.deepEqual(parseWholeNumber(' 10 ', 'reps', 'reps'), { ok: true, value: 10 });
  assert.deepEqual(parseWholeNumber('0', 'reps', 'reps'), { ok: true, value: 0 });
  assert.deepEqual(parseWholeNumber('', 'reps', 'reps'), { ok: false, problems: [{ field: 'reps', message: 'Enter reps.' }] });
  assert.deepEqual(parseWholeNumber('8.5', 'reps', 'reps'),
    { ok: false, problems: [{ field: 'reps', message: 'Reps must be digits only.' }] });
  assert.deepEqual(parseDecimal('57,5', 'weightKg', 'weight'), { ok: true, value: 57.5 });
  assert.deepEqual(parseDecimal('-5', 'weightKg', 'weight'), { ok: true, value: -5 });
  assert.equal(parseDecimal('5kg', 'weightKg', 'weight').ok, false);
  assert.deepEqual(parseOptionalDecimal(' ', 'rpe', 'RPE'), { ok: true, value: null });
  assert.deepEqual(parseOptionalDecimal('8.5', 'rpe', 'RPE'), { ok: true, value: 8.5 });
});

test('a set draft reports every typing problem with the core field names', () => {
  const parsed = parseSetDraft({ reps: '', weight: 'x', rpe: 'high', loadConvention: 'unknown', implementCount: null });
  assert.deepEqual(parsed, { ok: false, problems: [
    { field: 'reps', message: 'Enter reps.' },
    { field: 'weightKg', message: 'Weight must be a number.' },
    { field: 'rpe', message: 'RPE must be a number.' },
  ] });
});

test('a valid set draft keeps the load choice and an empty RPE as null', () => {
  assert.deepEqual(parseSetDraft({ reps: '10', weight: '22,5', rpe: '', loadConvention: 'per-hand', implementCount: 2 }),
    { ok: true, value: { reps: 10, weightKg: 22.5, rpe: null, loadConvention: 'per-hand', implementCount: 2 } });
  assert.equal(draftHasText(EMPTY_SET_DRAFT), false);
  assert.equal(draftHasText({ ...EMPTY_SET_DRAFT, rpe: '8' }), true);
});

test('the core still rejects a parsed value outside the record rules', async (t) => {
  const { service } = memoryFixture(t);
  const workout = await service.workouts.start({ requestId: 'start-1', date: '2026-10-12', splitDayId: 'upper' });
  const parsed = parseSetDraft({ reps: '0', weight: '55', rpe: '11', loadConvention: 'entered', implementCount: null });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const { rpe, loadConvention, ...numbers } = parsed.value;
  await assert.rejects(service.workouts.addSet({
    requestId: 'set-1', workoutId: workout.id, exerciseId: 'lat-pulldown', ...numbers,
    loadConvention: loadConvention as 'entered', ...(rpe === null ? {} : { rpe }),
  }), (error: unknown) => error instanceof FormaError && error.code === 'INVALID_INPUT' && error.field === 'reps');
});
