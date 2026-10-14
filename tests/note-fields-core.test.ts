import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createNotesModule, FormaError, NOTE_FIELD_LIMITS } from '@forma/core';
import type { ConfirmNoteFieldsInput, NotesReader, NotesWriter, PainField } from '@forma/core';
import { noteFieldsContract } from './note-fields-contract.js';
import { fieldsWithPain, leftKnee } from './fixtures/note-field-cases.js';
import { MemoryNotesStore } from './notes-memory.js';
import { errorCode, TEST_TIME } from './helpers.js';

function fixture(t: TestContext, store = new MemoryNotesStore()) {
  let next = 0;
  const module = createNotesModule({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'note-' + ++next } });
  t.after(() => module.close());
  return module;
}
noteFieldsContract('memory note fields', fixture);

test('fields read does not write, use IDs, or use the clock', async (t) => {
  const store = new MemoryNotesStore();
  let unavailable = false; let calls = 0;
  const module = createNotesModule({
    store, clock: { nowUtc: () => { assert.equal(unavailable, false); calls++; return TEST_TIME; } },
    ids: { next: () => { assert.equal(unavailable, false); return 'one'; } },
  });
  t.after(() => module.close());
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'left knee hurts' });
  unavailable = true;
  const writes = store.writes;
  await module.notes.fields(note.id); await module.notes.fields(note.id);
  assert.equal(store.writes, writes); assert.equal(store.state.confirmations.size, 0); assert.equal(calls, 1);
});

test('invalid field inputs fail before the receipt lookup or mutation', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const input = { requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
  const bad: readonly [unknown, string][] = [
    [null, 'input'], [{ pain: [] }, 'input'], [{ pain: null, sleep: null, personalBest: null }, 'pain'],
    [{ ...fieldsWithPain(), pain: [null] }, 'input'],
    [fieldsWithPain([{ ...leftKnee(), bodyPart: 'brain' } as unknown as PainField]), 'bodyPart'],
    [fieldsWithPain([{ ...leftKnee(), side: 'middle' } as unknown as PainField]), 'side'],
    [fieldsWithPain([{ ...leftKnee(), state: 'maybe' } as unknown as PainField]), 'state'],
    [fieldsWithPain([leftKnee('present', 0)]), 'severity'],
    [fieldsWithPain([leftKnee('absent', 1)]), 'severity'],
    [fieldsWithPain([leftKnee('uncertain', 1)]), 'severity'],
    [fieldsWithPain([leftKnee('present', -1)]), 'severity'],
    [fieldsWithPain([leftKnee('present', 11)]), 'severity'],
    [fieldsWithPain([leftKnee('present', Infinity)]), 'severity'],
    [fieldsWithPain([{ ...leftKnee(), severity: undefined } as unknown as PainField]), 'severity'],
    [fieldsWithPain([{ ...leftKnee(), otherBodyPart: 'override' }]), 'otherBodyPart'],
    [fieldsWithPain([{ ...leftKnee(), bodyPart: 'other' }]), 'otherBodyPart'],
    [fieldsWithPain([{ ...leftKnee(), bodyPart: 'other', otherBodyPart: 'x'.repeat(129) }]), 'otherBodyPart'],
    [fieldsWithPain([{ ...leftKnee(), bodyPart: 'other', otherBodyPart: '\ud800' }]), 'otherBodyPart'],
    [{ ...fieldsWithPain(), sleep: { durationMin: null, quality: null } }, 'sleep'],
    [{ ...fieldsWithPain(), sleep: { durationMin: -1, quality: null } }, 'durationMin'],
    [{ ...fieldsWithPain(), sleep: { durationMin: 1441, quality: null } }, 'durationMin'],
    [{ ...fieldsWithPain(), sleep: { durationMin: NaN, quality: null } }, 'durationMin'],
    [{ ...fieldsWithPain(), sleep: { durationMin: 60, quality: 'excellent' } }, 'quality'],
    [{ ...fieldsWithPain(), sleep: { durationMin: 60 } }, 'quality'],
    [{ ...fieldsWithPain(), personalBest: { claimText: '' } }, 'claimText'],
    [{ ...fieldsWithPain(), personalBest: { claimText: '\u0000' } }, 'claimText'],
    [{ ...fieldsWithPain(), personalBest: { claimText: 'x'.repeat(1025) } }, 'claimText'],
    [{ ...fieldsWithPain(), personalBest: { claimText: 'PB', weightKg: 100 } }, 'weightKg'],
    [{ ...fieldsWithPain(), food: 'placeholder' }, 'food'],
  ];
  for (const [fields, field] of bad) {
    const writes = store.writes;
    await assert.rejects(module.notes.confirmFields({ ...input, fields } as ConfirmNoteFieldsInput),
      errorCode('INVALID_INPUT', field));
    assert.equal(store.writes, writes);
    assert.equal(store.state.confirmations.size, 0);
    assert.equal(store.state.notes.get(note.id)!.revision, 1);
  }
});

