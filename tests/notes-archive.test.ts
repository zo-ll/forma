import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { migrationDriver } from './sqlite-helpers.js';
import { runSqliteMigrations, SQLITE_MIGRATIONS } from '@forma/adapters/sqlite';
import { openNodeForma } from '@forma/adapters/node';
import { ARCHIVE_LIMITS } from '@forma/core';
import type { FormaService } from '@forma/core';
import { canonicalArchiveValue, signedArchive } from './fixtures/archive-cases.js';
import { fieldsWithPain, leftKnee } from './fixtures/note-field-cases.js';
import { errorCode, TEST_TIME, memoryFixture } from './helpers.js';

async function database(t: TestContext, prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), 'forma-notes-archive-'));
  const path = join(dir, 'records.sqlite'); let id = 0;
  const service = openNodeForma({ databasePath: path, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => prefix + ++id } });
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  return { service, path };
}
async function restore(service: FormaService, text: string, requestId = 'restore') {
  const preview = await service.archive.inspect({ text });
  return service.archive.restore({ requestId, text, expectedDigest: preview.digest, expectedHistoryRevision: preview.currentHistoryRevision });
}
function rows(path: string) {
  const db = new DatabaseSync(path);
  try { return Object.fromEntries(['workouts', 'sets', 'notes', 'note_ids', 'note_confirmations', 'request_receipts',
    'workout_history_state', 'notes_history_state', 'archive_state'].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all()])); }
  finally { db.close(); }
}
async function seed(service: FormaService) {
  const note = await service.notes.create({ requestId: 'create-note', date: '2026-10-14', text: '  café knee 💤\r\n', kind: 'pain' });
  const command = { requestId: 'confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain([leftKnee('uncertain')]) };
  const confirmation = await service.notes.confirmFields(command);
  await service.notes.create({ requestId: 'second-note', date: note.date, text: 'café knee other' });
  const deleted = await service.notes.create({ requestId: 'deleted-note', date: note.date, text: 'removedtext' });
  await service.notes.delete({ requestId: 'delete-note', noteId: deleted.id, expectedRevision: 1 });
  await service.workouts.create({ requestId: 'workout', date: note.date });
  return { note, command, confirmation, deleted };
}

test('archive notes, fields, reservations, original receipts, and FTS survive replacement and reopen', async (t) => {
  const source = await database(t, 'src'); const saved = await seed(source.service);
  const exported = await source.service.archive.export();
  const target = await database(t, 'dst');
  for (let i = 0; i < 2; i++) {
    await target.service.notes.create({ requestId: 'old-note' + i, date: saved.note.date, text: 'oldtargettext' });
    await target.service.workouts.create({ requestId: 'old-workout' + i, date: saved.note.date });
  }
  const history = await target.service.notes.history({ limit: 1 });
  const search = await target.service.notes.searchText({ query: 'oldtargettext', limit: 1 });
  const workouts = await target.service.workouts.history({ limit: 1 });
  await restore(target.service, exported.text);
  await assert.rejects(target.service.notes.history({ cursor: history.nextCursor! }), errorCode('CONFLICT', 'cursor'));
  await assert.rejects(target.service.notes.searchText({ query: 'oldtargettext', cursor: search.nextCursor! }), errorCode('CONFLICT', 'cursor'));
  await assert.rejects(target.service.workouts.history({ cursor: workouts.nextCursor! }), errorCode('CONFLICT', 'cursor'));
  assert.equal((await target.service.notes.searchText({ query: 'oldtargettext' })).items.length, 0);
  assert.equal((await target.service.notes.searchText({ query: 'removedtext' })).items.length, 0);
  assert.deepEqual((await target.service.notes.searchText({ query: 'café knee' })).items,
    (await source.service.notes.searchText({ query: 'café knee' })).items);
  const expected = rows(source.path); const actual = rows(target.path);
  for (const table of ['notes', 'note_ids', 'note_confirmations', 'workouts', 'sets']) assert.deepEqual(actual[table], expected[table]);
  assert.deepEqual(actual.request_receipts!.filter(row => row.request_id !== 'restore'), expected.request_receipts);
  await target.service.close();
  const reopened = openNodeForma({ databasePath: target.path, ids: {next: () => saved.deleted.id} }); t.after(() => reopened.close());
  assert.deepEqual((await reopened.notes.fields(saved.note.id)).confirmation, saved.confirmation);
  assert.deepEqual(await reopened.notes.confirmFields(saved.command), saved.confirmation);
  assert.deepEqual((await reopened.notes.searchText({ query: 'café knee' })).items,
    (await source.service.notes.searchText({ query: 'café knee' })).items);
  assert.equal((await reopened.archive.export()).counts.reservedNoteIds, 3);
  await assert.rejects(reopened.notes.create({requestId: 'reuse-deleted', date: saved.note.date, text: 'reuse'}), errorCode('CONFLICT', 'id'));
});

test('failures after deletion and insertion in either module roll back every primary row, index, and revision', async (t) => {
  const source = await database(t, 'src'); const saved = await seed(source.service);
  const archive = await source.service.archive.export(); const target = await database(t, 'dst'); await seed(target.service);
  const db = new DatabaseSync(target.path); t.after(() => db.close());
  const failures = [
    'BEFORE DELETE ON notes', 'BEFORE DELETE ON workouts', 'BEFORE DELETE ON note_ids',
    'BEFORE INSERT ON workouts', 'BEFORE INSERT ON notes', 'BEFORE INSERT ON note_confirmations',
    'BEFORE INSERT ON note_ids', 'BEFORE INSERT ON request_receipts', 'BEFORE UPDATE ON notes_history_state',
    "BEFORE INSERT ON request_receipts WHEN NEW.operation = 'archive.restore'",
  ];
  for (const failure of failures) {
    const before = rows(target.path); const search = await target.service.notes.searchText({ query: 'café' });
    const preview = await target.service.archive.inspect({ text: archive.text });
    db.exec("CREATE TRIGGER inject_archive_failure " + failure + " BEGIN SELECT RAISE(ABORT, 'Injected'); END");
    await assert.rejects(target.service.archive.restore({ requestId: 'restore-failed', text: archive.text, expectedDigest: archive.digest,
      expectedHistoryRevision: preview.currentHistoryRevision }), errorCode('STORAGE_FAILURE'), failure);
    db.exec('DROP TRIGGER inject_archive_failure');
    assert.deepEqual(rows(target.path), before, failure);
    assert.deepEqual(await target.service.notes.searchText({ query: 'café' }), search, failure);
  }
  await restore(target.service, archive.text, 'restore-failed');
  assert.deepEqual((await target.service.notes.fields(saved.note.id)).confirmation, saved.confirmation);
});

test('strict archive validation rejects malformed sources, receipts, normalized signatures, and budgets before writes', async (t) => {
  const source = await database(t, 'src'); await seed(source.service);
  const exported = await source.service.archive.export(); const target = await database(t, 'dst'); await seed(target.service);
  const bad: [string, (root: any) => void][] = [
    ['archive.notes', root => root.modules.notes.records.push(root.modules.notes.records[0])],
    ['archive.notes', root => root.modules.notes.reservedIds.pop()],
    ['archive.notes', root => root.modules.notes.confirmations[0].source.revision++],
    ['archive.notes', root => root.modules.notes.confirmations[0].confirmedAt = '2026-10-13T09:00:00.000Z'],
    ['archive.notes', root => root.modules.notes.confirmations[0].source.noteId = 'missing'],
    ['archive.notes', root => root.modules.notes.records[0].source = { module: 'notes' }],
    ['archive.requests', root => { const r = root.modules.requests.receipts.find((r: any) => r.operation === 'notes.confirmFields');
      const result = JSON.parse(r.resultJson); result.source.revision++; r.resultJson = JSON.stringify(result); }],
    ['archive.requests', root => { const r = root.modules.requests.receipts.find((r: any) => r.operation === 'notes.create');
      const result = JSON.parse(r.resultJson); result.text = 'different'; r.resultJson = JSON.stringify(result); }],
    ['archive.requests', root => { const r = root.modules.requests.receipts.find((r: any) => r.operation === 'notes.delete'); r.resultJson = '{}'; }],
    ['archive.requests', root => root.modules.requests.receipts[0].inputSignature = ' ' + root.modules.requests.receipts[0].inputSignature],
    ['archive.requests', root => root.modules.requests.receipts.push(root.modules.requests.receipts[0])],
    ['archive.size', root => root.modules.notes.reservedIds = Array(ARCHIVE_LIMITS.maxReservedNoteIds + 1).fill('x')],
  ];
  const before = rows(target.path);
  for (const [field, change] of bad) {
    const root = JSON.parse(exported.text); change(root); const text = signedArchive(root);
    await assert.rejects(target.service.archive.inspect({ text }), errorCode('INVALID_INPUT', field));
    await assert.rejects(target.service.archive.restore({ requestId: 'bad', text, expectedDigest: JSON.parse(text).integrity.digest, expectedHistoryRevision: 0 }), errorCode('INVALID_INPUT', field));
    assert.deepEqual(rows(target.path), before);
  }
});

test('new-input validation uses the detached fields, not a second read of caller-owned input', async (t) => {
  const service = memoryFixture(t).service;
  const note = await service.notes.create({requestId: 'create', date: '2026-10-14', text: 'knee'});
  const invalidFields = fieldsWithPain([leftKnee(), {...leftKnee(), bodyPart: 'other', otherBodyPart: 'knee'}]);
  let reads = 0;
  const input = {requestId: 'getter-confirm', noteId: note.id, expectedRevision: 1,
    get fields() { return reads++ === 0 ? invalidFields : fieldsWithPain(); }};
  await assert.rejects(service.notes.confirmFields(input), errorCode('INVALID_INPUT', 'pain'));
  assert.equal((await service.notes.get(note.id)).revision, 1);
  assert.equal((await service.notes.fields(note.id)).confirmation, null);
});

test('released cross-alias confirmations have a read/replay-only compatibility path', async (t) => {
  const source = await database(t, 'src'); const saved = await seed(source.service);
  const root = JSON.parse((await source.service.archive.export()).text);
  const legacyFields = fieldsWithPain([leftKnee('uncertain'), { ...leftKnee('absent', 0), bodyPart: 'other', otherBodyPart: 'knee' }]);
  root.modules.notes.confirmations[0].fields = legacyFields;
  const receipt = root.modules.requests.receipts.find((r: any) => r.operation === 'notes.confirmFields');
  const signature = JSON.parse(receipt.inputSignature); signature.fields = legacyFields;
  const result = JSON.parse(receipt.resultJson); result.fields = legacyFields;
  receipt.inputSignature = canonicalArchiveValue(signature); receipt.resultJson = JSON.stringify(result);
  const target = await database(t, 'dst'); await restore(target.service, signedArchive(root));
  const replay = { ...saved.command, fields: legacyFields };
  assert.deepEqual(await target.service.notes.confirmFields(replay), result);
  assert.deepEqual((await target.service.notes.fields(saved.note.id)).confirmation, result);
  const before = rows(target.path);
  await assert.rejects(target.service.notes.confirmFields({ ...replay, requestId: 'new-invalid', expectedRevision: 2 }), errorCode('INVALID_INPUT', 'pain'));
  assert.deepEqual(rows(target.path), before);
  const again = JSON.parse((await target.service.archive.export()).text);
  assert.deepEqual(again.modules.requests.receipts.find((r: any) => r.requestId === receipt.requestId), receipt);
});

test('schema-7 upgrade preserves note records, fields, receipts, and reservations and rolls back on failure', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'forma-archive-upgrade-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'old.sqlite'); const db = new DatabaseSync(path);
  const driver = migrationDriver(db);
  runSqliteMigrations(driver, SQLITE_MIGRATIONS.slice(0, 7));
  const record = {id: 'old-note', date: '2026-10-14', text: 'original café', kind: 'pain', revision: 2, createdAt: TEST_TIME, updatedAt: TEST_TIME};
  const confirmation = {formatVersion: 1, source: {module: 'notes', noteId: record.id, revision: 2}, confirmedAt: TEST_TIME, fields: fieldsWithPain()};
  db.prepare('INSERT INTO note_ids (id) VALUES (?)').run(record.id);
  db.prepare('INSERT INTO note_ids (id) VALUES (?)').run('deleted-note');
  db.prepare('INSERT INTO notes (id,date,text,kind,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(record.id, record.date, record.text, record.kind, record.revision, record.createdAt, record.updatedAt);
  db.prepare('INSERT INTO note_confirmations (note_id,confirmation_json) VALUES (?,?)').run(record.id, JSON.stringify(confirmation));
  const receipt = {requestId: 'old-create', operation: 'notes.create', formatVersion: 1,
    inputSignature: canonicalArchiveValue({date: record.date, kind: record.kind, text: record.text}),
    resultJson: JSON.stringify({...record, revision: 1, source: {module: 'notes', noteId: record.id, revision: 1}})};
  db.prepare('INSERT INTO request_receipts (request_id,operation,input_signature,result_json,format_version) VALUES (?,?,?,?,?)')
    .run(receipt.requestId, receipt.operation, receipt.inputSignature, receipt.resultJson, receipt.formatVersion);
  assert.throws(() => runSqliteMigrations({...driver, execute(statement) {
    if (statement.sql.includes('CREATE TRIGGER archive_notes_')) throw new Error('Injected migration 8 failure');
    return driver.execute(statement);
  }}, SQLITE_MIGRATIONS), errorCode('STORAGE_FAILURE'));
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 7);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='archive_state'").get(), undefined);
  const before = db.prepare('SELECT * FROM request_receipts').all(); db.close();
  const service = openNodeForma({databasePath: path}); t.after(() => service.close());
  assert.deepEqual((await service.notes.fields(record.id)).confirmation, confirmation);
  const exported = JSON.parse((await service.archive.export()).text);
  assert.deepEqual(exported.modules.notes.records, [record]);
  assert.deepEqual(exported.modules.notes.reservedIds, ['deleted-note', record.id]);
  const check = new DatabaseSync(path); t.after(() => check.close());
  assert.deepEqual(check.prepare('SELECT * FROM request_receipts').all(), before);
  assert.equal((await service.notes.searchText({query: 'original café'})).items[0]!.text, record.text);
});

