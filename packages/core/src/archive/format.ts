import { FormaError } from '../errors.js';
import { noteFromRecord, noteId } from '../notes/validation.js';
import { noteFieldConfirmationResult } from '../notes/field-validation.js';
import type { ArchiveNotesRecords, ArchiveRecords, RequestReceipt } from '../ports.js';
import { canonicalJson } from '../requests/service.js';
import type { ArchiveCounts, Exercise, SplitDay, Workout } from '../types.js';
import { identifier, invalid, objectInput, text, utcTimestamp } from '../validation.js';
import { workoutResult } from '../workouts/results.js';
import { checkReceiptContent } from './receipts.js';
import { sha256Utf8, utf8ByteLength } from './sha256.js';

export const ARCHIVE_FORMAT_VERSION = 2;

/** A declared initial limit, not a device-proven capacity. A limit failure rejects the whole archive. */
export const ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 16_777_216,
  maxWorkouts: 10_000,
  maxSets: 100_000,
  maxReceipts: 100_000,
  maxNotes: 10_000, maxNoteConfirmations: 10_000, maxReservedNoteIds: 100_000, maxRecords: 250_000,
});

export const ARCHIVE_MODULES: readonly string[] = Object.freeze(['catalog', 'notes', 'requests', 'workouts']);

export interface ArchiveContent extends ArchiveRecords {
  readonly createdAt: string;
  readonly exercises: readonly Exercise[];
  readonly splitDays: readonly SplitDay[];
}

export interface ParsedArchive extends ArchiveContent {
  readonly formatVersion: 1 | 2;
  readonly notes: ArchiveNotesRecords;
  readonly missingModules: readonly string[];
  readonly digest: string;
  readonly byteLength: number;
  readonly counts: ArchiveCounts;
}

type Fields = Record<string, unknown>;

function archiveError(field: string, message: string, cause?: unknown): FormaError {
  return new FormaError('INVALID_INPUT', message, { field, cause });
}

/** Run a check and report any rule failure on one archive field. */
function within<T>(field: string, label: string, run: () => T): T {
  try { return run(); }
  catch (cause) {
    if (cause instanceof FormaError && cause.field?.startsWith('archive')) throw cause;
    const detail = cause instanceof Error ? ' ' + cause.message : '';
    throw archiveError(field, label + ' is not valid.' + detail, cause);
  }
}

function fields(value: unknown, keys: readonly string[], field: string, label: string): Fields {
  within(field, label, () => objectInput(value, keys));
  const record = value as Fields;
  for (const key of keys) if (!Object.hasOwn(record, key)) throw archiveError(field, label + ' must contain ' + key + '.');
  return record;
}

function list(value: unknown, field: string, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw archiveError(field, label + ' must be an array.');
  return value;
}

export function checkCounts(counts: ArchiveCounts): void {
  if (counts.workouts > ARCHIVE_LIMITS.maxWorkouts || counts.sets > ARCHIVE_LIMITS.maxSets
    || counts.receipts > ARCHIVE_LIMITS.maxReceipts || counts.notes > ARCHIVE_LIMITS.maxNotes
    || counts.noteConfirmations > ARCHIVE_LIMITS.maxNoteConfirmations || counts.reservedNoteIds > ARCHIVE_LIMITS.maxReservedNoteIds
    || counts.workouts + counts.sets + counts.receipts + counts.notes + counts.noteConfirmations + counts.reservedNoteIds > ARCHIVE_LIMITS.maxRecords) {
    throw archiveError('archive.size', 'The archive exceeds an individual record budget or the combined 250000-row budget.');
  }
}

function checkBytes(byteLength: number): void {
  if (byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
    throw archiveError('archive.size', 'The archive exceeds ' + ARCHIVE_LIMITS.maxArchiveBytes + ' bytes.');
  }
}