test('pain fields reject duplicates and overlapping sides but permit left and right', async (t) => {
  const module = fixture(t);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  for (const other of [leftKnee(), { ...leftKnee(), side: 'bilateral' as const }, { ...leftKnee(), side: 'unspecified' as const }]) {
    await assert.rejects(module.notes.confirmFields({
      requestId: 'bad', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([leftKnee(), other]),
    }), errorCode('INVALID_INPUT', 'pain'));
  }
  const right = { ...leftKnee('absent', 0), side: 'right' as const };
  const result = await module.notes.confirmFields({
    requestId: 'valid', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([right, leftKnee('present', 2.5)]),
  });
  assert.deepEqual(result.fields.pain, [leftKnee('present', 2.5), right]);
  const reordered = await module.notes.confirmFields({
    requestId: 'valid', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([leftKnee('present', 2.5), right]),
  });
  assert.deepEqual(reordered, result);
});

test('other locations preserve explicit text and reject case-equivalent overlaps', async (t) => {
  const module = fixture(t);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const other: PainField = { ...leftKnee(), bodyPart: 'other', otherBodyPart: '  Jaw  ' };
  await assert.rejects(module.notes.confirmFields({
    requestId: 'bad', noteId: note.id, expectedRevision: 1,
    fields: fieldsWithPain([other, { ...other, otherBodyPart: 'jaw' }]),
  }), errorCode('INVALID_INPUT', 'pain'));
  const result = await module.notes.confirmFields({
    requestId: 'valid', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([other]),
  });
  assert.equal(result.fields.pain[0]!.otherBodyPart, '  Jaw  ');
});

test('field budgets accept maxima and reject an over-budget array', async (t) => {
  const module = fixture(t);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const pain: PainField[] = Array.from({ length: NOTE_FIELD_LIMITS.maxPainEntries }, (_, i) => ({
    ...leftKnee(), bodyPart: 'other', otherBodyPart: 'location-' + i,
  }));
  await assert.rejects(module.notes.confirmFields({
    requestId: 'bad', noteId: note.id, expectedRevision: 1,
    fields: fieldsWithPain([...pain, { ...leftKnee(), bodyPart: 'other', otherBodyPart: 'extra' }]),
  }), errorCode('INVALID_INPUT', 'pain'));
  const result = await module.notes.confirmFields({
    requestId: 'valid', noteId: note.id, expectedRevision: 1,
    fields: { pain, sleep: { durationMin: 1440, quality: 'fair' }, personalBest: { claimText: 'x'.repeat(1024) } },
  });
  assert.equal(result.fields.pain.length, 32); assert.equal(result.fields.sleep!.durationMin, 1440);
});

