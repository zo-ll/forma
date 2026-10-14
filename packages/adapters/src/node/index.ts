import { randomUUID } from 'node:crypto';
import { createFormaService } from '@forma/core';
import type { Clock, FormaService, IdGenerator, InferenceRuntime } from '@forma/core';
import { SqliteWorkoutStore } from './sqlite-workout-store.js';

export { SqliteWorkoutStore } from './sqlite-workout-store.js';
export type { SqliteWorkoutStoreOptions } from './sqlite-workout-store.js';

export interface NodeFormaOptions {
  readonly databasePath: string;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly inference?: InferenceRuntime;
}

/** This host constructs the Node adapters and injects them into the core. */
export function openNodeForma(options: NodeFormaOptions): FormaService {
  const store = SqliteWorkoutStore.open({ databasePath: options.databasePath });
  try {
    return createFormaService({
      store,
      clock: options.clock ?? { nowUtc: () => new Date().toISOString() },
      ids: options.ids ?? { next: () => randomUUID() },
      ...(options.inference === undefined ? {} : { inference: options.inference }),
    });
  } catch (error) {
    // Construction can reject duplicate runtime ownership. Do not leak this factory's store.
    void store.close().catch(() => undefined);
    throw error;
  }
}
