import { FormaError } from '../errors.js';
import type { WorkoutStore } from '../ports.js';
import type { ExerciseApi } from '../types.js';
import { identifier, normalizeExerciseAlias } from '../validation.js';

export function createExerciseApi(store: WorkoutStore, ensureOpen: () => void): ExerciseApi {
  return {
    async list() {
      ensureOpen();
      return store.read((reader) => reader.listExercises());
    },
    async get(exerciseId) {
      ensureOpen();
      identifier(exerciseId, 'exerciseId');
      return store.read(async (reader) => {
        const exercise = await reader.getExercise(exerciseId);
        if (!exercise) throw new FormaError('NOT_FOUND', 'The exercise does not exist.', { field: 'exerciseId' });
        return exercise;
      });
    },
    async resolveAlias(alias) {
      ensureOpen();
      const normalized = normalizeExerciseAlias(alias);
      return store.read(async (reader) => {
        const exercise = await reader.findExerciseByAlias(normalized);
        if (!exercise) throw new FormaError('NOT_FOUND', 'The exercise alias is unknown.', { field: 'alias' });
        return exercise;
      });
    },
  };
}
