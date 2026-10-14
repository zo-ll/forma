import { createArchiveApi, createRestoreExclusion } from './archive/service.js';
import { FormaError } from './errors.js';
import { createExerciseApi } from './exercises/service.js';
import { createSplitDayApi } from './split-days/service.js';
import type { FormaDependencies } from './ports.js';
import type { FormaService } from './types.js';
import { createNotesApi } from './notes/service.js';
import { createWorkoutApi } from './workouts/service.js';

export function createFormaService(dependencies: FormaDependencies): FormaService {
  const { store, clock, ids } = dependencies;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  function ensureOpen(): void {
    if (closed) throw new FormaError('SERVICE_CLOSED', 'The Forma service is closed.');
  }
  // Every public API uses the guarded store, so a cached API reference cannot bypass a restore.
  const exclusion = createRestoreExclusion(store);
  const guarded = exclusion.store;
  return {
    exercises: createExerciseApi(guarded, ensureOpen),
    splitDays: createSplitDayApi(guarded, ensureOpen),
    workouts: createWorkoutApi(guarded, clock, ids, ensureOpen),
    notes: createNotesApi({ store: guarded, clock, ids }, ensureOpen),
    archive: createArchiveApi(store, exclusion, clock, ensureOpen),
    close() {
      if (!closePromise) {
        closed = true;
        closePromise = store.close();
      }
      return closePromise;
    },
  };
}
