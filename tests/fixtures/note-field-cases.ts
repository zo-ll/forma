import type { NoteFields, NotesModule, PainField } from '@forma/core';
import type { ContractAssert } from './contract-types.js';
import type { NoteContractCase } from './note-cases.js';
import { errorCode, nextRequestId } from './contract-helpers.js';

export function leftKnee(state: PainField['state'] = 'present', severity: number | null = null): PainField {
  return { bodyPart: 'knee', otherBodyPart: null, side: 'left', state, severity };
}
export function fieldsWithPain(pain: readonly PainField[] = [leftKnee()]): NoteFields {
  return { pain, sleep: null, personalBest: null };
}

/** Model-free shared contracts, ready for later SQLite and Android adapters. */
export function collectNoteFieldCases(assert: ContractAssert): readonly NoteContractCase[] {
  const create = (module: NotesModule, text = 'left knee pain 3/10') => module.notes.create({
    requestId: nextRequestId(), date: '2026-10-14', text,
  });
  return [
    { name: 'suggestions are not confirmed facts even for a pain-labeled note', async run(module) {
      const note = await module.notes.create({
        requestId: nextRequestId(), date: '2026-10-14', text: 'left knee pain 3/10', kind: 'pain',
      });
      const view = await module.notes.fields(note.id);
      assert.equal(view.state, 'pending');
      assert.equal(view.confirmation, null);
      assert.deepEqual(view.source, note.source);
      assert.deepEqual(view.suggestions.pain.items[0]!.value, leftKnee('present', 3));
      assert.equal(view.suggestions.pain.items[0]!.status, 'pending');
      assert.equal((await module.notes.get(note.id)).revision, 1);
    } },
    { name: 'negation proposes absence and body-part mention alone stays uncertain', async run(module) {
      const fine = await create(module, 'left knee felt fine');
      const view = await module.notes.fields(fine.id);
      assert.deepEqual(view.suggestions.pain.items[0]!.value, leftKnee('absent'));
      assert.equal(view.confirmation, null);
      const bare = await create(module, 'left knee range of motion');
      const uncertain = await module.notes.fields(bare.id);
      assert.equal(uncertain.state, 'uncertain');
      assert.deepEqual(uncertain.suggestions.pain.items[0]!.value, leftKnee('uncertain'));
    } },
    { name: 'explicit confirmation advances revision and preserves primary text', async run(module) {
      const note = await create(module);
      const fields = fieldsWithPain([leftKnee('present', 3)]);
      const confirmed = await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields,
      });
      assert.deepEqual(confirmed.fields, fields);
      assert.equal(confirmed.source.revision, 2);
      const current = await module.notes.get(note.id);
      assert.equal(current.revision, 2); assert.equal(current.text, note.text);
      assert.equal(current.date, note.date); assert.equal(current.kind, note.kind);
      assert.equal(current.createdAt, note.createdAt);
      const view = await module.notes.fields(note.id);
      assert.equal(view.state, 'confirmed');
      assert.deepEqual(view.source, current.source);
      assert.deepEqual(view.confirmation, confirmed);
    } },
    { name: 'manual confirmation works for text outside the English rules', async run(module) {
      const note = await create(module, 'Dolor en la rodilla izquierda');
      const confirmed = await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
      });
      assert.equal(confirmed.fields.pain[0]!.state, 'present');
      assert.equal((await module.notes.fields(note.id)).state, 'confirmed');
    } },
    { name: 'absence, uncertainty, and missing fields have different meanings', async run(module) {
      const note = await create(module, 'Nothing to extract');
      const missing = await module.notes.fields(note.id);
      assert.equal(missing.state, 'missing'); assert.equal(missing.confirmation, null);
      let confirmation = await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([leftKnee('absent', 0)]),
      });
      assert.equal(confirmation.fields.pain[0]!.state, 'absent');
      confirmation = await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 2, fields: fieldsWithPain([leftKnee('uncertain')]),
      });
      assert.equal(confirmation.fields.pain[0]!.state, 'uncertain');
      confirmation = await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 3, fields: fieldsWithPain([]),
      });
      assert.deepEqual(confirmation.fields.pain, []);
      assert.equal(confirmation.fields.sleep, null); assert.equal(confirmation.fields.personalBest, null);
    } },
    { name: 'edits atomically invalidate confirmation and refresh suggestions', async run(module) {
      const note = await create(module);
      await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields: fieldsWithPain(),
      });
      const edited = await module.notes.update({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 2, text: 'left knee felt fine',
      });
      const current = await module.notes.fields(note.id);
      assert.equal(current.confirmation, null);
      assert.equal(current.source.revision, edited.revision);
      assert.equal(current.suggestions.pain.items[0]!.value!.state, 'absent');
      await assert.rejects(module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 2, fields: fieldsWithPain(),
      }), errorCode('CONFLICT', 'expectedRevision'));
    } },
    { name: 'confirmation replay returns its snapshot without restoring obsolete facts', async run(module) {
      const note = await create(module);
      const input = { requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
      const confirmation = await module.notes.confirmFields(input);
      await module.notes.update({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 2, text: 'left knee felt fine',
      });
      assert.deepEqual(await module.notes.confirmFields(input), confirmation);
      assert.equal((await module.notes.fields(note.id)).confirmation, null);
      await module.notes.delete({ requestId: nextRequestId(), noteId: note.id, expectedRevision: 3 });
      assert.deepEqual(await module.notes.confirmFields(input), confirmation);
      await assert.rejects(module.notes.fields(note.id), errorCode('NOT_FOUND', 'noteId'));
    } },
    { name: 'duplicate confirmation requests share one new revision', async run(module) {
      const note = await create(module);
      const input = { requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
      const results = await Promise.all(Array.from({ length: 5 }, () => module.notes.confirmFields(input)));
      for (const result of results) assert.deepEqual(result, results[0]);
      assert.equal((await module.notes.get(note.id)).revision, 2);
      await assert.rejects(module.notes.confirmFields({ ...input, fields: fieldsWithPain([]) }),
        errorCode('CONFLICT', 'requestId'));
    } },
    { name: 'concurrent new confirmations cannot overwrite each other', async run(module) {
      const note = await create(module);
      const results = await Promise.allSettled(['present', 'absent'].map((state) => module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1,
        fields: fieldsWithPain([leftKnee(state as PainField['state'])]),
      })));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const failed = results.find((result) => result.status === 'rejected');
      assert(failed?.status === 'rejected');
      assert(errorCode('CONFLICT', 'expectedRevision')(failed.reason));
      assert.equal((await module.notes.get(note.id)).revision, 2);
    } },
    { name: 'sleep and personal-best claims remain explicit source-linked fields', async run(module) {
      const note = await create(module, 'slept 7.5 hours. new PR on incline press');
      const before = await module.notes.fields(note.id);
      assert.equal(before.suggestions.sleep.items[0]!.value!.durationMin, 450);
      assert.equal(before.suggestions.personalBest.items[0]!.status, 'pending');
      const confirmation = await module.notes.confirmFields({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1,
        fields: { pain: [], sleep: { durationMin: 450, quality: null }, personalBest: { claimText: 'new PR on incline press' } },
      });
      assert.equal(confirmation.fields.sleep!.quality, null);
      assert.deepEqual(confirmation.fields.personalBest, { claimText: 'new PR on incline press' });
      assert.equal('bestLoad' in confirmation.fields, false);
    } },
    { name: 'confirmation invalidates cursors but replay leaves the new cursor intact', async run(module) {
      const note = await create(module);
      await create(module, 'another note');
      const page = await module.notes.history({ limit: 1 });
      assert(page.nextCursor !== null);
      const input = { requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() };
      await module.notes.confirmFields(input);
      await assert.rejects(module.notes.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
      const fresh = await module.notes.history({ limit: 1 });
      assert(fresh.nextCursor !== null);
      await module.notes.confirmFields(input);
      assert.equal((await module.notes.history({ cursor: fresh.nextCursor })).revision, fresh.revision);
    } },
  ];
}