test('every ordinary edit invalidates confirmation, even if text stays identical', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  let note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'left knee hurts' });
  let next = 0;
  for (const patch of [{ date: '2026-10-13' }, { kind: 'pain' as const }, { text: 'left knee hurts' }]) {
    const confirmation = await module.notes.confirmFields({
      requestId: 'confirm-' + ++next, noteId: note.id, expectedRevision: note.revision, fields: fieldsWithPain(),
    });
    note = await module.notes.update({ requestId: 'edit-' + next, noteId: note.id, expectedRevision: confirmation.source.revision, ...patch });
    assert.equal(store.state.confirmations.has(note.id), false);
    assert.equal((await module.notes.fields(note.id)).confirmation, null);
  }
});

test('confirmation, primary revision, history, and receipt roll back together', async (t) => {
  class FaultStore extends MemoryNotesStore {
    failure: 'confirmation' | 'receipt' | null = null;
    override write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T> {
      return super.write((writer) => run({
        ...writer,
        saveNoteConfirmation: async (value) => {
          await writer.saveNoteConfirmation(value);
          if (this.failure === 'confirmation') throw new FormaError('STORAGE_FAILURE', 'Injected confirmation failure.');
        },
        saveRequestReceipt: async (value) => {
          if (this.failure === 'receipt') throw new FormaError('STORAGE_FAILURE', 'Injected receipt failure.');
          await writer.saveRequestReceipt(value);
        },
      }));
    }
  }
  const store = new FaultStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'left knee hurts' });
  const original = await module.notes.confirmFields({
    requestId: 'first', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
  });
  const current = await module.notes.get(note.id);
  const revision = store.state.revision;
  const input = { requestId: 'next', noteId: note.id, expectedRevision: 2, fields: fieldsWithPain([leftKnee('absent')]) };
  for (const failure of ['confirmation', 'receipt'] as const) {
    store.failure = failure;
    await assert.rejects(module.notes.confirmFields(input), errorCode('STORAGE_FAILURE'));
    assert.deepEqual(await module.notes.get(note.id), current);
    assert.deepEqual((await module.notes.fields(note.id)).confirmation, original);
    assert.equal(store.state.revision, revision); assert.equal(store.state.receipts.has('next'), false);
  }
  store.failure = null;
  assert.equal((await module.notes.confirmFields(input)).source.revision, 3);
});

test('failed edit and deletion preserve the old confirmation and source', async (t) => {
  class FaultStore extends MemoryNotesStore {
    fail = false;
    override write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T> {
      return super.write((writer) => run({
        ...writer, clearNoteConfirmation: async (id) => {
          await writer.clearNoteConfirmation(id);
          if (this.fail) throw new FormaError('STORAGE_FAILURE', 'Injected clear failure.');
        },
      }));
    }
  }
  const store = new FaultStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'left knee hurts' });
  const confirmation = await module.notes.confirmFields({
    requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
  });
  store.fail = true;
  await assert.rejects(module.notes.update({
    requestId: 'edit', noteId: note.id, expectedRevision: 2, text: 'fine',
  }), errorCode('STORAGE_FAILURE'));
  await assert.rejects(module.notes.delete({
    requestId: 'delete', noteId: note.id, expectedRevision: 2,
  }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual((await module.notes.fields(note.id)).confirmation, confirmation);
  assert.equal((await module.notes.get(note.id)).revision, 2);
  assert.equal(store.state.receipts.size, 2);
  store.fail = false;
  await module.notes.delete({ requestId: 'delete', noteId: note.id, expectedRevision: 2 });
  assert.equal(store.state.confirmations.size, 0);
});

