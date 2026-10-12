import type { WorkoutSessionDetails } from '../types.js';
import { invalid, utcTimestamp } from '../validation.js';

export function validateWorkoutSession(status: unknown, finishedAt: unknown): WorkoutSessionDetails {
  if (status !== 'in-progress' && status !== 'finished') invalid('status', 'The workout status is not supported.');
  if (status === 'in-progress' && finishedAt !== null) invalid('finishedAt', 'An in-progress workout cannot have a finish time.');
  return { status, finishedAt: finishedAt === null ? null : utcTimestamp(finishedAt) };
}
