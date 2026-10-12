import { FormaError } from '../errors.js';
import type { WorkoutReader, WorkoutStore } from '../ports.js';
import type { Workout } from '../types.js';
import { calendarDate, finiteNumber, identifier, invalid, objectInput, repetitions } from '../validation.js';
import { calculateSetLoad } from './loads.js';
import { historyCursor, parseHistoryCursor } from './history-cursor.js';
import { compareHistoryPositions } from './history-order.js';
import { WORKOUT_HISTORY_LIMITS as limits } from './history-limits.js';
import type {
  HistoryFilter, HistoryPosition, LoadStatisticsGroup, SetSource, WorkoutHistoryApi,
  WorkoutHistoryInput, WorkoutSource, WorkoutStatistics,
} from './history-types.js';

function filterInput(input: WorkoutHistoryInput): HistoryFilter {
  const filter: HistoryFilter = {
    dateFrom: input.dateFrom === undefined ? null : calendarDate(input.dateFrom, 'dateFrom'),
    dateTo: input.dateTo === undefined ? null : calendarDate(input.dateTo, 'dateTo'),
    exerciseId: input.exerciseId === undefined ? null : identifier(input.exerciseId, 'exerciseId'),
    status: input.status === undefined ? 'finished' : input.status,
  };
  if (!['finished', 'in-progress', 'all'].includes(filter.status)) invalid('status', 'Invalid history status filter.');
  if (filter.dateFrom !== null && filter.dateTo !== null && filter.dateFrom > filter.dateTo) {
    invalid('dateTo', 'The end date must not precede the start date.');
  }
  return filter;
}

function pageLimit(value: unknown): number {
  if (value === undefined) return limits.defaultPageSize;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limits.maxPageSize) {
    invalid('limit', 'History page size must be a safe integer from 1 to 100.');
  }
  return value;
}

async function exerciseExists(reader: WorkoutReader, exerciseId: string | null): Promise<void> {
  if (exerciseId !== null && !(await reader.getExercise(exerciseId))) {
    throw new FormaError('NOT_FOUND', 'The exercise does not exist.', { field: 'exerciseId' });
  }
}

async function revisionFor(reader: WorkoutReader): Promise<number> {
  const revision = await reader.getHistoryRevision();
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new FormaError('STORAGE_FAILURE', 'The history revision is invalid.');
  }
  return revision;
}

function position(workout: Workout): HistoryPosition {
  return { date: workout.date, createdAt: workout.createdAt, id: workout.id };
}

