import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNotesModule } from '@forma/core';
import type { NotesReader, NotesWriter } from '@forma/core';
import { SqliteWorkoutStore } from '@forma/adapters/node';
import { AndroidSqliteWorkoutStore } from '@forma/adapters/android';
import { runSqliteMigrations, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import { collectNoteCases } from './fixtures/note-cases.js';
import { collectNoteFieldCases, fieldsWithPain, leftKnee } from './fixtures/note-field-cases.js';
import { collectNoteSearchCases } from './fixtures/note-search-cases.js';
import { migrationDriver } from './sqlite-helpers.js';
import { TEST_TIME, errorCode } from './helpers.js';

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'forma-notes-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const dependencies = { clock: { nowUtc: () => TEST_TIME }, ids: { next: (() => { let id = 0; return () => 'note-' + ++id; })() } };
for (const binding of ['Node', 'Android shim'] as const) {
  for (const item of [...collectNoteCases(assert), ...collectNoteFieldCases(assert), ...collectNoteSearchCases(assert)]) {
    test(binding + ' notes: ' + item.name, async (t) => {
      const path = await directory(t);
      const store = binding === 'Node' ? SqliteWorkoutStore.open({ databasePath: join(path, 'notes.sqlite') })
        : AndroidSqliteWorkoutStore.open({ databaseName: path.split('/').at(-1)! + '.sqlite', openDatabase: () => {
          const db = new DatabaseSync(join(path, 'shim.sqlite'));
          return { close: () => db.close(), executeSync: (sql, params = []) => ({ rows: db.prepare(sql).all(...params) }) };
        } });
      const module = createNotesModule({ ...dependencies, store });
      t.after(() => module.close());
      await item.run(module);
    });
  }
}

test('notes and confirmations reopen exactly with receipts, FTS, cursors, and reserved deleted IDs', async (t) => {
  const path = join(await directory(t), 'notes.sqlite');
  let store = SqliteWorkoutStore.open({ databasePath: path });
  let module = createNotesModule({ ...dependencies, store });
  const input = { requestId: 'create', date: '2026-10-14', text: '  knee pain 💤\r\n' };
  const note = await module.notes.create(input);
  await module.notes.create({ ...input, requestId: 'second' });
  const confirm = { requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([leftKnee('absent', 0)]) };
  const confirmation = await module.notes.confirmFields(confirm);
  const current = await module.notes.get(note.id);
  const page = await module.notes.searchText({ query: 'knee', limit: 1 });
  const receipts = await store.read((reader) => reader.listRequestReceipts());
  await module.close();
  store = SqliteWorkoutStore.open({ databasePath: path }); module = createNotesModule({ ...dependencies, store });
  t.after(() => module.close());
  assert.deepEqual(await module.notes.get(note.id), current);
  assert.deepEqual((await module.notes.fields(note.id)).confirmation, confirmation);
  assert.deepEqual(await module.notes.create(input), note);
  assert.deepEqual(await module.notes.confirmFields(confirm), confirmation);
  assert.deepEqual(await store.read((reader) => reader.listRequestReceipts()), receipts);
  assert.deepEqual(await module.notes.searchText({ query: 'knee', limit: 1 }), page);
  assert.equal((await module.notes.searchText({ query: 'knee', cursor: page.nextCursor! })).items.length, 1);
  await module.notes.delete({ requestId: 'delete', noteId: note.id, expectedRevision: 2 });
  await module.close();
  store = SqliteWorkoutStore.open({ databasePath: path }); module = createNotesModule({ ...dependencies, store, ids: { next: () => note.id } });
  assert.equal(await store.read((reader) => reader.hasNoteId(note.id)), true);
  await assert.rejects(module.notes.create({ ...input, requestId: 'reuse' }), errorCode('CONFLICT', 'id'));
  assert.deepEqual(await module.notes.confirmFields(confirm), confirmation);
});

test('receipt failure rolls back primary notes, confirmation invalidation, FTS, reservation, and revision', async (t) => {
  const path = join(await directory(t), 'rollback.sqlite');
  const store = SqliteWorkoutStore.open({ databasePath: path });
  const module = createNotesModule({ ...dependencies, store }); t.after(() => module.close());
  const note = await module.notes.create({ requestId: 'create', date: '2026-10-14', text: 'originalword' });
  await module.notes.confirmFields({ requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() });
  const before = await module.notes.fields(note.id);
  const history = await module.notes.history();
  const db = new DatabaseSync(path); t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_note_receipt BEFORE INSERT ON request_receipts WHEN new.request_id = 'fail' BEGIN SELECT RAISE(ABORT, 'injected'); END");
  await assert.rejects(module.notes.update({ requestId: 'fail', noteId: note.id, expectedRevision: 2, text: 'newword' }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await module.notes.history(), history);
  assert.deepEqual(await module.notes.fields(note.id), before);
  assert.equal((await module.notes.searchText({ query: 'newword' })).items.length, 0);
  assert.equal((await module.notes.searchText({ query: 'originalword' })).items.length, 1);
  await assert.rejects(module.notes.create({ requestId: 'fail', date: '2026-10-14', text: 'failedcreate' }), errorCode('STORAGE_FAILURE'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_ids').get()?.n, 1);
  await assert.rejects(module.notes.delete({ requestId: 'fail', noteId: note.id, expectedRevision: 2 }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await module.notes.fields(note.id), before);
});

test('shared notes views reject writes, expired access, stale confirmation, and overflow', async (t) => {
  const path = join(await directory(t), 'views.sqlite');
  const store = SqliteWorkoutStore.open({ databasePath: path });
  const module = createNotesModule({ ...dependencies, store }); t.after(() => module.close());
  const note = await module.notes.create({ requestId: 'create', date: '2026-10-14', text: 'knee' });
  let expired: NotesReader | undefined;
  await store.read(async (reader) => { expired = reader;
    await assert.rejects((reader as unknown as NotesWriter).deleteNote(note.id), errorCode('STORAGE_FAILURE'));
  });
  await assert.rejects(expired!.getNote(note.id), errorCode('STORAGE_FAILURE'));
  await assert.rejects(store.write((writer) => writer.saveNoteConfirmation({ formatVersion: 1,
    source: { module: 'notes', noteId: note.id, revision: 2 }, confirmedAt: TEST_TIME, fields: fieldsWithPain() })), errorCode('CONFLICT'));
  const db = new DatabaseSync(path); t.after(() => db.close());
  db.exec('UPDATE notes_history_state SET revision = 9007199254740991');
  await assert.rejects(module.notes.update({ requestId: 'overflow', noteId: note.id, expectedRevision: 1, text: 'new' }), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(await module.notes.get(note.id), note);
});

test('schema 5 upgrade preserves workouts, receipts, and catalog and probes actual FTS5', async (t) => {
  const path = join(await directory(t), 'upgrade.sqlite');
  const db = new DatabaseSync(path);
  runSqliteMigrations(migrationDriver(db), SQLITE_MIGRATIONS.slice(0, 5));
  db.prepare("INSERT INTO workouts (id,date,notes,created_at,updated_at,status) VALUES (?,?,?,?,?,'finished')")
    .run('old', '2026-10-14', 'old text', TEST_TIME, TEST_TIME);
  const workouts = db.prepare('SELECT * FROM workouts').all();
  const exercises = db.prepare('SELECT * FROM exercises ORDER BY catalog_position').all();
  db.close();
  const store = SqliteWorkoutStore.open({ databasePath: path }); t.after(() => store.close());
  const check = new DatabaseSync(path); t.after(() => check.close());
  assert.deepEqual(check.prepare('SELECT * FROM workouts').all(), workouts);
  assert.deepEqual(check.prepare('SELECT * FROM exercises ORDER BY catalog_position').all(), exercises);
  assert.match(String(check.prepare("SELECT sql FROM sqlite_master WHERE name='notes_fts'").get()?.sql), /fts5/i);
});
