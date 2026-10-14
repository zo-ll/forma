import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openNodeForma, SqliteWorkoutStore } from '@forma/adapters/node';
import { openAndroidForma } from '@forma/adapters/android';
import { runSqliteMigrations, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import { migrationDriver } from './sqlite-helpers.js';
import { fieldsWithPain } from './fixtures/note-field-cases.js';
import { errorCode, TEST_TIME, memoryFixture } from './helpers.js';

async function path(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'forma-notes-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'records.sqlite');
}

for (const binding of ['Node', 'Android shim'] as const) {
  test(binding + ' service shares notes lifetime, request namespace, and close drain', async (t) => {
    const databasePath = await path(t);
    const deps = { clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'shared-id' } };
    const service = binding === 'Node' ? openNodeForma({ ...deps, databasePath }) : openAndroidForma({ ...deps,
      databaseName: databasePath.split('/').at(-2)! + '.sqlite', openDatabase: () => {
        const db = new DatabaseSync(databasePath);
        return { close: () => db.close(), executeSync: (sql, params = []) => ({ rows: db.prepare(sql).all(...params) }) };
      } });
    t.after(() => service.close());
    await service.workouts.create({ requestId: 'shared', date: '2026-10-14' });
    await assert.rejects(service.notes.create({ requestId: 'shared', date: '2026-10-14', text: 'knee' }), errorCode('CONFLICT', 'requestId'));
    const notes = service.notes;
    const accepted = notes.create({ requestId: 'note', date: '2026-10-14', text: 'knee' });
    const closing = service.close();
    assert.equal(service.close(), closing);
    await assert.rejects(notes.searchText({ query: 'knee' }), errorCode('SERVICE_CLOSED'));
    const note = await accepted; await closing;
    const reopened = openNodeForma({ databasePath }); t.after(() => reopened.close());
    assert.deepEqual(await reopened.notes.get(note.id), note);
    assert.equal((await reopened.notes.searchText({ query: 'knee' })).items.length, 1);
  });
}

test('cached notes APIs cannot bypass restore exclusion or close during restore', async (t) => {
  const source = memoryFixture(t).service;
  const { text, digest } = await source.archive.export();
  const target = memoryFixture(t).service;
  const notes = target.notes;
  const restoring = target.archive.restore({ requestId: 'restore', text, expectedDigest: digest, expectedHistoryRevision: 0 });
  const blocked = [() => notes.get('one'), () => notes.fields('one'), () => notes.history(),
    () => notes.searchText({ query: 'knee' }),
    () => notes.create({ requestId: 'during', date: '2026-10-14', text: 'knee' }),
    () => notes.confirmFields({ requestId: 'confirm', noteId: 'one', expectedRevision: 1, fields: fieldsWithPain() })].map(run => run());
  await Promise.all(blocked.map(pending => assert.rejects(pending, errorCode('CONFLICT', 'restore'))));
  await restoring;
  assert.deepEqual((await notes.history()).items, []);
  const second = target.archive.restore({ requestId: 'second', text, expectedDigest: digest, expectedHistoryRevision: 1 });
  const closing = target.close();
  await assert.rejects(notes.history(), errorCode('SERVICE_CLOSED'));
  await second; await closing;
});

test('unfinished notes archive support fails closed, including after deleting the last note', async (t) => {
  const databasePath = await path(t);
  const service = openNodeForma({ databasePath }); t.after(() => service.close());
  const empty = await service.archive.export();
  const note = await service.notes.create({ requestId: 'create', date: '2026-10-14', text: 'must not be omitted' });
  const before = await service.notes.history();
  await assert.rejects(service.archive.export(), errorCode('STORAGE_FAILURE', 'archive.notes'));
  await assert.rejects(service.archive.inspect({ text: empty.text }), errorCode('STORAGE_FAILURE', 'archive.notes'));
  await assert.rejects(service.archive.restore({ requestId: 'replace', text: empty.text, expectedDigest: empty.digest, expectedHistoryRevision: 0 }),
    errorCode('STORAGE_FAILURE', 'archive.notes'));
  assert.deepEqual(await service.notes.history(), before);
  await service.notes.delete({ requestId: 'delete', noteId: note.id, expectedRevision: 1 });
  await assert.rejects(service.archive.export(), errorCode('STORAGE_FAILURE', 'archive.notes'));
});

