import type { SetLoadDetails, WorkoutSet } from '../types.js';
import { finiteNumber, identifier, invalid, objectInput } from '../validation.js';

/** Validate a complete metadata pair. No exercise name or equipment is consulted. */
export function validateSetLoadDetails(convention: unknown, count: unknown): SetLoadDetails {
  if (!['unknown', 'entered', 'per-hand', 'combined', 'body-weight'].includes(convention as string)) {
    invalid('loadConvention', 'The load convention is not supported.');
  }
  if (convention === 'per-hand') {
    if (count !== 1 && count !== 2) invalid('implementCount', 'Per-hand load requires an implement count of 1 or 2.');
    return { loadConvention: convention, implementCount: count };
  }
  if (count !== null) invalid('implementCount', 'Only per-hand load can have an implement count.');
  return { loadConvention: convention as SetLoadDetails['loadConvention'], implementCount: null };
}

export interface SetLoadFact {
  readonly setId: string;
  readonly exerciseId: string;
  readonly value: number;
  readonly unit: 'kg';
  readonly convention: 'entered' | 'combined';
  readonly enteredWeightKg: number;
  readonly recordedConvention: SetLoadDetails['loadConvention'];
  readonly implementCount: 1 | 2 | null;
}

/** A load fact is not volume, resistance, or an estimate of the user's body mass. */
export function calculateSetLoad(set: WorkoutSet): SetLoadFact {
  objectInput(set, ['id', 'exerciseId', 'reps', 'weightKg', 'rpe', 'position', 'loadConvention', 'implementCount']);
  const setId = identifier(set.id, 'setId');
  const exerciseId = identifier(set.exerciseId, 'exerciseId');
  const weight = finiteNumber(set.weightKg, 'weightKg', 0);
  const details = validateSetLoadDetails(set.loadConvention, set.implementCount);
  if (details.loadConvention === 'unknown' || details.loadConvention === 'body-weight') {
    invalid('loadConvention', 'Unknown and body-weight loads cannot supply comparable load facts.');
  }
  const value = details.loadConvention === 'per-hand' ? weight * (details.implementCount as number) : weight;
  finiteNumber(value, 'weightKg', 0);
  return {
    setId, exerciseId, value, unit: 'kg',
    convention: details.loadConvention === 'entered' ? 'entered' : 'combined',
    enteredWeightKg: weight, recordedConvention: details.loadConvention,
    implementCount: details.implementCount,
  };
}

/** Compare load only, not reps, effort, volume, or a personal best. */
export function compareSetLoads(left: WorkoutSet, right: WorkoutSet): -1 | 0 | 1 {
  const a = calculateSetLoad(left);
  const b = calculateSetLoad(right);
  if (a.exerciseId !== b.exerciseId) invalid('exerciseId', 'Load comparisons require the same exercise.');
  if (a.convention !== b.convention) invalid('loadConvention', 'The load conventions are incompatible.');
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}