function body(content: ArchiveContent): Fields {
  return {
    format: 'forma.archive',
    formatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt: content.createdAt,
    modules: {
      catalog: { version: 1, exercises: content.exercises, splitDays: content.splitDays },
      notes: { version: 1, ...(content.notes ?? { records: [], confirmations: [], reservedIds: [] }) },
      requests: { version: 1, receipts: content.receipts },
      workouts: { version: 1, workouts: content.workouts },
    },
  };
}

/** Canonical archive text. The caller validates the result with parseArchive before it leaves the core. */
export function serializeArchive(content: ArchiveContent): { readonly text: string; readonly digest: string } {
  const unsigned = body(content);
  const digest = sha256Utf8(canonicalJson(unsigned));
  return { text: canonicalJson({ ...unsigned, integrity: { algorithm: 'sha-256', digest } }), digest };
}

function parseExercise(value: unknown, index: number): Exercise {
  return within('archive.catalog', 'Exercise ' + index, () => {
    const row = fields(value, ['id', 'name', 'muscleGroup', 'equipment', 'aliases'], 'archive.catalog', 'An exercise');
    const aliases = list(row.aliases, 'archive.catalog', 'Exercise aliases').map((alias) => text(alias, 'aliases'));
    return {
      id: identifier(row.id, 'id'), name: text(row.name, 'name'),
      muscleGroup: row.muscleGroup === null ? null : text(row.muscleGroup, 'muscleGroup'),
      equipment: row.equipment === null ? null : text(row.equipment, 'equipment'), aliases,
    };
  });
}

function parseSplitDay(value: unknown, index: number): SplitDay {
  return within('archive.catalog', 'Split day ' + index, () => {
    const row = fields(value, ['id', 'name', 'exerciseIds'], 'archive.catalog', 'A split day');
    const exerciseIds = list(row.exerciseIds, 'archive.catalog', 'Split-day exercises').map((id) => identifier(id, 'exerciseIds'));
    return { id: identifier(row.id, 'id'), name: text(row.name, 'name'), exerciseIds };
  });
}

const WORKOUT_KEYS = ['id', 'date', 'splitDayId', 'notes', 'durationMin', 'createdAt', 'updatedAt', 'sets', 'status', 'finishedAt'];
const SET_KEYS = ['id', 'exerciseId', 'reps', 'weightKg', 'rpe', 'position', 'loadConvention', 'implementCount'];

function parseWorkout(value: unknown, index: number): Workout {
  return within('archive.workouts', 'Workout ' + index, () => {
    const row = fields(value, WORKOUT_KEYS, 'archive.workouts', 'A workout');
    list(row.sets, 'archive.workouts', 'Workout sets').forEach((set) => fields(set, SET_KEYS, 'archive.workouts', 'A set'));
    // The released codec checks every field, set order, and distinct set IDs. The archive has no legacy forms.
    return workoutResult.parse(value);
  });
}

const RECEIPT_KEYS = ['requestId', 'operation', 'inputSignature', 'resultJson', 'formatVersion'];
function parseReceipt(value: unknown, index: number): RequestReceipt {
  return within('archive.requests', 'Receipt ' + index, () => {
    const row = fields(value, RECEIPT_KEYS, 'archive.requests', 'A receipt');
    for (const key of ['requestId', 'operation'] as const) {
      const id = identifier(row[key], key);
      if (/[\u0000\uD800-\uDFFF]/u.test(id)) invalid(key, key + ' must contain valid Unicode characters without NUL.');
    }
    if (row.formatVersion !== 1) invalid('formatVersion', 'The receipt format is not supported.');
    const operation = row.operation as string;
    const inputSignature = text(row.inputSignature, 'inputSignature');
    const resultJson = text(row.resultJson, 'resultJson');
    checkReceiptContent(operation, inputSignature, resultJson);
    return { requestId: row.requestId as string, operation, inputSignature, resultJson, formatVersion: 1 };
  });
}

function unique(ids: readonly string[], field: string, label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw archiveError(field, 'The archive has a duplicate ' + label + ': ' + id + '.');
    seen.add(id);
  }
}