test('FTS migration failure restores the previous schema, rows, and version; retry succeeds', async (t) => {
  const databasePath = await path(t);
  const db = new DatabaseSync(databasePath); t.after(() => db.close());
  const driver = migrationDriver(db);
  runSqliteMigrations(driver, SQLITE_MIGRATIONS.slice(0, 5));
  const catalog = db.prepare('SELECT * FROM exercises ORDER BY catalog_position').all();
  assert.throws(() => runSqliteMigrations({ ...driver, execute(statement) {
    if (statement.sql.startsWith('CREATE VIRTUAL TABLE')) throw new Error('Injected missing FTS5');
    return driver.execute(statement);
  } }, SQLITE_MIGRATIONS), errorCode('STORAGE_FAILURE'));
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 5);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'note_ids'").get(), undefined);
  assert.deepEqual(db.prepare('SELECT * FROM exercises ORDER BY catalog_position').all(), catalog);
  assert.deepEqual(runSqliteMigrations(driver, SQLITE_MIGRATIONS), [6, 7]);
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 7);
});

test('stored DTO corruption fails typed and a valid stale confirmation is suppressed', async (t) => {
  const databasePath = await path(t);
  const service = openNodeForma({ databasePath }); t.after(() => service.close());
  const note = await service.notes.create({ requestId: 'create', date: '2026-10-14', text: 'knee' });
  const confirmation = await service.notes.confirmFields({ requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() });
  const db = new DatabaseSync(databasePath); t.after(() => db.close());
  const replace = (value: unknown) => db.prepare('UPDATE note_confirmations SET confirmation_json = ? WHERE note_id = ?').run(JSON.stringify(value), note.id);
  replace({ ...confirmation, source: { ...confirmation.source, revision: 1 } });
  assert.equal((await service.notes.fields(note.id)).confirmation, null);
  replace({ ...confirmation, fields: { pain: [], sleep: { durationMin: null, quality: null }, personalBest: null } });
  await assert.rejects(service.notes.fields(note.id), errorCode('STORAGE_FAILURE'));
  replace({ ...confirmation, source: { ...confirmation.source, noteId: 'different' } });
  await assert.rejects(service.notes.fields(note.id), errorCode('STORAGE_FAILURE'));
  db.prepare('UPDATE notes SET date = ? WHERE id = ?').run('invalid-date', note.id);
  await assert.rejects(service.notes.get(note.id), errorCode('STORAGE_FAILURE'));
});

test('notes reads use a FIFO coherent snapshot between writes', async (t) => {
  const store = SqliteWorkoutStore.open({ databasePath: await path(t) }); t.after(() => store.close());
  const service = openNodeForma({ databasePath: ':memory:' }); t.after(() => service.close());
  const note = await service.notes.create({ requestId: 'one', date: '2026-10-14', text: 'one' });
  const { source: _source, ...record } = note;
  const first = store.write((writer) => writer.saveNote(record));
  const snapshot = store.read(async (reader) => {
    const before = await reader.getNote(note.id);
    await Promise.resolve();
    assert.deepEqual(await reader.getNote(note.id), before);
    return before;
  });
  const second = store.write((writer) => writer.saveNote({ ...record, text: 'two', revision: 2 }));
  await Promise.all([first, second]);
  assert.equal((await snapshot)?.text, 'one');
  assert.equal((await store.read((reader) => reader.getNote(note.id)))?.text, 'two');
});
