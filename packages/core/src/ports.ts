import type { Exercise, ListWorkoutsInput, Workout, SplitDay } from './types.js';

export interface Clock {
  nowUtc(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface WorkoutReader {
  listExercises(): Promise<readonly Exercise[]>;
  getExercise(exerciseId: string): Promise<Exercise | null>;
  findExerciseByAlias(normalizedAlias: string): Promise<Exercise | null>;
  listSplitDays(): Promise<readonly SplitDay[]>;
  getSplitDay(splitDayId: string): Promise<SplitDay | null>;
  getWorkout(workoutId: string): Promise<Workout | null>;
  listWorkouts(input: ListWorkoutsInput): Promise<readonly Workout[]>;
}

export interface WorkoutWriter extends WorkoutReader {
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
