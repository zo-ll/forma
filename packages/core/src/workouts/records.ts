import { FormaError } from '../errors.js';
import type { Clock, IdGenerator, WorkoutStore } from '../ports.js';
import type { CreateWorkoutInput, Workout, WorkoutApi, WorkoutCommandInput, WorkoutStatus } from '../types.js';
import { withRequest } from '../requests/service.js';
import { calendarDate, finiteNumber, identifier, invalid, objectInput, text, utcTimestamp } from '../validation.js';
import { requiredWorkout, requireInProgress } from './required.js';
import { sessionWorkoutResult, voidResult, workoutResult } from './results.js';

type RecordsApi = Pick<WorkoutApi, 'create' | 'start' | 'inProgress' | 'resume' | 'finish' | 'update' | 'delete' | 'discard'>;

export function createWorkoutRecordsApi(
  store: WorkoutStore, clock: Clock, ids: IdGenerator, ensureOpen: () => void,
): RecordsApi {
  async function create(input: CreateWorkoutInput, status: WorkoutStatus): Promise<Workout> {
    ensureOpen();
    objectInput(input, ['requestId', 'date', 'splitDayId', 'notes', 'durationMin']);
    const requestId = identifier(input.requestId, 'requestId');
    const date = calendarDate(input.date, 'date');
    const splitDayId = input.splitDayId === undefined ? null : identifier(input.splitDayId, 'splitDayId');
    const notes = input.notes === undefined ? '' : text(input.notes, 'notes');
    const durationMin = input.durationMin === undefined ? null : finiteNumber(input.durationMin, 'durationMin', 0);
    const operation = status === 'in-progress' ? 'workouts.start' : 'workouts.create';
    const result = status === 'in-progress' ? sessionWorkoutResult : workoutResult;
    return withRequest(store, requestId, operation, { date, splitDayId, notes, durationMin }, result, async (writer) => {
      if (splitDayId !== null && !(await writer.getSplitDay(splitDayId))) {
        throw new FormaError('NOT_FOUND', 'The split day does not exist.', { field: 'splitDayId' });
      }
      if (status === 'in-progress' && await writer.getInProgressWorkout()) {
        throw new FormaError('CONFLICT', 'Finish or discard the current workout before starting another.', { field: 'status' });
      }
      const id = identifier(ids.next(), 'id');
      if (await writer.getWorkout(id)) {
        throw new FormaError('CONFLICT', 'The generated workout ID already exists.', { field: 'id' });
      }
      const timestamp = utcTimestamp(clock.nowUtc());
      const workout: Workout = { id, date, splitDayId, notes, durationMin,
        createdAt: timestamp, updatedAt: timestamp, sets: [], status, finishedAt: null };
      await writer.saveWorkout(workout);
      return workout;
    });
  }

  async function remove(input: WorkoutCommandInput, discardOnly: boolean): Promise<void> {
    ensureOpen();
    objectInput(input, ['requestId', 'workoutId']);
    const requestId = identifier(input.requestId, 'requestId');
    const workoutId = identifier(input.workoutId, 'workoutId');
    return withRequest(store, requestId, discardOnly ? 'workouts.discard' : 'workouts.delete',
      { workoutId }, voidResult, async (writer) => {
        const workout = await requiredWorkout(writer, workoutId);
        if (discardOnly) requireInProgress(workout);
        await writer.deleteWorkout(workoutId);
      });
  }

  return {
    create: (input) => create(input, 'finished'),
    start: (input) => create(input, 'in-progress'),
    delete: (input) => remove(input, false),
    discard: (input) => remove(input, true),

    async inProgress() {
      ensureOpen();
      return store.read((reader) => reader.getInProgressWorkout());
    },

    async resume(workoutId) {
      ensureOpen();
      const id = identifier(workoutId, 'workoutId');
      return store.read(async (reader) => {
        const workout = await requiredWorkout(reader, id);
        requireInProgress(workout);
        return workout;
      });
    },

    async finish(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'workoutId']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      return withRequest(store, requestId, 'workouts.finish', { workoutId }, sessionWorkoutResult, async (writer) => {
        const workout = await requiredWorkout(writer, workoutId);
        if (workout.status === 'finished') return workout;
        const timestamp = utcTimestamp(clock.nowUtc());
        const finished: Workout = { ...workout, status: 'finished', finishedAt: timestamp, updatedAt: timestamp };
        await writer.saveWorkout(finished);
        return finished;
      });
    },

    async update(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'workoutId', 'date', 'splitDayId', 'notes', 'durationMin']);
      const requestId = identifier(input.requestId, 'requestId');
      const workoutId = identifier(input.workoutId, 'workoutId');
      const date = input.date === undefined ? undefined : calendarDate(input.date, 'date');
      const splitDayId = input.splitDayId === undefined ? undefined
        : input.splitDayId === null ? null : identifier(input.splitDayId, 'splitDayId');
      const notes = input.notes === undefined ? undefined : text(input.notes, 'notes');
      const durationMin = input.durationMin === undefined ? undefined
        : input.durationMin === null ? null : finiteNumber(input.durationMin, 'durationMin', 0);
      if ([date, splitDayId, notes, durationMin].every((value) => value === undefined)) {
        invalid('input', 'A workout update must contain at least one changed field.');
      }
      return withRequest(store, requestId, 'workouts.update', { workoutId, date, splitDayId, notes, durationMin },
        sessionWorkoutResult, async (writer) => {
          const workout = await requiredWorkout(writer, workoutId);
          if (splitDayId !== undefined && splitDayId !== null && !(await writer.getSplitDay(splitDayId))) {
            throw new FormaError('NOT_FOUND', 'The split day does not exist.', { field: 'splitDayId' });
          }
          const updated: Workout = {
            ...workout, date: date ?? workout.date, notes: notes ?? workout.notes,
            splitDayId: splitDayId === undefined ? workout.splitDayId : splitDayId,
            durationMin: durationMin === undefined ? workout.durationMin : durationMin,
            updatedAt: utcTimestamp(clock.nowUtc()),
          };
          await writer.saveWorkout(updated);
          return updated;
        });
    },
  };
}
