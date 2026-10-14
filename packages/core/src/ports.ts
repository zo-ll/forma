import type { NotesReader, NotesWriter } from './notes/ports.js';
import type { ArchiveCounts, Exercise, ListWorkoutsInput, Workout, SplitDay } from './types.js';
import type { HistoryStorePage, HistoryStoreQuery } from './workouts/history-types.js';

export interface Clock {
  nowUtc(): string;
}

export interface IdGenerator {
  next(): string;
}

/** The receipt format covers the normalized input signature and original result. */
export interface RequestReceipt {
  readonly requestId: string;
  readonly operation: string;
  readonly inputSignature: string;
  readonly resultJson: string;
  readonly formatVersion: 1;
}

export interface RequestReader {
  getRequestReceipt(requestId: string): Promise<RequestReceipt | null>;
}

export interface RequestWriter extends RequestReader {
  saveRequestReceipt(receipt: RequestReceipt): Promise<void>;
}

export interface WorkoutReader extends NotesReader {
  listExercises(): Promise<readonly Exercise[]>;
  getExercise(exerciseId: string): Promise<Exercise | null>;
  findExerciseByAlias(normalizedAlias: string): Promise<Exercise | null>;
  listSplitDays(): Promise<readonly SplitDay[]>;
  getSplitDay(splitDayId: string): Promise<SplitDay | null>;
  getWorkout(workoutId: string): Promise<Workout | null>;
  getInProgressWorkout(): Promise<Workout | null>;
  listWorkouts(input: ListWorkoutsInput): Promise<readonly Workout[]>;
  getHistoryRevision(): Promise<number>;
  listHistoryWorkouts(input: HistoryStoreQuery): Promise<HistoryStorePage>;
  /** Every receipt in requestId order, with its stored strings unchanged. */
  listRequestReceipts(): Promise<readonly RequestReceipt[]>;
  countArchiveRecords(): Promise<ArchiveCounts>;
}

/** The primary records and receipts that an archive restore writes. */
export interface ArchiveRecords {
  readonly workouts: readonly Workout[];
  readonly receipts: readonly RequestReceipt[];
}

export interface WorkoutWriter extends WorkoutReader, NotesWriter {
  saveWorkout(workout: Workout): Promise<void>;
  deleteWorkout(workoutId: string): Promise<void>;
  /** Delete all workouts, sets, and receipts, insert these rows exactly, and advance the history revision. */
  replaceArchiveRecords(records: ArchiveRecords): Promise<void>;
}

/** Each callback uses one coherent read view or one atomic write transaction. */
export interface WorkoutStore {
  read<T>(run: (reader: WorkoutReader) => Promise<T>): Promise<T>;
  write<T>(run: (writer: WorkoutWriter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface FormaDependencies {
  readonly store: WorkoutStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
