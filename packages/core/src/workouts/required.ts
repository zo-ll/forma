import { FormaError } from '../errors.js';
import type { WorkoutReader } from '../ports.js';
import type { Workout } from '../types.js';

export async function requiredWorkout(reader: WorkoutReader, workoutId: string): Promise<Workout> {
  const workout = await reader.getWorkout(workoutId);
  if (!workout) throw new FormaError('NOT_FOUND', 'The workout does not exist.', { field: 'workoutId' });
  return workout;
}

export function requireInProgress(workout: Workout): void {
  if (workout.status !== 'in-progress') {
    throw new FormaError('CONFLICT', 'The workout is not in progress.', { field: 'status' });
  }
}
