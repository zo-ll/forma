import { FormaError } from './errors.js';
import { createExerciseApi } from './exercises/service.js';
import { createGroupApi } from './groups/service.js';
import type { FormaDependencies } from './ports.js';
import type { FormaService } from './types.js';
import { createWorkoutApi } from './workouts/service.js';

export function createFormaService(dependencies: FormaDependencies): FormaService {
  const { store, clock, ids } = dependencies;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  function ensureOpen(): void {
    if (closed) throw new FormaError('SERVICE_CLOSED', 'The Forma service is closed.');
  }
  return {
    exercises: createExerciseApi(store, ensureOpen),
    groups: createGroupApi(store, ensureOpen),
    workouts: createWorkoutApi(store, clock, ids, ensureOpen),
    close() {
      if (!closePromise) {
        closed = true;
        closePromise = store.close();
      }
      return closePromise;
    },
  };
}
