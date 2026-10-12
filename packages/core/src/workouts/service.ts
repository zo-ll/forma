import { FormaError } from '../errors.js';
import { withRequest } from '../requests/service.js';
import { setResult, voidResult } from './results.js';
import { validateSetLoadDetails } from './loads.js';
import type { Clock, IdGenerator, WorkoutReader, WorkoutStore } from '../ports.js';
import type { ListWorkoutsInput, Workout, WorkoutApi, WorkoutSet } from '../types.js';
import {
  calendarDate, effort, finiteNumber, identifier, invalid,
  objectInput, repetitions, utcTimestamp,
} from '../validation.js';
import { requiredWorkout } from './required.js';
import { createWorkoutRecordsApi } from './records.js';

async function requiredExercise(reader: WorkoutReader, exerciseId: string): Promise<void> {
  if (!(await reader.getExercise(exerciseId))) {
    throw new FormaError('NOT_FOUND', 'The exercise does not exist.', { field: 'exerciseId' });
  }
}

export function createWorkoutApi(
  store: WorkoutStore,
  clock: Clock,
  ids: IdGenerator,
  ensureOpen: () => void,
): WorkoutApi {
  return {
    ...createWorkoutRecordsApi(store, clock, ids, ensureOpen),

    async addSet(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'workoutId', 'exerciseId', 'reps', 'weightKg', 'rpe', 'loadConvention', 'implementCount']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      const exerciseId = identifier(input.exerciseId, 'exerciseId');
      const reps = repetitions(input.reps);
      const weightKg = finiteNumber(input.weightKg, 'weightKg', 0);
      const rpe = input.rpe === undefined ? null : effort(input.rpe);
      const details = validateSetLoadDetails(
        input.loadConvention === undefined ? 'unknown' : input.loadConvention,
        input.implementCount === undefined ? null : input.implementCount,
      );
      // Unknown is the legacy default. Preserve released input signatures for old clients.
      const signature = { workoutId, exerciseId, reps, weightKg, rpe,
        ...(details.loadConvention === 'unknown' ? {} : details) };
      return withRequest(store, requestId, 'workouts.addSet', signature, setResult, async (writer) => {
        const workout = await requiredWorkout(writer, workoutId);
        await requiredExercise(writer, exerciseId);
        const id = identifier(ids.next(), 'id');
        if (workout.sets.some((set) => set.id === id)) {
          throw new FormaError('CONFLICT', 'The generated set ID already exists.', { field: 'id' });
        }
        const set: WorkoutSet = {
          id, exerciseId, reps, weightKg, rpe, ...details,
          position: workout.sets.length,
        };
        const updated: Workout = {
          ...workout, updatedAt: utcTimestamp(clock.nowUtc()), sets: [...workout.sets, set],
        };
        await writer.saveWorkout(updated);
        return set;
      });
    },

    async updateSet(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'workoutId', 'setId', 'exerciseId', 'reps', 'weightKg', 'rpe', 'loadConvention', 'implementCount']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      const setId = identifier(input.setId, 'setId');
      const exerciseId = input.exerciseId === undefined ? undefined : identifier(input.exerciseId, 'exerciseId');
      const reps = input.reps === undefined ? undefined : repetitions(input.reps);
      const weightKg = input.weightKg === undefined ? undefined : finiteNumber(input.weightKg, 'weightKg', 0);
      const rpe = input.rpe === undefined ? undefined : input.rpe === null ? null : effort(input.rpe);
      if (input.loadConvention === undefined && input.implementCount !== undefined) {
        invalid('loadConvention', 'A load metadata update requires an explicit convention.');
      }
      const details = input.loadConvention === undefined ? undefined : validateSetLoadDetails(
        input.loadConvention, input.implementCount === undefined ? null : input.implementCount,
      );
      if ([exerciseId, reps, weightKg, rpe, details].every((value) => value === undefined)) {
        invalid('input', 'A set update must contain at least one changed field.');
      }
      return withRequest(store, requestId, 'workouts.updateSet', {
        workoutId, setId, exerciseId, reps, weightKg, rpe, ...details,
      }, setResult, async (writer) => {
        const workout = await requiredWorkout(writer, workoutId);
        const current = workout.sets.find((set) => set.id === setId);
        if (!current) throw new FormaError('NOT_FOUND', 'The set does not exist in this workout.', { field: 'setId' });
        if (exerciseId !== undefined) await requiredExercise(writer, exerciseId);
        const updatedSet: WorkoutSet = {
          ...current,
          exerciseId: exerciseId ?? current.exerciseId,
          reps: reps ?? current.reps,
          weightKg: weightKg ?? current.weightKg,
          rpe: rpe === undefined ? current.rpe : rpe,
          ...details,
        };
        await writer.saveWorkout({
          ...workout, updatedAt: utcTimestamp(clock.nowUtc()),
          sets: workout.sets.map((set) => set.id === setId ? updatedSet : set),
        });
        return updatedSet;
      });
    },

    async deleteSet(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'workoutId', 'setId']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      const setId = identifier(input.setId, 'setId');
      return withRequest(store, requestId, 'workouts.deleteSet', { workoutId, setId }, voidResult, async (writer) => {
        const workout = await requiredWorkout(writer, workoutId);
        if (!workout.sets.some((set) => set.id === setId)) {
          throw new FormaError('NOT_FOUND', 'The set does not exist in this workout.', { field: 'setId' });
        }
        await writer.saveWorkout({
          ...workout, updatedAt: utcTimestamp(clock.nowUtc()),
          sets: workout.sets.filter((set) => set.id !== setId).map((set, position) => ({ ...set, position })),
        });
      });
    },

    async get(workoutId) {
      ensureOpen();
      identifier(workoutId, 'workoutId');
      return store.read((reader) => requiredWorkout(reader, workoutId));
    },

    async list(input = {}) {
      ensureOpen();
      objectInput(input, ['dateFrom', 'dateTo']);
      const filter: ListWorkoutsInput = {
        ...(input.dateFrom === undefined ? {} : { dateFrom: calendarDate(input.dateFrom, 'dateFrom') }),
        ...(input.dateTo === undefined ? {} : { dateTo: calendarDate(input.dateTo, 'dateTo') }),
      };
      if (filter.dateFrom !== undefined && filter.dateTo !== undefined && filter.dateFrom > filter.dateTo) {
        invalid('dateTo', 'The end date must not precede the start date.');
      }
      return store.read((reader) => reader.listWorkouts(filter));
    },
  };
}
