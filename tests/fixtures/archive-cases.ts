import { sha256Utf8 } from '@forma/core';
import { fieldsWithPain, leftKnee } from './note-field-cases.js';
import type { FormaService } from '@forma/core';
import { errorCode } from './contract-helpers.js';
import type { ContractAssert } from './contract-types.js';

/**
 * A portable archive case. `open` returns a new, empty service on the same
 * adapter. The fixture closes every service that `open` returns.
 */
export interface ArchiveCase {
  readonly name: string;
  run(open: () => Promise<FormaService>): Promise<void>;
}

export function canonicalArchiveValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalArchiveValue).join(',') + ']';
  const row = value as Record<string, unknown>;
  return '{' + Object.keys(row).sort().map(key => JSON.stringify(key) + ':' + canonicalArchiveValue(row[key])).join(',') + '}';
}
/** Synthetic archive mutation helper, also portable to the native fixture harness. */
export function signedArchive(root: Record<string, unknown>): string {
  const { integrity: _ignored, ...unsigned } = root;
  return canonicalArchiveValue({ ...unsigned, integrity: { algorithm: 'sha-256', digest: sha256Utf8(canonicalArchiveValue(unsigned)) } });
}

interface Seeded {
  readonly finishedId: string;
  readonly liveId: string;
  readonly removedId: string;
}

async function seed(service: FormaService, prefix: string): Promise<Seeded> {
  const finished = await service.workouts.create({ requestId: prefix + 'create', date: '2026-10-01', splitDayId: 'lower', notes: 'Lower 🏋️ ünïcode', durationMin: 47.5 });
  await service.workouts.addSet({ requestId: prefix + 'hammer', workoutId: finished.id, exerciseId: 'hammer-curls', reps: 10, weightKg: 12.5, loadConvention: 'per-hand', implementCount: 2 });
  const preacher = await service.workouts.addSet({ requestId: prefix + 'preacher', workoutId: finished.id, exerciseId: 'preacher-curl', reps: 8, weightKg: 0.1 + 0.2, rpe: 8.5 });
  await service.workouts.addSet({ requestId: prefix + 'machine', workoutId: finished.id, exerciseId: 'preacher-curl-machine', reps: 12, weightKg: 0, loadConvention: 'body-weight' });
  await service.workouts.deleteSet({ requestId: prefix + 'delete-set', workoutId: finished.id, setId: preacher.id });
  await service.workouts.update({ requestId: prefix + 'update', workoutId: finished.id, notes: 'Edited' });
  const removed = await service.workouts.create({ requestId: prefix + 'removed', date: '2026-10-02' });
  await service.workouts.delete({ requestId: prefix + 'delete', workoutId: removed.id });
  const live = await service.workouts.start({ requestId: prefix + 'start', date: '2026-10-03', splitDayId: 'upper' });
  await service.workouts.addSet({ requestId: prefix + 'live-set', workoutId: live.id, exerciseId: 'lateral-raises', reps: 15, weightKg: 6, loadConvention: 'entered' });
  return { finishedId: finished.id, liveId: live.id, removedId: removed.id };
}

async function restore(service: FormaService, text: string, requestId: string) {
  const inspection = await service.archive.inspect({ text });
  return service.archive.restore({ requestId, text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision });
}