test('replay skips clock and primary writes, including after a later confirmation', async (t) => {
  const store = new MemoryNotesStore();
  let now = TEST_TIME; let clockCalls = 0;
  const module = createNotesModule({ store, clock: { nowUtc: () => { clockCalls++; return now; } }, ids: { next: () => 'one' } });
  t.after(() => module.close());
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const input = { requestId: 'first', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
  const first = await module.notes.confirmFields(input);
  now = '2026-10-15T11:00:00.000Z';
  const second = await module.notes.confirmFields({
    requestId: 'second', noteId: note.id, expectedRevision: 2, fields: fieldsWithPain([leftKnee('absent')]),
  });
  assert.equal(second.confirmedAt, now);
  now = 'invalid';
  const saves = store.saves;
  assert.deepEqual(await module.notes.confirmFields(input), first);
  assert.deepEqual((await module.notes.fields(note.id)).confirmation, second);
  assert.equal(clockCalls, 3); assert.equal(store.saves, saves);
});

test('queued confirmation captures complete fields before a store wait', async (t) => {
  const module = fixture(t);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const fields = { pain: [{ ...leftKnee('present', 3) }], sleep: null, personalBest: { claimText: 'PB' } };
  const pending = module.notes.confirmFields({ requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields });
  fields.pain[0]!.severity = 9; fields.personalBest.claimText = 'changed';
  const result = await pending;
  assert.equal(result.fields.pain[0]!.severity, 3); assert.equal(result.fields.personalBest!.claimText, 'PB');
});

test('malformed and mismatched confirmation receipts fail without restoring state', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const input = { requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
  const result = await module.notes.confirmFields(input);
  const receipt = store.state.receipts.get('confirm')!;
  for (const value of [
    null, { ...result, formatVersion: 2 }, { ...result, confirmedAt: 'bad' },
    { ...result, source: { ...result.source, noteId: 'other' } },
    { ...result, source: { ...result.source, revision: 1 } },
    { ...result, fields: fieldsWithPain([leftKnee('absent')]) },
    { ...result, fields: fieldsWithPain([leftKnee('present', 0)]) },
  ]) {
    store.state.receipts.set('confirm', { ...receipt, resultJson: JSON.stringify(value) });
    await assert.rejects(module.notes.confirmFields(input), errorCode('STORAGE_FAILURE'));
    assert.equal(store.state.notes.get(note.id)!.revision, 2);
    assert.equal(store.state.revision, 2);
  }
});

test('field views reject malformed storage but suppress valid obsolete confirmation', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const confirmation = await module.notes.confirmFields({
    requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
  });
  store.state.confirmations.set(note.id, { ...confirmation, confirmedAt: 'bad' });
  await assert.rejects(module.notes.fields(note.id), errorCode('STORAGE_FAILURE'));
  store.state.confirmations.set(note.id, { ...confirmation, source: { ...confirmation.source, noteId: 'other' } });
  await assert.rejects(module.notes.fields(note.id), errorCode('STORAGE_FAILURE'));
  store.state.confirmations.set(note.id, confirmation);
  store.state.notes.set(note.id, { ...store.state.notes.get(note.id)!, revision: 3 });
  const view = await module.notes.fields(note.id);
  assert.equal(view.confirmation, null); assert.equal(view.source.revision, 3);
  assert.equal(store.state.confirmations.size, 1); // A read never repairs storage by mutation.
});

test('retained memory state preserves exact confirmation and original receipts', async (t) => {
  const store = new MemoryNotesStore();
  const first = fixture(t, store);
  const input = { requestId: 'one', date: '2026-10-14', text: 'original' };
  const note = await first.notes.create(input);
  const confirmationInput = { requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
  const confirmation = await first.notes.confirmFields(confirmationInput);
  const receiptJson = JSON.stringify([...store.state.receipts]);
  await first.close();
  const secondStore = new MemoryNotesStore(store.state);
  const second = fixture(t, secondStore);
  assert.deepEqual((await second.notes.fields(note.id)).confirmation, confirmation);
  assert.deepEqual(await second.notes.confirmFields(confirmationInput), confirmation);
  assert.deepEqual(await second.notes.create(input), note); // Released #18 DTO remains unchanged.
  assert.equal(JSON.stringify([...secondStore.state.receipts]), receiptJson);
});

test('returned confirmation and suggestion DTOs cannot mutate primary fields', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'left knee pain 3/10' });
  const input = { requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([leftKnee('present', 3)]) };
  const confirmation = await module.notes.confirmFields(input);
  (confirmation.fields.pain[0] as { severity: number }).severity = 8;
  const view = await module.notes.fields(note.id);
  assert.equal(view.confirmation!.fields.pain[0]!.severity, 3);
  (view.confirmation!.fields.pain[0] as { severity: number }).severity = 7;
  (view.suggestions.pain.items[0]!.value as { severity: number }).severity = 6;
  assert.equal((await module.notes.fields(note.id)).confirmation!.fields.pain[0]!.severity, 3);
  assert.equal((await module.notes.confirmFields(input)).fields.pain[0]!.severity, 3);
});

