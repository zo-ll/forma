import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { compareNotePositions, createNotesModule, FormaError, NOTE_LIMITS } from '@forma/core';
import type { NotesReader, NotesStorePage, NotesWriter, RequestReceipt } from '@forma/core';
import { notesContract } from './notes-contract.js';
import { MemoryNotesStore } from './notes-memory.js';
import { errorCode, TEST_TIME } from './helpers.js';

function fixture(t: TestContext, store = new MemoryNotesStore(), ids?: readonly string[]) {
  let next = 0;
  const module = createNotesModule({
    store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => {
      const id = ids?.[next]; next++;
      return id ?? 'note-' + next;
    } },
  });
  t.after(() => module.close());
  return module;
}

notesContract('memory notes', fixture);

test('note replay skips IDs, clock, primary changes, and history revision', async (t) => {
  const store = new MemoryNotesStore();
  let unavailable = false;
  let ids = 0; let clocks = 0;
  const module = createNotesModule({
    store, clock: { nowUtc: () => { assert.equal(unavailable, false); clocks++; return TEST_TIME; } },
    ids: { next: () => { assert.equal(unavailable, false); return 'note-' + ++ids; } },
  });
  t.after(() => module.close());
  const input = { requestId: 'create', date: '2026-10-14', text: 'original' };
  const note = await module.notes.create(input);
  const update = { requestId: 'update', noteId: note.id, expectedRevision: 1, text: 'edited' };
  const edited = await module.notes.update(update);
  const deletion = { requestId: 'delete', noteId: note.id, expectedRevision: 2 };
  await module.notes.delete(deletion);
  unavailable = true;
  assert.deepEqual(await module.notes.create(input), note);
  assert.deepEqual(await module.notes.update(update), edited);
  await module.notes.delete(deletion);
  assert.equal(ids, 1); assert.equal(clocks, 2); assert.equal(store.saves, 2);
  assert.equal(store.state.revision, 3); assert.equal(store.state.receipts.size, 3);
});

test('receipt failure rolls back note, ID reservation, and history revision', async (t) => {
  class FaultStore extends MemoryNotesStore {
    fail = true;
    override write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T> {
      return super.write((writer) => run({
        ...writer, saveRequestReceipt: async (receipt) => {
          if (this.fail) throw new FormaError('STORAGE_FAILURE', 'Injected receipt failure.');
          await writer.saveRequestReceipt(receipt);
        },
      }));
    }
  }
  const store = new FaultStore();
  const module = fixture(t, store, ['same-id', 'same-id']);
  const input = { requestId: 'retry', date: '2026-10-14', text: 'primary first' };
  await assert.rejects(module.notes.create(input), errorCode('STORAGE_FAILURE'));
  assert.equal(store.state.notes.size, 0); assert.equal(store.state.reservedIds.size, 0);
  assert.equal(store.state.receipts.size, 0); assert.equal(store.state.revision, 0);
  store.fail = false;
  assert.equal((await module.notes.create(input)).id, 'same-id');
  assert.equal(store.state.revision, 1);
});

test('deleted note IDs stay reserved rather than identifying a new revision 1', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store, ['same', 'same', 'same']);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  await assert.rejects(module.notes.create({ requestId: 'two', date: '2026-10-14', text: 'live collision' }),
    errorCode('CONFLICT', 'id'));
  await module.notes.delete({ requestId: 'delete', noteId: note.id, expectedRevision: 1 });
  await assert.rejects(module.notes.create({ requestId: 'three', date: '2026-10-14', text: 'deleted collision' }),
    errorCode('CONFLICT', 'id'));
  assert.equal(store.state.notes.size, 0); assert.equal(store.state.receipts.size, 2);
});

test('malformed note receipt snapshots and mismatched sources fail without writes', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const input = { requestId: 'one', date: '2026-10-14', text: 'original' };
  const note = await module.notes.create(input);
  const receipt = store.state.receipts.get('one')!;
  for (const resultJson of [
    '{', 'null', JSON.stringify({ ...note, revision: 0 }),
    JSON.stringify({ ...note, source: { ...note.source, revision: 2 } }),
    JSON.stringify({ ...note, source: { ...note.source, noteId: 'other' } }),
    JSON.stringify({ ...note, source: { ...note.source, module: 'workouts' } }),
    JSON.stringify({ ...note, createdAt: 'bad' }),
    JSON.stringify({ ...note, fileUri: 'native' }),
  ]) {
    store.state.receipts.set('one', { ...receipt, resultJson });
    await assert.rejects(module.notes.create(input), errorCode('STORAGE_FAILURE'));
    assert.equal(store.state.revision, 1); assert.equal(store.saves, 1);
  }
});