function previousDate(value: string): string | null {
  if (value === '0001-01-01') return null;
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

interface Group {
  convention: 'entered' | 'combined';
  volume: number;
  sources: SetSource[];
  bestLoad: number;
  bestLoadSources: SetSource[];
  reps: Map<number, { value: number; sources: SetSource[] }>;
}

function source(workout: Workout, revision: number): WorkoutSource {
  return { module: 'workouts', workoutId: workout.id, date: workout.date,
    workoutUpdatedAt: workout.updatedAt, historyRevision: revision };
}

export function createWorkoutHistoryApi(store: WorkoutStore, ensureOpen: () => void): WorkoutHistoryApi {
  return {
    async history(input = {}) {
      ensureOpen();
      objectInput(input, ['dateFrom', 'dateTo', 'exerciseId', 'status', 'limit', 'cursor']);
      const filter = filterInput(input);
      const limit = pageLimit(input.limit);
      const cursor = input.cursor === undefined ? null : parseHistoryCursor(input.cursor, filter);
      return store.read(async (reader) => {
        const revision = await revisionFor(reader);
        if (cursor !== null && cursor.revision !== revision) {
          throw new FormaError('CONFLICT', 'Records changed. Restart the history query.', { field: 'cursor' });
        }
        await exerciseExists(reader, filter.exerciseId);
        if (cursor !== null) {
          const anchor = await reader.getWorkout(cursor.after.id);
          if (!anchor || compareHistoryPositions(position(anchor), cursor.after) !== 0
            || (filter.status !== 'all' && anchor.status !== filter.status)
            || (filter.dateFrom !== null && anchor.date < filter.dateFrom)
            || (filter.dateTo !== null && anchor.date > filter.dateTo)
            || (filter.exerciseId !== null && !anchor.sets.some((set) => set.exerciseId === filter.exerciseId))) {
            invalid('cursor', 'The cursor anchor does not match this query.');
          }
        }
        const page = await reader.listHistoryWorkouts({ filter, after: cursor?.after ?? null, limit, sets: 'all' });
        const last = page.items.at(-1);
        if (page.hasMore && !last) throw new FormaError('STORAGE_FAILURE', 'The history adapter returned an empty continuation page.');
        return { items: page.items, filter, revision,
          nextCursor: page.hasMore && last ? historyCursor(filter, revision, position(last)) : null };
      });
    },

    async previousSets(input) {
      ensureOpen();
      objectInput(input, ['exerciseId', 'beforeDate']);
      const exerciseId = identifier(input.exerciseId, 'exerciseId');
      const beforeDate = calendarDate(input.beforeDate, 'beforeDate');
      const dateTo = previousDate(beforeDate);
      return store.read(async (reader) => {
        await exerciseExists(reader, exerciseId);
        const revision = await revisionFor(reader);
        const page = dateTo === null ? { items: [] } : await reader.listHistoryWorkouts({
          filter: { dateFrom: null, dateTo, exerciseId, status: 'finished' }, after: null, limit: 1, sets: 'matching',
        });
        const workout = page.items[0];
        return { exerciseId, beforeDate, revision,
          workout: workout ? { id: workout.id, date: workout.date, updatedAt: workout.updatedAt } : null,
          sets: workout ? workout.sets.filter((set) => set.exerciseId === exerciseId) : [] };
      });
    },

    async statistics(input) {
      ensureOpen();
      objectInput(input, ['exerciseId', 'dateFrom', 'dateTo']);
      const exerciseId = identifier(input.exerciseId, 'exerciseId');
      const dateFrom = calendarDate(input.dateFrom, 'dateFrom');
      const dateTo = calendarDate(input.dateTo, 'dateTo');
      const filter = filterInput({ exerciseId, dateFrom, dateTo });
      return store.read(async (reader) => {
        await exerciseExists(reader, exerciseId);
        const revision = await revisionFor(reader);
        const workouts: WorkoutSource[] = [];
        const sets: SetSource[] = [];
        const groups = new Map<'entered' | 'combined', Group>();
        const excluded = { unknown: [] as SetSource[], 'body-weight': [] as SetSource[] };
        let after: HistoryPosition | null = null;
        for (;;) {
          const page = await reader.listHistoryWorkouts({ filter, after, limit: limits.maxPageSize, sets: 'matching' });
          const records = page.items;
          if (records.length === 0) {
            if (page.hasMore) throw new FormaError('STORAGE_FAILURE', 'The history adapter returned an empty continuation page.');
            break;
          }
          for (const workout of records) {
            const workoutSource = source(workout, revision);
            workouts.push(workoutSource);
            if (workouts.length > limits.maxStatisticsWorkouts) invalid('dateRange', 'Narrow the date range to at most 5000 matching workouts.');
            for (const set of workout.sets) {
              if (set.exerciseId !== exerciseId) continue;
              const setSource: SetSource = { ...workoutSource, setId: set.id };
              sets.push(setSource);
              if (sets.length > limits.maxStatisticsSets) invalid('dateRange', 'Narrow the date range to at most 10000 matching sets.');
              if (set.loadConvention === 'unknown' || set.loadConvention === 'body-weight') {
                excluded[set.loadConvention].push(setSource);
                continue;
              }
              const load = calculateSetLoad(set);
              const reps = repetitions(set.reps);
              const volume = finiteNumber(load.value * reps, 'volume', 0);
              let group = groups.get(load.convention);
              if (!group) {
                group = { convention: load.convention, volume: 0, sources: [],
                  bestLoad: load.value, bestLoadSources: [], reps: new Map() };
                groups.set(load.convention, group);
              }
              group.volume = finiteNumber(group.volume + volume, 'volume', 0);
              group.sources.push(setSource);
              if (load.value > group.bestLoad) { group.bestLoad = load.value; group.bestLoadSources = []; }
              if (load.value === group.bestLoad) group.bestLoadSources.push(setSource);
              const best = group.reps.get(load.value);
              if (!best || reps > best.value) group.reps.set(load.value, { value: reps, sources: [setSource] });
              else if (reps === best.value) best.sources.push(setSource);
            }
          }
          const last = records.at(-1)!;
          const next = position(last);
          if (after !== null && compareHistoryPositions(next, after) <= 0) {
            throw new FormaError('STORAGE_FAILURE', 'The history adapter did not advance its page.');
          }
          after = next;
          if (!page.hasMore) break;
        }
        const resultGroups: LoadStatisticsGroup[] = [...groups.values()]
          .sort((a, b) => a.convention < b.convention ? -1 : a.convention > b.convention ? 1 : 0)
          .map((group) => ({ convention: group.convention,
            volume: { value: group.volume, unit: 'kg·rep', sources: group.sources },
            bestLoad: { value: group.bestLoad, unit: 'kg', sources: group.bestLoadSources },
            bestReps: [...group.reps.entries()].sort(([a], [b]) => b - a)
              .map(([loadKg, fact]) => ({ loadKg, value: fact.value, unit: 'reps', sources: fact.sources })),
          }));
        const result: WorkoutStatistics = { exerciseId, dateContext: { dateFrom, dateTo, semantics: 'saved-workout-date' }, revision,
          workoutCount: { value: workouts.length, unit: 'workouts', sources: workouts },
          setCount: { value: sets.length, unit: 'sets', sources: sets }, groups: resultGroups,
          excluded: (['unknown', 'body-weight'] as const).map((reason) => ({ reason,
            count: { value: excluded[reason].length, unit: 'sets', sources: excluded[reason] } })),
        };
        return result;
      });
    },
  };
}
