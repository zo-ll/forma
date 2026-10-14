import { createArchiveApi, createRestoreExclusion } from './archive/service.js';
import { FormaError } from './errors.js';
import { createInferenceModule } from './inference/service.js';
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
  const exclusion = createRestoreExclusion(store, () => inference.invalidate());
  const guarded = exclusion.store;
  const inference = createInferenceModule(dependencies.inference, guarded, () => {
    ensureOpen();
    exclusion.ensureAvailable();
  });
  return {
    inference: inference.api,
    exercises: createExerciseApi(guarded, ensureOpen),
    splitDays: createSplitDayApi(guarded, ensureOpen),
    workouts: createWorkoutApi(guarded, clock, ids, ensureOpen),
    notes: createNotesApi({ store: guarded, clock, ids }, ensureOpen),
    archive: createArchiveApi(store, exclusion, clock, ensureOpen),
    close() {
      if (!closePromise) {
        closed = true;
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        closePromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        // Publish the promise before any injected close or cancellation listener runs.
        // Storage closes independently, even if an optional runtime hangs or fails.
        let storageClose: Promise<void>;
        try { storageClose = store.close(); } catch (error) { storageClose = Promise.reject(error); }
        void Promise.allSettled([storageClose, inference.close()]).then(results => {
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        }).then(resolve, reject);
      }
      return closePromise;
    },
  };
}
