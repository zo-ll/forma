import { createFormaService } from '@forma/core';
import type { Clock, FormaService, IdGenerator } from '@forma/core';
import { AndroidSqliteWorkoutStore } from './sqlite-workout-store.js';
import type { AndroidSqliteWorkoutStoreOptions } from './sqlite-workout-store.js';

export { AndroidSqliteWorkoutStore } from './sqlite-workout-store.js';
export type { AndroidSqliteWorkoutStoreOptions, OpSqliteDatabase, OpSqliteOpener } from './sqlite-workout-store.js';
export interface AndroidFormaOptions extends AndroidSqliteWorkoutStoreOptions {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
/** The native host supplies OP-SQLite, UTC audit time, and opaque ID generation. */
export function openAndroidForma(options: AndroidFormaOptions): FormaService {
  return createFormaService({ store: AndroidSqliteWorkoutStore.open(options), clock: options.clock, ids: options.ids });
}