test('revision and clock failures do not remove earlier confirmation', async (t) => {
  const store = new MemoryNotesStore();
  let now = TEST_TIME;
  const module = createNotesModule({ store, clock: { nowUtc: () => now }, ids: { next: () => 'one' } });
  t.after(() => module.close());
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const confirmation = await module.notes.confirmFields({
    requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
  });
  now = 'bad';
  await assert.rejects(module.notes.confirmFields({
    requestId: 'bad-clock', noteId: note.id, expectedRevision: 2, fields: fieldsWithPain([]),
  }), errorCode('INVALID_INPUT', 'clock'));
  assert.deepEqual((await module.notes.fields(note.id)).confirmation, confirmation);
  store.state.notes.set(note.id, { ...store.state.notes.get(note.id)!, revision: Number.MAX_SAFE_INTEGER });
  await assert.rejects(module.notes.confirmFields({
    requestId: 'overflow', noteId: note.id, expectedRevision: Number.MAX_SAFE_INTEGER, fields: fieldsWithPain([]),
  }), errorCode('INVALID_INPUT', 'revision'));
  assert.equal(store.state.receipts.size, 2);
});

test('adapter history revision exhaustion rolls confirmation back without losing original fields', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  const original = await module.notes.confirmFields({
    requestId: 'first', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
  });
  store.state.revision = Number.MAX_SAFE_INTEGER;
  await assert.rejects(module.notes.confirmFields({
    requestId: 'next', noteId: note.id, expectedRevision: 2, fields: fieldsWithPain([]),
  }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual((await module.notes.fields(note.id)).confirmation, original);
  assert.equal((await module.notes.get(note.id)).revision, 2);
  assert.equal(store.state.receipts.has('next'), false);
});

test('confirmation inputs reject unsupported commands and missing sources without writes', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const input = { requestId: 'one', noteId: 'missing', expectedRevision: 1, fields: fieldsWithPain() };
  await assert.rejects(module.notes.fields(' bad'), errorCode('INVALID_INPUT', 'noteId'));
  await assert.rejects(module.notes.confirmFields({ ...input, expectedRevision: 0 }), errorCode('INVALID_INPUT', 'expectedRevision'));
  await assert.rejects(module.notes.confirmFields({ ...input, requestId: 'bad\u0000key' }), errorCode('INVALID_INPUT', 'requestId'));
  await assert.rejects(module.notes.confirmFields({ ...input, autoConfirm: true } as ConfirmNoteFieldsInput),
    errorCode('INVALID_INPUT', 'autoConfirm'));
  assert.equal(store.writes, 0);
  await assert.rejects(module.notes.confirmFields(input), errorCode('NOT_FOUND', 'noteId'));
  assert.equal(store.state.receipts.size, 0);
});

test('new field methods reject closed services and expired read views', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  let retained: NotesReader | undefined;
  await store.read(async (reader) => { retained = reader; });
  await assert.rejects(retained!.getNoteConfirmation('missing'), errorCode('STORAGE_FAILURE'));
  await module.close();
  await assert.rejects(module.notes.fields('missing'), errorCode('SERVICE_CLOSED'));
  await assert.rejects(module.notes.confirmFields({
    requestId: 'one', noteId: 'missing', expectedRevision: 1, fields: fieldsWithPain(),
  }), errorCode('SERVICE_CLOSED'));
});