test('export rejects a confirmation payload attached to another valid primary row', async (t) => {
  const source = await database(t, 'src'); const saved = await seed(source.service);
  const second = (await source.service.notes.history()).items.find(note => note.id !== saved.note.id)!;
  const db = new DatabaseSync(source.path); t.after(() => db.close());
  db.prepare('UPDATE note_confirmations SET confirmation_json = ? WHERE note_id = ?')
    .run(JSON.stringify({...saved.confirmation, source: second.source, confirmedAt: second.updatedAt}), saved.note.id);
  await assert.rejects(source.service.archive.export(), errorCode('STORAGE_FAILURE', 'archive.notes'));
});

test('global revision overflow rolls back notes, receipts, and reservations', async (t) => {
  const target = await database(t, 'target'); await seed(target.service);
  const db = new DatabaseSync(target.path); t.after(() => db.close());
  db.exec('UPDATE archive_state SET revision = 9007199254740991');
  const before = rows(target.path);
  await assert.rejects(target.service.notes.create({requestId: 'overflow', date: '2026-10-14', text: 'not saved'}), errorCode('STORAGE_FAILURE'));
  assert.deepEqual(rows(target.path), before);
});

test('mixed-module export reads one coherent snapshot between queued writes', async (t) => {
  const target = await database(t, 'target');
  const firstNote = target.service.notes.create({requestId: 'first-note', date: '2026-10-14', text: 'before'});
  const firstWorkout = target.service.workouts.create({requestId: 'first-workout', date: '2026-10-14'});
  const exporting = target.service.archive.export();
  const afterNote = target.service.notes.create({requestId: 'after-note', date: '2026-10-14', text: 'after'});
  const afterWorkout = target.service.workouts.create({requestId: 'after-workout', date: '2026-10-14'});
  await Promise.all([firstNote, firstWorkout, afterNote, afterWorkout]);
  const exported = await exporting;
  assert.equal(exported.counts.notes, 1); assert.equal(exported.counts.workouts, 1); assert.equal(exported.counts.receipts, 2);
  assert.deepEqual(JSON.parse(exported.text).modules.requests.receipts.map((r: any) => r.requestId), ['first-note', 'first-workout']);
});

