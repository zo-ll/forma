import { noteFieldConfirmationResult, readReleasedNoteFields } from '../notes/field-validation.js';
import { noteId, noteKind, noteRevision, noteText } from '../notes/validation.js';
import { noteResult, noteDeleteResult } from '../notes/results.js';
import type { ResultCodec } from '../requests/service.js';
import { canonicalJson } from '../requests/service.js';
import type { ArchiveRestoreResult } from '../types.js';
import { validateSetLoadDetails } from '../workouts/loads.js';
import { sessionWorkoutResult, setResult, voidResult, workoutResult } from '../workouts/results.js';
import {
  calendarDate, effort, finiteNumber, identifier, invalid, objectInput, repetitions, text,
} from '../validation.js';

type Fields = Record<string, unknown>;

function counts(value: unknown): void {
  objectInput(value, ['workouts', 'sets', 'receipts', 'inProgress', 'notes', 'noteConfirmations', 'reservedNoteIds']);
  const record = value as Fields;
  for (const key of ['workouts', 'sets', 'receipts', 'inProgress']) {
    const count = record[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) invalid(key, key + ' must be a count.');
  }
  const extras = ['notes', 'noteConfirmations', 'reservedNoteIds'];
  if (extras.some(key => Object.hasOwn(record, key))) {
    for (const key of extras) historyRevision(record[key], key);
  }
  if ((record.inProgress as number) > 1) invalid('inProgress', 'At most one workout can be in progress.');
}

export function archiveDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid(field, field + ' must be 64 lowercase hex characters.');
  return value;
}

export function historyRevision(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(field, field + ' must be a nonnegative safe integer.');
  }
  return value;
}

export const restoreResult: ResultCodec<ArchiveRestoreResult> = {
  parse(value) {
    objectInput(value, ['digest', 'counts']);
    const record = value as Fields;
    if (!Object.hasOwn(record, 'counts')) invalid('counts', 'The restore result must contain counts.');
    counts(record.counts);
    const result = record.counts as ArchiveRestoreResult['counts'];
    return {
      digest: archiveDigest(record.digest, 'digest'),
      counts: { workouts: result.workouts, sets: result.sets, receipts: result.receipts, inProgress: result.inProgress,
        notes: result.notes ?? 0, noteConfirmations: result.noteConfirmations ?? 0, reservedNoteIds: result.reservedNoteIds ?? 0 },
    };
  },
};

function fields(value: unknown, required: readonly string[], optional: readonly string[]): Fields {
  objectInput(value, [...required, ...optional]);
  const record = value as Fields;
  for (const key of required) if (!Object.hasOwn(record, key)) invalid(key, 'The signature must contain ' + key + '.');
  return record;
}

function nullable(record: Fields, key: string, check: (value: unknown) => unknown): void {
  if (Object.hasOwn(record, key) && record[key] !== null) check(record[key]);
}

function present(record: Fields, key: string, check: (value: unknown) => unknown): void {
  if (Object.hasOwn(record, key)) check(record[key]);
}

function loadPair(record: Fields, allowUnknown: boolean): void {
  const convention = Object.hasOwn(record, 'loadConvention');
  if (convention !== Object.hasOwn(record, 'implementCount')) invalid('loadConvention', 'The load signature needs both fields.');
  if (!convention) return;
  const details = validateSetLoadDetails(record.loadConvention, record.implementCount);
  if (!allowUnknown && details.loadConvention === 'unknown') invalid('loadConvention', 'An add signature omits the unknown convention.');
}

function changed(record: Fields, keys: readonly string[]): void {
  if (!keys.some((key) => Object.hasOwn(record, key))) invalid('input', 'The update signature has no changed field.');
}

const workoutDetails = ['date', 'splitDayId', 'notes', 'durationMin'];
function createSignature(value: unknown): void {
  const record = fields(value, workoutDetails, []);
  calendarDate(record.date, 'date');
  nullable(record, 'splitDayId', (id) => identifier(id, 'splitDayId'));
  text(record.notes, 'notes');
  nullable(record, 'durationMin', (minutes) => finiteNumber(minutes, 'durationMin', 0));
}

function workoutIdSignature(value: unknown): void {
  identifier(fields(value, ['workoutId'], []).workoutId, 'workoutId');
}

interface Operation {
  readonly signature: (value: unknown) => void;
  readonly result: ResultCodec<unknown>;
}

