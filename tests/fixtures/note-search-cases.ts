import type { NotesModule } from '@forma/core';
import type { NoteContractCase } from './note-cases.js';
import type { ContractAssert } from './contract-types.js';
import { errorCode, nextRequestId } from './contract-helpers.js';

/** These cases need a real FTS5 adapter. A memory string matcher is not equivalent. */
export function collectNoteSearchCases(assert: ContractAssert): readonly NoteContractCase[] {
  const create = (module: NotesModule, text: string, date = '2026-10-14') => module.notes.create({
    requestId: nextRequestId(), text, date,
  });
  return [
    { name: 'FTS5 phrase search preserves exact text and revision sources', async run(module) {
      const text = '  Left knee pain.\r\n眠れた 💤  ';
      const note = await create(module, text);
      await create(module, 'left shoulder and knee pain');
      const page = await module.notes.searchText({ query: 'left knee' });
      assert.deepEqual(page.items, [note]);
      assert.deepEqual(page.filter, { query: 'left knee', dateFrom: null, dateTo: null, kind: null });
      assert.equal(page.items[0]!.text, text);
      assert.deepEqual(page.items[0]!.source, note.source);
    } },
    { name: 'MATCH operators and SQL strings are literal query text', async run(module) {
      const note = await create(module, 'knee OR shoulder');
      await create(module, 'knee'); await create(module, 'shoulder');
      assert.deepEqual((await module.notes.searchText({ query: 'knee OR shoulder' })).items, [note]);
      assert.deepEqual((await module.notes.searchText({ query: '" OR *' })).items, [note]);
      for (const query of ['text:knee', "'); DROP TABLE notes; --", 'NEAR(knee shoulder)', '***']) {
        assert.equal((await module.notes.searchText({ query })).items.length, 0);
      }
      assert.deepEqual(await module.notes.get(note.id), note);
      assert.deepEqual((await module.notes.searchText({ query: '"knee"' })).items.map((n) => n.id).sort(),
        (await module.notes.searchText({ query: 'knee' })).items.map((n) => n.id).sort());
    } },
    { name: 'inclusive date and kind filters apply before paging', async run(module) {
      await create(module, 'sleep early', '2026-10-12');
      const note = await module.notes.create({ requestId: nextRequestId(), text: 'sleep well', date: '2026-10-13', kind: 'sleep' });
      await create(module, 'sleep late', '2026-10-14');
      assert.deepEqual((await module.notes.searchText({ query: 'sleep', kind: 'sleep', dateFrom: note.date, dateTo: note.date })).items, [note]);
    } },
    { name: 'search cursors bind exact query, filters, revision, and keyset anchor', async run(module) {
      for (let i = 0; i < 3; i++) await create(module, 'search token ' + i);
      const first = await module.notes.searchText({ query: 'search', limit: 1 });
      assert(first.nextCursor !== null);
      const cursor = first.nextCursor!;
      const second = await module.notes.searchText({ query: 'search', limit: 2, cursor });
      assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null);
      assert(!second.items.some((n) => n.id === first.items[0]!.id));
      await assert.rejects(module.notes.searchText({ query: 'token', cursor }), errorCode('INVALID_INPUT', 'cursor'));
      await assert.rejects(module.notes.history({ cursor }), errorCode('INVALID_INPUT', 'cursor'));
      const note = first.items[0]!;
      const edit = { requestId: nextRequestId(), noteId: note.id, expectedRevision: note.revision, text: 'changed text' };
      await module.notes.update(edit);
      await assert.rejects(module.notes.searchText({ query: 'search', cursor }), errorCode('CONFLICT', 'cursor'));
      assert.equal((await module.notes.searchText({ query: 'changed' })).items[0]!.revision, 2);
      const current = await module.notes.searchText({ query: 'search', limit: 1 });
      await module.notes.update(edit); // Receipt replay must not advance the history revision.
      assert.deepEqual(await module.notes.searchText({ query: 'search', limit: 1 }), current);
    } },
    { name: 'edits and deletion maintain the FTS index in the same transaction', async run(module) {
      const note = await create(module, 'originalword');
      const edited = await module.notes.update({ requestId: nextRequestId(), noteId: note.id, expectedRevision: 1, text: 'replacementword' });
      assert.equal((await module.notes.searchText({ query: 'originalword' })).items.length, 0);
      assert.deepEqual((await module.notes.searchText({ query: 'replacementword' })).items, [edited]);
      await module.notes.delete({ requestId: nextRequestId(), noteId: note.id, expectedRevision: 2 });
      assert.equal((await module.notes.searchText({ query: 'replacementword' })).items.length, 0);
    } },
    { name: 'literal search validates bounded Unicode input', async run(module) {
      for (const query of ['', ' ', '\u0000', '\ud800', 'x'.repeat(513)]) {
        await assert.rejects(module.notes.searchText({ query }), errorCode('INVALID_INPUT', 'query'));
      }
      for (const limit of [0, 101, 1.5]) {
        await assert.rejects(module.notes.searchText({ query: 'knee', limit }), errorCode('INVALID_INPUT', 'limit'));
      }
      assert.equal((await module.notes.searchText({ query: '💤' })).items.length, 0);
      const note = await create(module, 'café');
      assert.deepEqual((await module.notes.searchText({ query: 'café' })).items, [note]);
      assert.equal((await module.notes.searchText({ query: 'cafe' })).items.length, 0);
    } },
  ];
}
