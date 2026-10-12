import { FormaError } from '../errors.js';
import { withRequest } from '../requests/service.js';
import { setResult, voidResult, workoutResult } from './results.js';
import type { Clock, IdGenerator, WorkoutReader, WorkoutStore } from '../ports.js';
import type { ListWorkoutsInput, Workout, WorkoutApi, WorkoutSet } from '../types.js';
import {
  calendarDate, effort, finiteNumber, identifier, invalid,
  objectInput, repetitions, text, utcTimestamp,
} from '../validation.js';

async function requiredWorkout(reader: WorkoutReader, workoutId: string): Promise<Workout> {
  const workout = await reader.getWorkout(workoutId);
  if (!workout) throw new FormaError('NOT_FOUND', 'The workout does not exist.', { field: 'workoutId' });
  return workout;
}

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
    async create(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'date', 'splitDayId', 'notes', 'durationMin']);
      const requestId = identifier(input.requestId, 'requestId');
      const date = calendarDate(input.date, 'date');
      const splitDayId = input.splitDayId === undefined ? null : identifier(input.splitDayId, 'splitDayId');
      const notes = input.notes === undefined ? '' : text(input.notes, 'notes');
      const durationMin = input.durationMin === undefined ? null : finiteNumber(input.durationMin, 'durationMin', 0);
      return withRequest(store, requestId, 'workouts.create', { date, splitDayId, notes, durationMin }, workoutResult, async (writer) => {
        if (splitDayId !== null && !(await writer.getSplitDay(splitDayId))) {
          throw new FormaError('NOT_FOUND', 'The split day does not exist.', { field: 'splitDayId' });
        }
        const id = identifier(ids.next(), 'id');
        if (await writer.getWorkout(id)) {
          throw new FormaError('CONFLICT', 'The generated workout ID already exists.', { field: 'id' });
        }
        const timestamp = utcTimestamp(clock.nowUtc());
        const workout: Workout = {
          id, date, splitDayId, notes, durationMin, createdAt: timestamp, updatedAt: timestamp, sets: [],
        };
        await writer.saveWorkout(workout);
        return workout;
      });
    },

    async addSet(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'workoutId', 'exerciseId', 'reps', 'weightKg', 'rpe']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      const exerciseId = identifier(input.exerciseId, 'exerciseId');
      const reps = repetitions(input.reps);
      const weightKg = finiteNumber(input.weightKg, 'weightKg', 0);
      const rpe = input.rpe === undefined ? null : effort(input.rpe);
      return withRequest(store, requestId, 'workouts.addSet', { workoutId, exerciseId, reps, weightKg, rpe }, setResult, async (writer) => {
        const workout = await requiredWorkout(writer, workoutId);
        await requiredExercise(writer, exerciseId);
        const id = identifier(ids.next(), 'id');
        if (workout.sets.some((set) => set.id === id)) {
          throw new FormaError('CONFLICT', 'The generated set ID already exists.', { field: 'id' });
        }
        const set: WorkoutSet = {
          id, exerciseId, reps, weightKg, rpe,
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
      objectInput(input, ['requestId', 'workoutId', 'setId', 'exerciseId', 'reps', 'weightKg', 'rpe']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      const setId = identifier(input.setId, 'setId');
      const exerciseId = input.exerciseId === undefined ? undefined : identifier(input.exerciseId, 'exerciseId');
      const reps = input.reps === undefined ? undefined : repetitions(input.reps);
      const weightKg = input.weightKg === undefined ? undefined : finiteNumber(input.weightKg, 'weightKg', 0);
      const rpe = input.rpe === undefined ? undefined : input.rpe === null ? null : effort(input.rpe);
      if ([exerciseId, reps, weightKg, rpe].every((value) => value === undefined)) {
        invalid('input', 'A set update must contain at least one changed field.');
      }
      return withRequest(store, requestId, 'workouts.updateSet', { workoutId, setId, exerciseId, reps, weightKg, rpe }, setResult, async (writer) => {
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
