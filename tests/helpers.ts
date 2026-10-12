import {
  createFormaService, DEFAULT_EXERCISES, DEFAULT_SPLIT_DAYS,
  FormaError, normalizeExerciseAlias,
} from '@forma/core';
import type { FormaService, RequestReceipt, Workout, WorkoutReader, WorkoutStore, WorkoutWriter } from '@forma/core';
import type { TestContext } from 'node:test';

export class MemoryWorkoutStore implements WorkoutStore {
  readonly workouts = new Map<string, Workout>();
  readonly receipts = new Map<string, RequestReceipt>();
  writes = 0;
  saves = 0;
  closeCalls = 0;
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;
  private closePromise: Promise<void> | undefined;

  private view(): WorkoutWriter {
    return {
      listExercises: async () => structuredClone(DEFAULT_EXERCISES),
      getExercise: async (id) => structuredClone(DEFAULT_EXERCISES.find((exercise) => exercise.id === id) ?? null),
      findExerciseByAlias: async (alias) => structuredClone(DEFAULT_EXERCISES.find(
        (exercise) => [exercise.name, ...exercise.aliases].some((name) => normalizeExerciseAlias(name) === alias),
      ) ?? null),
      listSplitDays: async () => structuredClone(DEFAULT_SPLIT_DAYS),
      getSplitDay: async (id) => structuredClone(DEFAULT_SPLIT_DAYS.find((splitDay) => splitDay.id === id) ?? null),
      getRequestReceipt: async (id) => structuredClone(this.receipts.get(id) ?? null),
      saveRequestReceipt: async (receipt) => {
        if (this.receipts.has(receipt.requestId)) throw new FormaError('CONFLICT', 'The request receipt already exists.');
        this.receipts.set(receipt.requestId, structuredClone(receipt));
      },
      getWorkout: async (id) => structuredClone(this.workouts.get(id) ?? null),
      listWorkouts: async (input) => structuredClone([...this.workouts.values()]
        .filter((workout) => (input.dateFrom === undefined || workout.date >= input.dateFrom)
          && (input.dateTo === undefined || workout.date <= input.dateTo))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))),
      saveWorkout: async (workout) => {
        this.saves++;
        this.workouts.set(workout.id, structuredClone(workout));
      },
    };
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new FormaError('SERVICE_CLOSED', 'The memory store is closed.'));
    const pending = this.tail.then(run);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  read<T>(run: (reader: WorkoutReader) => Promise<T>): Promise<T> {
    return this.enqueue(() => run(this.view()));
  }

  write<T>(run: (writer: WorkoutWriter) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.writes++;
      const before = structuredClone(this.workouts);
      const beforeReceipts = structuredClone(this.receipts);
      try {
        return await run(this.view());
      } catch (cause) {
        this.workouts.clear();
        for (const [id, workout] of before) this.workouts.set(id, workout);
        this.receipts.clear();
        for (const [id, receipt] of beforeReceipts) this.receipts.set(id, receipt);
        throw cause;
      }
    });
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closeCalls++;
      this.accepting = false;
      this.closePromise = this.tail.then(() => undefined);
    }
    return this.closePromise;
  }
}

export const TEST_TIME = '2026-10-12T09:00:00.000Z';

export interface Fixture {
  readonly service: FormaService;
}

export function memoryFixture(t: TestContext): Fixture {
  const store = new MemoryWorkoutStore();
  let next = 0;
  const service = createFormaService({
    store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'id-' + ++next },
  });
  t.after(() => service.close());
  return { service };
}

export function errorCode(code: FormaError['code'], field?: string): (error: unknown) => boolean {
  return (error) => error instanceof FormaError && error.code === code
    && (field === undefined || error.field === field);
}