test('released version-1 restore receipt results upcast without changing original strings', async (t) => {
  const source = await database(t, 'src');
  const root = JSON.parse((await source.service.archive.export()).text); root.formatVersion = 1; delete root.modules.notes;
  const originalText = signedArchive(root); const digest = JSON.parse(originalText).integrity.digest;
  const oldCounts = { workouts: 0, sets: 0, receipts: 0, inProgress: 0 };
  const receipt = { requestId: 'old-restore', operation: 'archive.restore', formatVersion: 1,
    inputSignature: canonicalArchiveValue({ digest, expectedHistoryRevision: 0 }), resultJson: JSON.stringify({ digest, counts: oldCounts }) };
  root.modules.requests.receipts.push(receipt);
  const target = await database(t, 'dst'); await restore(target.service, signedArchive(root));
  await target.service.notes.create({ requestId: 'later', date: '2026-10-14', text: 'must survive replay' });
  const result = await target.service.archive.restore({ requestId: 'old-restore', text: originalText, expectedDigest: digest, expectedHistoryRevision: 0 });
  assert.deepEqual(result.counts, { ...oldCounts, notes: 0, noteConfirmations: 0, reservedNoteIds: 0 });
  assert.equal((await target.service.notes.history()).items.length, 1);
  const current = JSON.parse((await target.service.archive.export()).text);
  assert.deepEqual(current.modules.requests.receipts.find((r: any) => r.requestId === 'old-restore'), receipt);
});
