import { createFormaService } from '@forma/core';
import type { Clock, FormaService, IdGenerator, InferenceRuntime } from '@forma/core';
import { AndroidSqliteWorkoutStore } from './sqlite-workout-store.js';
import type { AndroidSqliteWorkoutStoreOptions } from './sqlite-workout-store.js';

export { AndroidSqliteWorkoutStore } from './sqlite-workout-store.js';
export type { AndroidSqliteWorkoutStoreOptions, OpSqliteDatabase, OpSqliteOpener } from './sqlite-workout-store.js';
export interface AndroidFormaOptions extends AndroidSqliteWorkoutStoreOptions {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly inference?: InferenceRuntime;
}
/** The native host supplies OP-SQLite, UTC audit time, and opaque ID generation. */
export function openAndroidForma(options: AndroidFormaOptions): FormaService {
  const store = AndroidSqliteWorkoutStore.open(options);
  try {
    return createFormaService({ store, clock: options.clock, ids: options.ids,
      ...(options.inference === undefined ? {} : { inference: options.inference }) });
  } catch (error) {
    void store.close().catch(() => undefined);
    throw error;
  }
}