/** The released operations and the codecs that their replay uses. */
const OPERATIONS: Readonly<Record<string, Operation>> = Object.freeze({
  'workouts.create': { signature: createSignature, result: workoutResult },
  'workouts.start': { signature: createSignature, result: sessionWorkoutResult },
  'workouts.finish': { signature: workoutIdSignature, result: sessionWorkoutResult },
  'workouts.delete': { signature: workoutIdSignature, result: voidResult },
  'workouts.discard': { signature: workoutIdSignature, result: voidResult },
  'workouts.update': {
    signature(value) {
      const record = fields(value, ['workoutId'], workoutDetails);
      identifier(record.workoutId, 'workoutId');
      changed(record, workoutDetails);
      present(record, 'date', (date) => calendarDate(date, 'date'));
      nullable(record, 'splitDayId', (id) => identifier(id, 'splitDayId'));
      present(record, 'notes', (notes) => text(notes, 'notes'));
      nullable(record, 'durationMin', (minutes) => finiteNumber(minutes, 'durationMin', 0));
    },
    result: sessionWorkoutResult,
  },
  'workouts.addSet': {
    signature(value) {
      const record = fields(value, ['workoutId', 'exerciseId', 'reps', 'weightKg', 'rpe'], ['loadConvention', 'implementCount']);
      identifier(record.workoutId, 'workoutId');
      identifier(record.exerciseId, 'exerciseId');
      repetitions(record.reps);
      finiteNumber(record.weightKg, 'weightKg', 0);
      nullable(record, 'rpe', effort);
      // Released legacy signatures have no load pair.
      loadPair(record, false);
    },
    result: setResult,
  },
  'workouts.updateSet': {
    signature(value) {
      const optional = ['exerciseId', 'reps', 'weightKg', 'rpe', 'loadConvention', 'implementCount'];
      const record = fields(value, ['workoutId', 'setId'], optional);
      identifier(record.workoutId, 'workoutId');
      identifier(record.setId, 'setId');
      changed(record, optional);
      present(record, 'exerciseId', (id) => identifier(id, 'exerciseId'));
      present(record, 'reps', repetitions);
      present(record, 'weightKg', (weight) => finiteNumber(weight, 'weightKg', 0));
      nullable(record, 'rpe', effort);
      loadPair(record, true);
    },
    result: setResult,
  },
  'workouts.deleteSet': {
    signature(value) {
      const record = fields(value, ['workoutId', 'setId'], []);
      identifier(record.workoutId, 'workoutId');
      identifier(record.setId, 'setId');
    },
    result: voidResult,
  },
  'notes.create': {
    signature(value) {
      const row = fields(value, ['date', 'text', 'kind'], []);
      calendarDate(row.date, 'date'); noteText(row.text); noteKind(row.kind);
    }, result: noteResult,
  },
  'notes.update': {
    signature(value) {
      const row = fields(value, ['noteId', 'expectedRevision'], ['date', 'text', 'kind']);
      noteId(row.noteId); noteRevision(row.expectedRevision); changed(row, ['date', 'text', 'kind']);
      present(row, 'date', v => calendarDate(v, 'date')); present(row, 'text', noteText); present(row, 'kind', noteKind);
    }, result: noteResult,
  },
  'notes.delete': {
    signature(value) {
      const row = fields(value, ['noteId', 'expectedRevision'], []);
      noteId(row.noteId); noteRevision(row.expectedRevision);
    }, result: noteDeleteResult,
  },
  'notes.confirmFields': {
    signature(value) {
      const row = fields(value, ['noteId', 'expectedRevision', 'fields'], []);
      noteId(row.noteId); noteRevision(row.expectedRevision);
      if (canonicalJson(readReleasedNoteFields(row.fields)) !== canonicalJson(row.fields)) {
        invalid('fields', 'The confirmation fields are not normalized.');
      }
    }, result: noteFieldConfirmationResult,
  },
  'archive.restore': {
    signature(value) {
      const record = fields(value, ['digest', 'expectedHistoryRevision'], []);
      archiveDigest(record.digest, 'digest');
      historyRevision(record.expectedHistoryRevision, 'expectedHistoryRevision');
    },
    result: restoreResult,
  },
});

function parseJson(value: string, field: string): unknown {
  try { return JSON.parse(value) as unknown; }
  catch { return invalid(field, field + ' must contain JSON text.'); }
}

/** Check one stored receipt. The parsed values only serve the check; the stored strings stay unchanged. */
export function checkReceiptContent(operation: string, inputSignature: string, resultJson: string): void {
  const known = Object.hasOwn(OPERATIONS, operation) ? OPERATIONS[operation] : undefined;
  if (!known) invalid('operation', 'The receipt operation is not supported: ' + operation + '.');
  const signature = parseJson(inputSignature, 'inputSignature');
  if (signature === null || typeof signature !== 'object' || Array.isArray(signature)) {
    invalid('inputSignature', 'The receipt signature must be an object.');
  }
  known.signature(signature);
  if (canonicalJson(signature) !== inputSignature) invalid('inputSignature', 'The receipt signature is not in canonical form.');
  const result = known.result.parse(parseJson(resultJson, 'resultJson'));
  const input = signature as Fields;
  if (operation === 'notes.confirmFields') {
    const confirmation = noteFieldConfirmationResult.parse(result);
    if (confirmation.source.noteId !== input.noteId || confirmation.source.revision !== (input.expectedRevision as number) + 1
      || canonicalJson(confirmation.fields) !== canonicalJson(input.fields)) invalid('result', 'The confirmation differs from its command.');
  }
  if (operation === 'notes.create' || operation === 'notes.update') {
    const note = noteResult.parse(result);
    if (operation === 'notes.create' && note.revision !== 1) invalid('result', 'A create snapshot starts at revision 1.');
    if (operation === 'notes.update' && (note.id !== input.noteId || note.revision !== (input.expectedRevision as number) + 1)) {
      invalid('result', 'The edited snapshot differs from its command.');
    }
    for (const key of ['date', 'text', 'kind'] as const) {
      if (Object.hasOwn(input, key) && input[key] !== note[key]) invalid('result', 'The note snapshot differs from its command.');
    }
  }
}
