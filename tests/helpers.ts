import {
  createFormaService, DEFAULT_EXERCISES, DEFAULT_SPLIT_DAYS,
  FormaError, normalizeExerciseAlias, compareNotePositions, compareHistoryPositions, WORKOUT_HISTORY_LIMITS,
} from '@forma/core';
import type { FormaService, RequestReceipt, Workout, WorkoutReader, WorkoutStore, WorkoutWriter } from '@forma/core';
import { MemoryNotesStore } from './notes-memory.js';
import type { NotesWriter } from '@forma/core';
import type { TestContext } from 'node:test';

export class MemoryWorkoutStore implements WorkoutStore {
  readonly notesStore = new MemoryNotesStore();
  readonly workouts = new Map<string, Workout>();
  readonly receipts = new Map<string, RequestReceipt>();
  writes = 0;
  saves = 0;
  closeCalls = 0;
  replacements = 0;
  historyRevision = 0;
  archiveRevision = 0;
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;
  private closePromise: Promise<void> | undefined;

  private view(notes: NotesWriter): WorkoutWriter {
    const writer: WorkoutWriter = {
      ...notes,
      getArchiveRevision: async () => this.archiveRevision,
      readArchiveNotes: async () => structuredClone({ records: [...this.notesStore.state.notes.values()].sort(compareNotePositions),
        confirmations: [...this.notesStore.state.confirmations.values()].sort((a,b) => a.source.noteId < b.source.noteId ? -1 : 1),
        reservedIds: [...this.notesStore.state.reservedIds].sort() }),
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
      getInProgressWorkout: async () => structuredClone([...this.workouts.values()].find((workout) => workout.status === 'in-progress') ?? null),
      deleteWorkout: async (id) => { if (this.workouts.delete(id)) this.historyRevision++; },
      getHistoryRevision: async () => this.historyRevision,
      listHistoryWorkouts: async ({ filter, after, limit, sets }) => {
        const candidates = [...this.workouts.values()]
        .filter((workout) => (filter.dateFrom === null || workout.date >= filter.dateFrom)
          && (filter.dateTo === null || workout.date <= filter.dateTo)
          && (filter.status === 'all' || workout.status === filter.status)
          && (filter.exerciseId === null || workout.sets.some((set) => set.exerciseId === filter.exerciseId))
          && (after === null || compareHistoryPositions(workout, after) > 0))
        .sort(compareHistoryPositions).slice(0, limit + 1);
        const result = candidates.slice(0, limit)
        .map((workout) => ({ ...workout, sets: sets === 'matching'
          ? workout.sets.filter((set) => set.exerciseId === filter.exerciseId) : workout.sets }));
        if (result.reduce((sum, workout) => sum + workout.sets.length, 0) > WORKOUT_HISTORY_LIMITS.maxPageSets) {
          throw new FormaError('INVALID_INPUT', 'The query exceeds the set page budget.', { field: sets === 'matching' ? 'dateRange' : 'limit' });
        }
        return { items: structuredClone(result), hasMore: candidates.length > limit };
      },
      listWorkouts: async (input) => structuredClone([...this.workouts.values()]
        .filter((workout) => (input.dateFrom === undefined || workout.date >= input.dateFrom)
          && (input.dateTo === undefined || workout.date <= input.dateTo))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))),
      listRequestReceipts: async () => structuredClone([...this.receipts.values()]
        .sort((a, b) => a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0)),
      countArchiveRecords: async () => {
        const workouts = [...this.workouts.values()];
        return {
          notes: this.notesStore.state.notes.size, noteConfirmations: this.notesStore.state.confirmations.size,
          reservedNoteIds: this.notesStore.state.reservedIds.size,
          workouts: workouts.length, sets: workouts.reduce((sum, workout) => sum + workout.sets.length, 0),
          receipts: this.receipts.size, inProgress: workouts.filter((workout) => workout.status === 'in-progress').length,
        };
      },
      replaceArchiveRecords: async ({ workouts, receipts, notes }) => {
        this.notesStore.state.notes = new Map((notes?.records ?? []).map(note => [note.id, structuredClone(note)]));
        this.notesStore.state.confirmations = new Map((notes?.confirmations ?? []).map(value => [value.source.noteId, structuredClone(value)]));
        this.notesStore.state.reservedIds = new Set(notes?.reservedIds ?? []);
        this.notesStore.state.revision++;
        this.replacements++;
        this.workouts.clear();
        this.receipts.clear();
        for (const workout of workouts) this.workouts.set(workout.id, structuredClone(workout));
        for (const receipt of receipts) this.receipts.set(receipt.requestId, structuredClone(receipt));
        this.historyRevision++;
      },
      saveWorkout: async (workout) => {
        this.saves++;
        this.historyRevision++;
        this.workouts.set(workout.id, structuredClone(workout));
      },
    };
    const mutations = new Set(['saveWorkout', 'deleteWorkout', 'saveNote', 'deleteNote', 'saveNoteConfirmation',
      'clearNoteConfirmation', 'saveRequestReceipt', 'replaceArchiveRecords']);
    return Object.fromEntries(Object.entries(writer).map(([name, fn]) => [name, async (...args: unknown[]) => {
      const result = await (fn as (...args: unknown[]) => Promise<unknown>)(...args);
      if (mutations.has(name)) this.archiveRevision++;
      return result;
    }])) as unknown as WorkoutWriter;
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new FormaError('SERVICE_CLOSED', 'The memory store is closed.'));
    const pending = this.tail.then(run);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  read<T>(run: (reader: WorkoutReader) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const notes = this.notesStore.view(false);
      try { return await run(this.view(notes.writer)); }
      finally { notes.expire(); }
    });
  }

  write<T>(run: (writer: WorkoutWriter) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.writes++;
      const beforeNotes = structuredClone(this.notesStore.state);
      const notes = this.notesStore.view(true);
      const before = structuredClone(this.workouts);
      const beforeReceipts = structuredClone(this.receipts);
      const beforeRevision = this.historyRevision;
      const beforeArchiveRevision = this.archiveRevision;
      try {
        return await run(this.view(notes.writer));
      } catch (cause) {
        Object.assign(this.notesStore.state, beforeNotes);
        this.historyRevision = beforeRevision;
        this.archiveRevision = beforeArchiveRevision;
        this.workouts.clear();
        for (const [id, workout] of before) this.workouts.set(id, workout);
        this.receipts.clear();
        for (const [id, receipt] of beforeReceipts) this.receipts.set(id, receipt);
        throw cause;
      } finally { notes.expire(); }
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

let request = 0;
export function nextRequestId(): string { return 'test-request-' + ++request; }

export interface Fixture {
  readonly service: FormaService;
}

export function memoryFixture(t: TestContext, ids?: readonly string[]): Fixture {
  const store = new MemoryWorkoutStore();
  let next = 0;
  const service = createFormaService({
    store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => { const id = ids?.[next]; next++; return id ?? 'id-' + next; } },
  });
  t.after(() => service.close());
  return { service };
}

export function errorCode(code: FormaError['code'], field?: string): (error: unknown) => boolean {
  return (error) => error instanceof FormaError && error.code === code
    && (field === undefined || error.field === field);
}
