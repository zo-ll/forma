import type { CreateNoteInput, NoteHistoryInput, NoteKind, NotesModule, UpdateNoteInput } from '@forma/core';
import type { ContractAssert } from './contract-types.js';
import { errorCode, nextRequestId } from './contract-helpers.js';

export interface NoteContractCase {
  readonly name: string;
  run(module: NotesModule): Promise<void>;
}

/** Portable public API cases. Future adapters can run these without Node. */
export function collectNoteCases(assert: ContractAssert): readonly NoteContractCase[] {
  const create = (module: NotesModule, text = 'left knee felt fine', kind?: NoteKind) => module.notes.create({
    requestId: nextRequestId(), date: '2026-10-14', text, ...(kind === undefined ? {} : { kind }),
  });
  return [
    { name: 'exact text, explicit date, default label, and revision source', async run(module) {
      const text = '  Left knee felt fine.\r\n眠れた 💤\n ';
      const note = await create(module, text);
      assert.equal(note.text, text);
      assert.equal(note.date, '2026-10-14');
      assert.equal(note.kind, 'general');
      assert.equal(note.revision, 1);
      assert.deepEqual(note.source, { module: 'notes', noteId: note.id, revision: 1 });
      assert.deepEqual(await module.notes.get(note.id), note);
      assert.deepEqual(Object.keys(note).sort(),
        ['createdAt', 'date', 'id', 'kind', 'revision', 'source', 'text', 'updatedAt'].sort());
    } },
    { name: 'all kinds are labels rather than confirmed facts', async run(module) {
      for (const kind of ['general', 'pain', 'sleep', 'personal-best'] as const) {
        const note = await create(module, 'left knee felt fine', kind);
        assert.equal(note.kind, kind);
        assert.equal(note.text, 'left knee felt fine');
        assert.equal('confirmed' in note, false);
      }
    } },
    { name: 'edits preserve identity, creation time, omitted fields, and old sources', async run(module) {
      const original = await create(module);
      const edited = await module.notes.update({
        requestId: nextRequestId(), noteId: original.id, expectedRevision: 1,
        text: 'slept well', kind: 'sleep', date: '2026-10-13',
      });
      assert.equal(edited.id, original.id);
      assert.equal(edited.createdAt, original.createdAt);
      assert.equal(edited.revision, 2);
      assert.deepEqual(edited.source, { module: 'notes', noteId: original.id, revision: 2 });
      assert.equal(original.source.revision, 1);
      const next = await module.notes.update({
        requestId: nextRequestId(), noteId: original.id, expectedRevision: 2, text: 'slept well',
      });
      assert.equal(next.revision, 3);
      assert.equal(next.date, edited.date);
      assert.equal(next.kind, edited.kind);
    } },
    { name: 'stale edit and delete cannot replace the current revision', async run(module) {
      const note = await create(module);
      const edited = await module.notes.update({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, text: 'current',
      });
      await assert.rejects(module.notes.update({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, text: 'obsolete extraction',
      }), errorCode('CONFLICT', 'expectedRevision'));
      await assert.rejects(module.notes.delete({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1,
      }), errorCode('CONFLICT', 'expectedRevision'));
      assert.deepEqual(await module.notes.get(note.id), edited);
    } },
    { name: 'create and edit replay their original snapshots after deletion', async run(module) {
      const input = { requestId: nextRequestId(), date: '2026-10-14', text: 'original' };
      const note = await module.notes.create(input);
      assert.deepEqual(await module.notes.create({ ...input, kind: 'general' }), note);
      const update = { requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, text: 'edited' };
      const edited = await module.notes.update(update);
      const deletion = { requestId: nextRequestId(), noteId: note.id, expectedRevision: 2 };
      await module.notes.delete(deletion);
      assert.equal(await module.notes.delete(deletion), undefined);
      assert.deepEqual(await module.notes.create(input), note);
      assert.deepEqual(await module.notes.update(update), edited);
      await assert.rejects(module.notes.get(note.id), errorCode('NOT_FOUND', 'noteId'));
      assert.equal((await module.notes.history()).items.length, 0);
    } },
    { name: 'a request key cannot identify different input or another operation', async run(module) {
      const input = { requestId: nextRequestId(), date: '2026-10-14', text: 'original' };
      const note = await module.notes.create(input);
      await assert.rejects(module.notes.create({ ...input, text: 'different' }), errorCode('CONFLICT', 'requestId'));
      await assert.rejects(module.notes.delete({
        requestId: input.requestId, noteId: note.id, expectedRevision: 1,
      }), errorCode('CONFLICT', 'requestId'));
      assert.deepEqual(await module.notes.get(note.id), note);
    } },
    { name: 'concurrent duplicate creates share one receipt', async run(module) {
      const input = { requestId: nextRequestId(), date: '2026-10-14', text: 'once' };
      const results = await Promise.all(Array.from({ length: 10 }, () => module.notes.create(input)));
      for (const result of results) assert.deepEqual(result, results[0]);
      assert.equal((await module.notes.history()).items.length, 1);
    } },
    { name: 'concurrent edits cannot silently overwrite each other', async run(module) {
      const note = await create(module);
      const outcomes = await Promise.allSettled(['first', 'second'].map((text) => module.notes.update({
        requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, text,
      })));
      assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = outcomes.find((result) => result.status === 'rejected');
      assert(rejected?.status === 'rejected');
      assert(errorCode('CONFLICT', 'expectedRevision')(rejected.reason));
      assert.equal((await module.notes.get(note.id)).revision, 2);
    } },
    { name: 'invalid create inputs fail with stable fields', async run(module) {
      const bad: readonly [Record<string, unknown>, string][] = [
        [{ text: '' }, 'text'], [{ text: ' \n\t' }, 'text'], [{ text: '\u0000' }, 'text'],
        [{ text: '\ud800' }, 'text'], [{ text: 'x'.repeat(16_385) }, 'text'],
        [{ date: '2026-02-30' }, 'date'], [{ date: '0000-01-01' }, 'date'],
        [{ kind: 'nutrition' }, 'kind'], [{ kind: null }, 'kind'], [{ fileUri: 'private' }, 'fileUri'],
        [{ requestId: '' }, 'requestId'], [{ requestId: '\ud800' }, 'requestId'],
      ];
      for (const [patch, field] of bad) {
        await assert.rejects(module.notes.create({
          requestId: nextRequestId(), date: '2026-10-14', text: 'valid', ...patch,
        } as CreateNoteInput), errorCode('INVALID_INPUT', field));
      }
      await assert.rejects(module.notes.create(null as unknown as CreateNoteInput), errorCode('INVALID_INPUT', 'input'));
      assert.equal((await module.notes.history()).items.length, 0);
      const note = await create(module, 'x'.repeat(16_384));
      assert.equal(note.text.length, 16_384);
    } },
    { name: 'invalid edits, IDs, and missing records have stable errors', async run(module) {
      const note = await create(module);
      for (const [patch, field] of [
        [{}, 'input'], [{ expectedRevision: 0, text: 'x' }, 'expectedRevision'],
        [{ expectedRevision: 1.5, text: 'x' }, 'expectedRevision'],
        [{ text: null }, 'text'], [{ date: null }, 'date'], [{ kind: 'other' }, 'kind'],
        [{ source: { module: 'notes' }, text: 'x' }, 'source'],
      ] as const) {
        await assert.rejects(module.notes.update({
          requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, ...patch,
        } as UpdateNoteInput), errorCode('INVALID_INPUT', field));
      }
      for (const id of ['', ' outer', 'nul\u0000id', '\ud800', 'x'.repeat(257)]) {
        await assert.rejects(module.notes.get(id), errorCode('INVALID_INPUT', 'noteId'));
      }
      await assert.rejects(module.notes.get('missing'), errorCode('NOT_FOUND', 'noteId'));
      await assert.rejects(module.notes.update({
        requestId: nextRequestId(), noteId: 'missing', expectedRevision: 1, text: 'x',
      }), errorCode('NOT_FOUND', 'noteId'));
      await assert.rejects(module.notes.delete({
        requestId: nextRequestId(), noteId: 'missing', expectedRevision: 1,
      }), errorCode('NOT_FOUND', 'noteId'));
      assert.deepEqual(await module.notes.get(note.id), note);
    } },
    { name: 'bounded history has inclusive date and kind filters', async run(module) {
      await module.notes.create({ requestId: nextRequestId(), date: '2026-10-12', text: 'old', kind: 'pain' });
      const wanted = await module.notes.create({ requestId: nextRequestId(), date: '2026-10-13', text: 'match', kind: 'sleep' });
      await create(module, 'other', 'pain');
      const page = await module.notes.history({ dateFrom: '2026-10-13', dateTo: '2026-10-13', kind: 'sleep' });
      assert.deepEqual(page.items, [wanted]);
      assert.deepEqual(page.filter, { dateFrom: '2026-10-13', dateTo: '2026-10-13', kind: 'sleep' });
      assert.equal(page.nextCursor, null);
      assert.deepEqual((await module.notes.history({ dateTo: '0001-01-01' })).items, []);
    } },
    { name: 'history traverses exact pages and permits a different page size', async run(module) {
      for (let i = 0; i < 5; i++) await create(module, 'note ' + i);
      const all = await module.notes.history();
      const first = await module.notes.history({ limit: 2 });
      assert(first.nextCursor !== null);
      const second = await module.notes.history({ limit: 1, cursor: first.nextCursor });
      assert(second.nextCursor !== null);
      const last = await module.notes.history({ limit: 100, cursor: second.nextCursor });
      assert.deepEqual([...first.items, ...second.items, ...last.items], all.items);
      assert.equal(last.nextCursor, null);
      assert.equal(first.revision, last.revision);
    } },
    { name: 'replay preserves cursors but primary edits invalidate them', async run(module) {
      const input = { requestId: nextRequestId(), date: '2026-10-14', text: 'first' };
      const note = await module.notes.create(input);
      await create(module, 'second');
      const page = await module.notes.history({ limit: 1 });
      assert(page.nextCursor !== null);
      await module.notes.create(input);
      assert.equal((await module.notes.history({ cursor: page.nextCursor })).revision, page.revision);
      await module.notes.update({ requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, text: 'changed' });
      await assert.rejects(module.notes.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
    } },
    { name: 'history rejects malformed cursors and changed filters', async run(module) {
      await create(module); await create(module);
      const page = await module.notes.history({ limit: 1 });
      assert(page.nextCursor !== null);
      for (const cursor of ['bad', 'forma-notes-v1:%', 'forma-notes-v1:null', 'x'.repeat(8193)]) {
        await assert.rejects(module.notes.history({ cursor }), errorCode('INVALID_INPUT', 'cursor'));
      }
      await assert.rejects(module.notes.history({ cursor: page.nextCursor, kind: 'pain' }), errorCode('INVALID_INPUT', 'cursor'));
      for (const [input, field] of [
        [{ limit: 0 }, 'limit'], [{ limit: 101 }, 'limit'], [{ limit: 1.5 }, 'limit'],
        [{ dateFrom: '2026-10-15', dateTo: '2026-10-14' }, 'dateTo'],
        [{ kind: 'nutrition' }, 'kind'], [{ dateFrom: 'bad' }, 'dateFrom'],
        [{ uri: 'native' }, 'uri'],
      ] as const) {
        await assert.rejects(module.notes.history(input as NoteHistoryInput), errorCode('INVALID_INPUT', field));
      }
    } },
    { name: 'returned DTOs cannot mutate primary records or receipts', async run(module) {
      const input = { requestId: nextRequestId(), date: '2026-10-14', text: 'original' };
      const note = await module.notes.create(input);
      const originalId = note.id;
      (note as { text: string }).text = 'mutated';
      (note.source as { revision: number }).revision = 100;
      const read = await module.notes.get(originalId);
      assert.equal(read.text, 'original'); assert.equal(read.source.revision, 1);
      (read as { text: string }).text = 'also mutated';
      const page = await module.notes.history();
      (page.items[0] as { text: string }).text = 'page mutated';
      assert.equal((await module.notes.create(input)).text, 'original');
      assert.equal((await module.notes.get(originalId)).text, 'original');
    } },
  ];
}
