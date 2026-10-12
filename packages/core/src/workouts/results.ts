import type { ResultCodec } from '../requests/service.js';
import type { Workout, WorkoutSet } from '../types.js';
import { calendarDate, effort, finiteNumber, identifier, invalid, objectInput, repetitions, text, utcTimestamp } from '../validation.js';

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  objectInput(value, keys);
  return value as Record<string, unknown>;
}

function parseSet(value: unknown): WorkoutSet {
  const row = record(value, ['id', 'exerciseId', 'reps', 'weightKg', 'rpe', 'position']);
  const position = finiteNumber(row.position, 'position', 0);
  if (!Number.isSafeInteger(position)) invalid('position', 'A set position must be a nonnegative safe integer.');
  return {
    id: identifier(row.id, 'id'), exerciseId: identifier(row.exerciseId, 'exerciseId'),
    reps: repetitions(row.reps), weightKg: finiteNumber(row.weightKg, 'weightKg', 0),
    rpe: row.rpe === null ? null : effort(row.rpe), position,
  };
}

export const setResult: ResultCodec<WorkoutSet> = { parse: parseSet };

export const workoutResult: ResultCodec<Workout> = {
  parse(value) {
    const row = record(value, ['id', 'date', 'splitDayId', 'notes', 'durationMin', 'createdAt', 'updatedAt', 'sets']);
    if (!Array.isArray(row.sets)) invalid('sets', 'The saved sets must be an array.');
    const sets = row.sets.map(parseSet);
    if (sets.some((set, index) => set.position !== index) || new Set(sets.map((set) => set.id)).size !== sets.length) {
      invalid('sets', 'The saved sets must have distinct IDs and consecutive positions.');
    }
    return {
      id: identifier(row.id, 'id'), date: calendarDate(row.date, 'date'),
      splitDayId: row.splitDayId === null ? null : identifier(row.splitDayId, 'splitDayId'),
      notes: text(row.notes, 'notes'), durationMin: row.durationMin === null ? null : finiteNumber(row.durationMin, 'durationMin', 0),
      createdAt: utcTimestamp(row.createdAt), updatedAt: utcTimestamp(row.updatedAt), sets,
    };
  },
};

export const voidResult: ResultCodec<void> = {
  parse(value) {
    if (value !== null) invalid('result', 'The saved deletion result must be null.');
  },
};