test('note receipts use the shared operation namespace, not a module-local key', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const receipt: RequestReceipt = {
    requestId: 'shared', operation: 'workouts.create', inputSignature: '{}', resultJson: '{}', formatVersion: 1,
  };
  store.state.receipts.set(receipt.requestId, receipt);
  await assert.rejects(module.notes.create({ requestId: 'shared', date: '2026-10-14', text: 'note' }),
    errorCode('CONFLICT', 'requestId'));
  assert.equal(store.state.notes.size, 0);
});

test('validation runs before storage and replay lookup', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const input = { requestId: 'one', date: '2026-10-14', text: 'original' };
  await module.notes.create(input);
  const writes = store.writes;
  await assert.rejects(module.notes.create({ ...input, text: '' }), errorCode('INVALID_INPUT', 'text'));
  await assert.rejects(module.notes.create({ ...input, requestId: 'bad\u0000key' }), errorCode('INVALID_INPUT', 'requestId'));
  assert.equal(store.writes, writes);
});

test('invalid injected IDs and clock values leave request keys reusable', async (t) => {
  const store = new MemoryNotesStore();
  let id = '\ud800'; let now = 'bad';
  const module = createNotesModule({ store, clock: { nowUtc: () => now }, ids: { next: () => id } });
  t.after(() => module.close());
  const input = { requestId: 'one', date: '2026-10-14', text: 'original' };
  await assert.rejects(module.notes.create(input), errorCode('INVALID_INPUT', 'id'));
  id = 'valid';
  await assert.rejects(module.notes.create(input), errorCode('INVALID_INPUT', 'clock'));
  assert.equal(store.state.reservedIds.size, 0); assert.equal(store.state.receipts.size, 0);
  now = TEST_TIME;
  assert.equal((await module.notes.create(input)).id, id);
});

test('revision exhaustion cannot change the primary record', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  store.state.notes.set(note.id, { ...store.state.notes.get(note.id)!, revision: Number.MAX_SAFE_INTEGER });
  await assert.rejects(module.notes.update({
    requestId: 'overflow', noteId: note.id, expectedRevision: Number.MAX_SAFE_INTEGER, text: 'new',
  }), errorCode('INVALID_INPUT', 'revision'));
  assert.equal(store.state.notes.get(note.id)!.text, 'original');
  assert.equal(store.state.receipts.has('overflow'), false);
});

test('history uses date, creation time, and Unicode code-point ID order', async (t) => {
  const store = new MemoryNotesStore();
  let now = TEST_TIME; let next = 0;
  const ids = ['😀', '\uE000', 'z', 'a', 'older'];
  const module = createNotesModule({ store, clock: { nowUtc: () => now }, ids: { next: () => ids[next++]! } });
  t.after(() => module.close());
  for (let i = 0; i < 3; i++) {
    await module.notes.create({ requestId: 'create-' + i, date: '2026-10-14', text: 'tie' });
  }
  now = '2026-10-14T20:00:00.000Z';
  await module.notes.create({ requestId: 'later', date: '2026-10-14', text: 'later' });
  await module.notes.create({ requestId: 'old-date', date: '2026-10-13', text: 'old date' });
  assert.deepEqual((await module.notes.history()).items.map((note) => note.id), ['a', 'z', '\uE000', '😀', 'older']);
  const first = await module.notes.history({ limit: 3 });
  const second = await module.notes.history({ cursor: first.nextCursor! });
  assert.deepEqual(second.items.map((note) => note.id), ['😀', 'older']);
  assert(compareNotePositions({ id: '😀', date: '2026-10-14', createdAt: TEST_TIME },
    { id: '\uE000', date: '2026-10-14', createdAt: TEST_TIME }) > 0);
});

test('history defaults to 20 records and permits a full 100-record page', async (t) => {
  const module = fixture(t);
  for (let i = 0; i < 101; i++) {
    await module.notes.create({ requestId: 'create-' + i, date: '2026-10-14', text: 'note ' + i });
  }
  assert.equal((await module.notes.history()).items.length, NOTE_LIMITS.defaultPageSize);
  const page = await module.notes.history({ limit: 100 });
  assert.equal(page.items.length, 100); assert.notEqual(page.nextCursor, null);
  assert.equal((await module.notes.history({ cursor: page.nextCursor! })).items.length, 1);
});

test('create and delete also invalidate existing history cursors', async (t) => {
  const module = fixture(t);
  const first = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'one' });
  await module.notes.create({ requestId: 'two', date: '2026-10-14', text: 'two' });
  const before = await module.notes.history({ limit: 1 });
  await module.notes.create({ requestId: 'three', date: '2026-10-14', text: 'three' });
  await assert.rejects(module.notes.history({ cursor: before.nextCursor! }), errorCode('CONFLICT', 'cursor'));
  const next = await module.notes.history({ limit: 1 });
  await module.notes.delete({ requestId: 'delete', noteId: first.id, expectedRevision: 1 });
  await assert.rejects(module.notes.history({ cursor: next.nextCursor! }), errorCode('CONFLICT', 'cursor'));
});

