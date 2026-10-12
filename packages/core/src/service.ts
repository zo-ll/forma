import { FormaError } from './errors.js';
import { createExerciseApi } from './exercises/service.js';
import { createSplitDayApi } from './split-days/service.js';
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
    splitDays: createSplitDayApi(store, ensureOpen),
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