export function collectArchiveCases(assert: ContractAssert): readonly ArchiveCase[] {
  const cases: ArchiveCase[] = [];
  const check = (name: string, run: ArchiveCase['run']): void => { cases.push({ name, run }); };

  check('export and restore keep exact records, catalog order, and replayable receipts', async (open) => {
    const source = await open();
    const ids = await seed(source, 'a-');
    const exported = await source.archive.export();
    assert.deepEqual(exported.counts, { notes: 0, noteConfirmations: 0, reservedNoteIds: 0, workouts: 2, sets: 3, receipts: 10, inProgress: 1 });
    const target = await open();
    await target.workouts.create({ requestId: 'target-only', date: '2026-09-30' });
    const result = await restore(target, exported.text, 'restore-1');
    assert.deepEqual(result, { digest: exported.digest, counts: exported.counts });
    assert.deepEqual(await target.workouts.list(), await source.workouts.list());
    assert.deepEqual(await target.exercises.list(), await source.exercises.list());
    assert.deepEqual(await target.splitDays.list(), await source.splitDays.list());
    const lower = await target.splitDays.get('lower');
    assert.equal(lower.exerciseIds[3], 'hammer-curls');
    assert.deepEqual(await target.workouts.inProgress(), await source.workouts.inProgress());
    // Replays return the original snapshots, also for deleted records.
    const replayed = await target.workouts.addSet({ requestId: 'a-preacher', workoutId: ids.finishedId, exerciseId: 'preacher-curl', reps: 8, weightKg: 0.1 + 0.2, rpe: 8.5 });
    assert.equal(replayed.weightKg, 0.1 + 0.2);
    assert.equal((await target.workouts.create({ requestId: 'a-removed', date: '2026-10-02' })).id, ids.removedId);
    await assert.rejects(target.workouts.get(ids.removedId), errorCode('NOT_FOUND', 'workoutId'));
    // The target receipt is gone. The same request ID is a new command now.
    assert.notEqual((await target.workouts.create({ requestId: 'target-only', date: '2026-09-30' })).id, undefined);
    // A second export has the same records and one more receipt: the restore receipt.
    const again = await target.archive.export();
    assert.equal(again.counts.receipts, exported.counts.receipts + 2);
  });

  check('the restored active session keeps the one-active rule', async (open) => {
    const source = await open();
    const ids = await seed(source, 'b-');
    const target = await open();
    await restore(target, (await source.archive.export()).text, 'restore-b');
    assert.equal((await target.workouts.inProgress())?.id, ids.liveId);
    await assert.rejects(target.workouts.start({ requestId: 'second-start', date: '2026-10-04' }), errorCode('CONFLICT', 'status'));
    const finished = await target.workouts.finish({ requestId: 'finish-live', workoutId: ids.liveId });
    assert.equal(finished.status, 'finished');
  });

  check('a retry replays, and a changed identity conflicts', async (open) => {
    const source = await open();
    await seed(source, 'c-');
    const { text } = await source.archive.export();
    const target = await open();
    const inspection = await target.archive.inspect({ text });
    const input = { requestId: 'restore-c', text, expectedDigest: inspection.digest, expectedHistoryRevision: inspection.currentHistoryRevision };
    const first = await target.archive.restore(input);
    await target.workouts.create({ requestId: 'after-restore', date: '2026-10-09' });
    assert.deepEqual(await target.archive.restore(input), first);
    assert.equal((await target.workouts.list()).length, 3);
    const empty = await (await open()).archive.export();
    await assert.rejects(target.archive.restore({ ...input, text: empty.text, expectedDigest: empty.digest }), errorCode('CONFLICT', 'requestId'));
  });

  check('a change after inspection conflicts with zero replacement', async (open) => {
    const source = await open();
    await seed(source, 'd-');
    const { text } = await source.archive.export();
    const target = await open();
    const inspection = await target.archive.inspect({ text });
    const kept = await target.workouts.create({ requestId: 'between', date: '2026-10-05' });
    await assert.rejects(target.archive.restore({ requestId: 'restore-d', text, expectedDigest: inspection.digest,
      expectedHistoryRevision: inspection.currentHistoryRevision }), errorCode('CONFLICT', 'expectedHistoryRevision'));
    assert.deepEqual(await target.workouts.list(), [kept]);
    const current = await target.archive.inspect({ text });
    assert.deepEqual(current.current, { notes: 0, noteConfirmations: 0, reservedNoteIds: 0, workouts: 1, sets: 0, receipts: 1, inProgress: 0 });
    assert(current.currentHistoryRevision > inspection.currentHistoryRevision);
  });

  check('an empty restore advances the revision and makes cursors stale', async (open) => {
    const empty = await (await open()).archive.export();
    const target = await open();
    for (const day of ['01', '02']) await target.workouts.create({ requestId: 'day-' + day, date: '2026-10-' + day });
    const page = await target.workouts.history({ limit: 1 });
    assert(page.nextCursor);
    const inspection = await target.archive.inspect({ text: empty.text });
    await target.archive.restore({ requestId: 'restore-e', text: empty.text, expectedDigest: empty.digest,
      expectedHistoryRevision: inspection.currentHistoryRevision });
    assert.deepEqual(await target.workouts.list(), []);
    await assert.rejects(target.workouts.history({ cursor: page.nextCursor }), errorCode('CONFLICT', 'cursor'));
    const after = await target.archive.inspect({ text: empty.text });
    assert(after.currentHistoryRevision > inspection.currentHistoryRevision);
  });

  check('a damaged archive fails before replacement', async (open) => {
    const source = await open();
    await seed(source, 'f-');
    const { text } = await source.archive.export();
    const target = await open();
    const kept = await target.workouts.create({ requestId: 'kept', date: '2026-10-07' });
    const damaged = text.replace('"reps":15', '"reps":16');
    await assert.rejects(target.archive.inspect({ text: damaged }), errorCode('INVALID_INPUT', 'archive.integrity'));
    await assert.rejects(target.archive.restore({ requestId: 'restore-f', text: damaged, expectedDigest: '0'.repeat(64), expectedHistoryRevision: 0 }),
      errorCode('INVALID_INPUT', 'archive.integrity'));
    assert.deepEqual(await target.workouts.list(), [kept]);
  });

  check('notes, confirmations, deleted identities, and original receipts round trip', async (open) => {
    const source = await open();
    const created = await source.notes.create({ requestId: 'note-create', date: '2026-10-14', text: '  Knee pain 💤\r\n', kind: 'pain' });
    const command = { requestId: 'note-confirm', noteId: created.id, expectedRevision: 1,
      fields: { ...fieldsWithPain([leftKnee('absent', 0)]), sleep: { durationMin: 0, quality: null } } };
    const confirmed = await source.notes.confirmFields(command);
    const removed = await source.notes.create({ requestId: 'removed-note', date: '2026-10-13', text: 'deleted exact text' });
    await source.notes.delete({ requestId: 'delete-note', noteId: removed.id, expectedRevision: 1 });
    await source.workouts.create({ requestId: 'workout-create', date: '2026-10-14' });
    const archive = await source.archive.export();
    assert.equal(archive.counts.notes, 1); assert.equal(archive.counts.noteConfirmations, 1);
    assert.equal(archive.counts.reservedNoteIds, 2);
    const target = await open();
    const extra = await target.notes.create({ requestId: 'target-note', date: '2026-10-12', text: 'remove this' });
    await restore(target, archive.text, 'restore-notes');
    assert.deepEqual((await target.notes.history()).items, (await source.notes.history()).items);
    assert.deepEqual((await target.notes.fields(created.id)).confirmation, confirmed);
    assert.deepEqual(await target.notes.create({ requestId: 'note-create', date: created.date, text: created.text, kind: 'pain' }), created);
    assert.deepEqual(await target.notes.confirmFields(command), confirmed);
    await assert.rejects(target.notes.get(removed.id), errorCode('NOT_FOUND', 'noteId'));
    await assert.rejects(target.notes.get(extra.id), errorCode('NOT_FOUND', 'noteId'));
    await assert.rejects(target.workouts.create({ requestId: 'note-create', date: created.date }), errorCode('CONFLICT', 'requestId'));
    const again = JSON.parse((await target.archive.export()).text);
    assert(again.modules.notes.reservedIds.includes(removed.id));
    assert(!again.modules.notes.reservedIds.includes(extra.id));
    const original = JSON.parse(archive.text).modules.requests.receipts;
    assert.deepEqual(again.modules.requests.receipts.filter((r: {requestId: string}) => r.requestId !== 'restore-notes'), original);
  });

  check('every notes write rejects stale restore confirmation', async (open) => {
    const source = await open(); const archive = await source.archive.export();
    const target = await open();
    let note = await target.notes.create({ requestId: 'initial', date: '2026-10-14', text: 'current' });
    for (const operation of ['create', 'update', 'confirm', 'delete']) {
      const preview = await target.archive.inspect({ text: archive.text });
      if (operation === 'create') await target.notes.create({ requestId: 'between-create', date: note.date, text: 'another' });
      if (operation === 'update') note = await target.notes.update({ requestId: 'between-update', noteId: note.id, expectedRevision: note.revision, text: 'changed' });
      if (operation === 'confirm') {
        await target.notes.confirmFields({ requestId: 'between-confirm', noteId: note.id, expectedRevision: note.revision, fields: fieldsWithPain() });
        note = await target.notes.get(note.id);
      }
      if (operation === 'delete') await target.notes.delete({ requestId: 'between-delete', noteId: note.id, expectedRevision: note.revision });
      const before = (await target.archive.export()).text;
      await assert.rejects(target.archive.restore({ requestId: 'stale-' + operation, text: archive.text, expectedDigest: archive.digest,
        expectedHistoryRevision: preview.currentHistoryRevision }), errorCode('CONFLICT', 'expectedHistoryRevision'));
      assert.equal((await target.archive.export()).text, before);
    }
  });

  check('version-1 restore explicitly empties notes, confirmations, and reservations', async (open) => {
    const source = await open();
    await source.workouts.create({ requestId: 'old-workout', date: '2026-10-14' });
    const root = JSON.parse((await source.archive.export()).text);
    root.formatVersion = 1; delete root.modules.notes;
    const legacy = signedArchive(root);
    const target = await open();
    const note = await target.notes.create({ requestId: 'current-note', date: '2026-10-14', text: 'will become empty' });
    await target.notes.confirmFields({ requestId: 'confirm-current', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain() });
    const preview = await target.archive.inspect({ text: legacy });
    assert.equal(preview.formatVersion, 1); assert.deepEqual(preview.missingModules, ['notes']);
    assert.equal(preview.current.notes, 1); assert.equal(preview.archive.reservedNoteIds, 0);
    await target.archive.restore({ requestId: 'legacy-restore', text: legacy, expectedDigest: preview.digest, expectedHistoryRevision: preview.currentHistoryRevision });
    assert.equal((await target.notes.history()).items.length, 0);
    const exported = JSON.parse((await target.archive.export()).text);
    assert.deepEqual(exported.modules.notes, { version: 1, records: [], confirmations: [], reservedIds: [] });
    assert.deepEqual(await target.workouts.list(), await source.workouts.list());
  });

  check('released cross-alias confirmation receipts replay without enabling new overlapping writes', async (open) => {
    const source = await open();
    const note = await source.notes.create({requestId: 'legacy-note', date: '2026-10-14', text: 'knee'});
    const command = {requestId: 'legacy-confirm', noteId: note.id, expectedRevision: 1, fields: fieldsWithPain()};
    await source.notes.confirmFields(command);
    const root = JSON.parse((await source.archive.export()).text);
    const oldFields = fieldsWithPain([leftKnee(), {...leftKnee('absent', 0), bodyPart: 'other', otherBodyPart: 'knee'}]);
    root.modules.notes.confirmations[0].fields = oldFields;
    const receipt = root.modules.requests.receipts.find((r: {requestId: string}) => r.requestId === command.requestId);
    const input = JSON.parse(receipt.inputSignature); input.fields = oldFields;
    const output = JSON.parse(receipt.resultJson); output.fields = oldFields;
    receipt.inputSignature = canonicalArchiveValue(input); receipt.resultJson = JSON.stringify(output);
    const target = await open(); await restore(target, signedArchive(root), 'legacy-fields-restore');
    assert.deepEqual(await target.notes.confirmFields({...command, fields: oldFields}), output);
    assert.deepEqual((await target.notes.fields(note.id)).confirmation, output);
    await assert.rejects(target.notes.confirmFields({...command, requestId: 'new-overlap', expectedRevision: 2, fields: oldFields}),
      errorCode('INVALID_INPUT', 'pain'));
    const exported = JSON.parse((await target.archive.export()).text);
    assert.deepEqual(exported.modules.requests.receipts.find((r: {requestId: string}) => r.requestId === command.requestId), receipt);
  });

  return cases;
}