test('tampered cursor anchors and metadata fail rather than skip records', async (t) => {
  const module = fixture(t);
  await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'one' });
  await module.notes.create({ requestId: 'two', date: '2026-10-14', text: 'two' });
  const page = await module.notes.history({ limit: 1 });
  const prefix = 'forma-notes-v1:';
  const parsed = JSON.parse(decodeURIComponent(page.nextCursor!.slice(prefix.length))) as
    { version: number; revision: number; after: { id: string; date: string; createdAt: string } };
  for (const patch of [
    { after: { ...parsed.after, id: 'missing' } },
    { after: { ...parsed.after, date: '2026-10-13' } },
    { after: { ...parsed.after, createdAt: 'bad' } },
    { version: 2 }, { revision: -1 }, { unexpected: 1 },
  ]) {
    const cursor = prefix + encodeURIComponent(JSON.stringify({ ...parsed, ...patch }));
    await assert.rejects(module.notes.history({ cursor }), errorCode('INVALID_INPUT', 'cursor'));
  }
});

test('malformed primary rows, history revisions, and adapter pages fail closed', async (t) => {
  class BadStore extends MemoryNotesStore {
    page: NotesStorePage | undefined;
    override read<T>(run: (reader: NotesReader) => Promise<T>): Promise<T> {
      return super.read((reader) => run({
        ...reader, listNotes: async (input) => this.page ?? reader.listNotes(input),
      }));
    }
  }
  const store = new BadStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'one' });
  const record = store.state.notes.get(note.id)!;
  store.state.notes.set(note.id, { ...record, revision: 0 });
  await assert.rejects(module.notes.get(note.id), errorCode('STORAGE_FAILURE'));
  await assert.rejects(module.notes.history(), errorCode('STORAGE_FAILURE'));
  store.state.notes.set(note.id, record);
  store.state.revision = -1;
  await assert.rejects(module.notes.history(), errorCode('STORAGE_FAILURE'));
  store.state.revision = 1;
  for (const page of [
    { items: [], hasMore: true },
    { items: [record, record], hasMore: false },
    { items: [record, { ...record, date: '2026-10-13' }], hasMore: false },
    { items: [{ ...record, kind: 'pain' as const }], hasMore: false },
    { items: Array.from({ length: 21 }, () => record), hasMore: false },
  ]) {
    store.page = page;
    await assert.rejects(module.notes.history({ kind: 'general' }), errorCode('STORAGE_FAILURE'));
  }
});

test('retained memory state preserves receipts and unchanged cursors across owners', async (t) => {
  const firstStore = new MemoryNotesStore();
  const first = fixture(t, firstStore);
  const input = { requestId: 'one', date: '2026-10-14', text: 'one' };
  const note = await first.notes.create(input);
  await first.notes.create({ requestId: 'two', date: '2026-10-14', text: 'two' });
  const page = await first.notes.history({ limit: 1 });
  await first.close();
  const second = fixture(t, new MemoryNotesStore(firstStore.state));
  assert.deepEqual(await second.notes.create(input), note);
  assert.equal((await second.notes.history({ cursor: page.nextCursor! })).items.length, 1);
});

test('close drains accepted writes, rejects cached APIs, and closes exactly once', async (t) => {
  const store = new MemoryNotesStore();
  const module = fixture(t, store);
  const cached = module.notes;
  const pending = cached.create({ requestId: 'one', date: '2026-10-14', text: 'accepted' });
  const closing = module.close();
  assert.equal(module.close(), closing);
  await assert.rejects(cached.create({ requestId: 'two', date: '2026-10-14', text: 'rejected' }),
    errorCode('SERVICE_CLOSED'));
  await assert.rejects(cached.get('note-1'), errorCode('SERVICE_CLOSED'));
  await assert.rejects(cached.history(), errorCode('SERVICE_CLOSED'));
  await assert.rejects(cached.update({ requestId: 'edit', noteId: 'note-1', expectedRevision: 1, text: 'x' }),
    errorCode('SERVICE_CLOSED'));
  await assert.rejects(cached.delete({ requestId: 'delete', noteId: 'note-1', expectedRevision: 1 }),
    errorCode('SERVICE_CLOSED'));
  await pending; await closing;
  assert.equal(store.state.notes.size, 1); assert.equal(store.closeCalls, 1);
});

