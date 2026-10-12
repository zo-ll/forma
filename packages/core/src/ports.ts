import type { Exercise, ListWorkoutsInput, Workout, SplitDay } from './types.js';

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

export interface WorkoutReader extends RequestReader {
  listExercises(): Promise<readonly Exercise[]>;
  getExercise(exerciseId: string): Promise<Exercise | null>;
  findExerciseByAlias(normalizedAlias: string): Promise<Exercise | null>;
  listSplitDays(): Promise<readonly SplitDay[]>;
  getSplitDay(splitDayId: string): Promise<SplitDay | null>;
  getWorkout(workoutId: string): Promise<Workout | null>;
  listWorkouts(input: ListWorkoutsInput): Promise<readonly Workout[]>;
}

export interface WorkoutWriter extends WorkoutReader, RequestWriter {
  saveWorkout(workout: Workout): Promise<void>;
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