/** Parse and validate the complete archive. It never reads or changes storage. */
export function parseArchive(value: unknown): ParsedArchive {
  if (typeof value !== 'string') throw archiveError('archive', 'The archive must be text.');
  // UTF-8 never uses fewer bytes than UTF-16 code units, so this bound runs before any encoding work.
  if (value.length > ARCHIVE_LIMITS.maxArchiveBytes) checkBytes(value.length);
  const byteLength = utf8ByteLength(value);
  checkBytes(byteLength);
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; }
  catch (cause) { throw archiveError('archive', 'The archive is not valid JSON.', cause); }

  const root = fields(parsed, ['format', 'formatVersion', 'createdAt', 'modules', 'integrity'], 'archive', 'The archive');
  if (root.format !== 'forma.archive') throw archiveError('archive.formatVersion', 'The file is not a Forma archive.');
  if (root.formatVersion !== 1 && root.formatVersion !== ARCHIVE_FORMAT_VERSION) throw archiveError('archive.formatVersion', 'The archive format version is not supported.');
  const createdAt = within('archive', 'The archive time', () => utcTimestamp(root.createdAt));
  if (root.modules === null || typeof root.modules !== 'object' || Array.isArray(root.modules)) {
    throw archiveError('archive.modules', 'The archive modules must be an object.');
  }
  const names = Object.keys(root.modules).sort();
  const moduleNames = root.formatVersion === 1 ? ['catalog', 'requests', 'workouts'] : ARCHIVE_MODULES;
  if (canonicalJson(names) !== canonicalJson(moduleNames)) {
    throw archiveError('archive.modules', 'The archive must contain exactly the supported modules: ' + ARCHIVE_MODULES.join(', ') + '.');
  }
  const modules = root.modules as Fields;
  const catalog = fields(modules.catalog, ['version', 'exercises', 'splitDays'], 'archive.modules', 'The catalog module');
  const requests = fields(modules.requests, ['version', 'receipts'], 'archive.modules', 'The requests module');
  const workoutModule = fields(modules.workouts, ['version', 'workouts'], 'archive.modules', 'The workouts module');
  for (const module of [catalog, requests, workoutModule]) {
    if (module.version !== 1) throw archiveError('archive.modules', 'The archive module version is not supported.');
  }

  const integrity = fields(root.integrity, ['algorithm', 'digest'], 'archive.integrity', 'The integrity record');
  if (integrity.algorithm !== 'sha-256') throw archiveError('archive.integrity', 'The integrity algorithm is not supported.');
  const { integrity: _ignored, ...unsigned } = root;
  const digest = sha256Utf8(canonicalJson(unsigned));
  if (integrity.digest !== digest) throw archiveError('archive.integrity', 'The archive digest does not match its content.');

  const noteModule = root.formatVersion === 1 ? { version: 1, records: [], confirmations: [], reservedIds: [] }
    : fields(modules.notes, ['version', 'records', 'confirmations', 'reservedIds'], 'archive.notes', 'The notes module');
  if (noteModule.version !== 1) throw archiveError('archive.modules', 'The notes module version is not supported.');
  const rawNotes = list(noteModule.records, 'archive.notes', 'The notes');
  const rawConfirmations = list(noteModule.confirmations, 'archive.notes', 'The confirmations');
  const rawIds = list(noteModule.reservedIds, 'archive.notes', 'The reserved IDs');
  const rawWorkouts = list(workoutModule.workouts, 'archive.workouts', 'The workouts');
  const rawReceipts = list(requests.receipts, 'archive.requests', 'The receipts');
  let setCount = 0;
  for (const workout of rawWorkouts) {
    const sets = workout !== null && typeof workout === 'object' ? (workout as Fields).sets : undefined;
    if (Array.isArray(sets)) setCount += sets.length;
  }
  checkCounts({ workouts: rawWorkouts.length, sets: setCount, receipts: rawReceipts.length, inProgress: 0,
    notes: rawNotes.length, noteConfirmations: rawConfirmations.length, reservedNoteIds: rawIds.length });

  const exercises = list(catalog.exercises, 'archive.catalog', 'The exercises').map(parseExercise);
  const splitDays = list(catalog.splitDays, 'archive.catalog', 'The split days').map(parseSplitDay);
  unique(exercises.map((exercise) => exercise.id), 'archive.catalog', 'exercise ID');
  unique(splitDays.map((splitDay) => splitDay.id), 'archive.catalog', 'split-day ID');

  const workouts = rawWorkouts.map(parseWorkout);
  unique(workouts.map((workout) => workout.id), 'archive.workouts', 'workout ID');
  unique(workouts.flatMap((workout) => workout.sets.map((set) => set.id)), 'archive.workouts', 'set ID');
  const exerciseIds = new Set(exercises.map((exercise) => exercise.id));
  const splitDayIds = new Set(splitDays.map((splitDay) => splitDay.id));
  for (const workout of workouts) {
    if (workout.splitDayId !== null && !splitDayIds.has(workout.splitDayId)) {
      throw archiveError('archive.workouts', 'Workout ' + workout.id + ' refers to an unknown split day.');
    }
    for (const set of workout.sets) {
      if (!exerciseIds.has(set.exerciseId)) throw archiveError('archive.workouts', 'Set ' + set.id + ' refers to an unknown exercise.');
    }
  }
  const inProgress = workouts.filter((workout) => workout.status === 'in-progress').length;
  if (inProgress > 1) throw archiveError('archive.workouts', 'The archive has more than one workout in progress.');

  const records = rawNotes.map(value => within('archive.notes', 'A note', () => {
    const { source: _source, ...record } = noteFromRecord(value); return record;
  }));
  const confirmations = rawConfirmations.map(value => within('archive.notes', 'A confirmation', () => noteFieldConfirmationResult.parse(value)));
  const reservedIds = rawIds.map(value => within('archive.notes', 'A reserved ID', () => noteId(value)));
  unique(records.map(note => note.id), 'archive.notes', 'note ID');
  unique(confirmations.map(value => value.source.noteId), 'archive.notes', 'confirmation ID');
  unique(reservedIds, 'archive.notes', 'reserved ID');
  const reserved = new Set(reservedIds);
  const byId = new Map(records.map(note => [note.id, note]));
  for (const note of records) if (!reserved.has(note.id)) throw archiveError('archive.notes', 'A primary note ID is not reserved.');
  for (const confirmation of confirmations) {
    const note = byId.get(confirmation.source.noteId);
    if (!note || note.revision !== confirmation.source.revision || note.updatedAt !== confirmation.confirmedAt) {
      throw archiveError('archive.notes', 'A confirmation does not identify the current primary note.');
    }
  }
  const receipts = rawReceipts.map(parseReceipt);
  for (const receipt of receipts) {
    if (!receipt.operation.startsWith('notes.')) continue;
    if (root.formatVersion === 1) throw archiveError('archive.requests', 'Version 1 cannot contain notes receipts.');
    const input = JSON.parse(receipt.inputSignature) as Fields;
    const result = JSON.parse(receipt.resultJson) as Fields | null;
    const id = receipt.operation === 'notes.create' ? result!.id : input.noteId;
    if (!reserved.has(id as string)) throw archiveError('archive.notes', 'A notes receipt ID is not reserved.');
  }
  unique(receipts.map((receipt) => receipt.requestId), 'archive.requests', 'request ID');

  return {
    createdAt, exercises, splitDays, workouts, receipts, digest, byteLength,
    formatVersion: root.formatVersion, notes: { records, confirmations, reservedIds },
    missingModules: root.formatVersion === 1 ? ['notes'] : [],
    counts: { workouts: workouts.length, sets: setCount, receipts: receipts.length, inProgress,
      notes: records.length, noteConfirmations: confirmations.length, reservedNoteIds: reservedIds.length },
  };
}