test('failed edit and delete receipts roll back primary changes and preserve cursors', async (t) => {
  class FaultStore extends MemoryNotesStore {
    fail = false;
    override write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T> {
      return super.write((writer) => run({
        ...writer, saveRequestReceipt: async (receipt) => {
          if (this.fail) throw new FormaError('STORAGE_FAILURE', 'Injected receipt failure.');
          await writer.saveRequestReceipt(receipt);
        },
      }));
    }
  }
  const store = new FaultStore();
  const module = fixture(t, store);
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  await module.notes.create({ requestId: 'two', date: '2026-10-14', text: 'second' });
  const page = await module.notes.history({ limit: 1 });
  const update = { requestId: 'update', noteId: note.id, expectedRevision: 1, text: 'changed' };
  const deletion = { requestId: 'delete', noteId: note.id, expectedRevision: 1 };
  store.fail = true;
  await assert.rejects(module.notes.update(update), errorCode('STORAGE_FAILURE'));
  await assert.rejects(module.notes.delete(deletion), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await module.notes.get(note.id), note);
  assert.equal((await module.notes.history({ cursor: page.nextCursor! })).revision, page.revision);
  assert.equal(store.state.receipts.size, 2);
  store.fail = false;
  const edited = await module.notes.update(update);
  assert.equal(edited.revision, 2);
  // The failed delete key remains available with the corrected current revision.
  await module.notes.delete({ ...deletion, expectedRevision: 2 });
  assert.equal(store.state.notes.has(note.id), false);
});

test('primary notes save before receipts and require no extraction or embedding port', async (t) => {
  class ObservedStore extends MemoryNotesStore {
    override write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T> {
      return super.write((writer) => run({
        ...writer, saveRequestReceipt: async (receipt) => {
          assert.equal(this.state.notes.size, 1);
          assert.equal([...this.state.notes.values()][0]!.text, 'primary text');
          await writer.saveRequestReceipt(receipt);
        },
      }));
    }
  }
  const module = fixture(t, new ObservedStore());
  await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'primary text' });
});

test('queued commands capture caller input before an asynchronous store wait', async (t) => {
  const module = fixture(t);
  const input = { requestId: 'one', date: '2026-10-14', text: 'captured' };
  const pending = module.notes.create(input);
  input.text = 'mutated';
  const note = await pending;
  assert.equal(note.text, 'captured');
  const update = { requestId: 'update', noteId: note.id, expectedRevision: 1, text: 'captured update' };
  const editing = module.notes.update(update);
  update.text = 'mutated update'; update.expectedRevision = 100;
  assert.equal((await editing).text, 'captured update');
  assert.deepEqual(await module.notes.create({ ...input, text: 'captured' }), note);
});

test('note audit time changes only for a new edit, not a read or receipt replay', async (t) => {
  const store = new MemoryNotesStore();
  let now = TEST_TIME;
  const module = createNotesModule({ store, clock: { nowUtc: () => now }, ids: { next: () => 'one' } });
  t.after(() => module.close());
  const note = await module.notes.create({ requestId: 'one', date: '2026-10-14', text: 'original' });
  now = '2026-10-15T10:00:00.000Z';
  const input = { requestId: 'update', noteId: note.id, expectedRevision: 1, text: 'edited' };
  const edited = await module.notes.update(input);
  assert.equal(edited.updatedAt, now); assert.equal(edited.createdAt, TEST_TIME);
  now = '2026-10-16T10:00:00.000Z';
  assert.deepEqual(await module.notes.get(note.id), edited);
  assert.deepEqual(await module.notes.update(input), edited);
  assert.equal(edited.date, note.date);
});

test('close failure keeps the notes owner closed and does not call close again', async () => {
  class FaultStore extends MemoryNotesStore {
    override close(): Promise<void> {
      this.closeCalls++;
      return Promise.reject(new FormaError('STORAGE_FAILURE', 'Unconfirmed close.'));
    }
  }
  const store = new FaultStore();
  const module = createNotesModule({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'one' } });
  const closing = module.close();
  await assert.rejects(closing, errorCode('STORAGE_FAILURE'));
  assert.equal(module.close(), closing); assert.equal(store.closeCalls, 1);
  await assert.rejects(module.notes.history(), errorCode('SERVICE_CLOSED'));
});

test('memory contract views reject writes and expire after callbacks', async (t) => {
  const store = new MemoryNotesStore();
  t.after(() => store.close());
  let retained: NotesReader | undefined;
  await store.read(async (reader) => { retained = reader; });
  await assert.rejects(retained!.getNotesHistoryRevision(), errorCode('STORAGE_FAILURE'));
  await assert.rejects(store.read(async (reader) => (reader as NotesWriter).deleteNote('missing')),
    errorCode('STORAGE_FAILURE'));
});
