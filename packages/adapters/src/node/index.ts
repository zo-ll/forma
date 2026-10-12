import { randomUUID } from 'node:crypto';
import { createFormaService } from '@forma/core';
import type { Clock, FormaService, IdGenerator } from '@forma/core';
import { SqliteWorkoutStore } from './sqlite-workout-store.js';

export { SqliteWorkoutStore } from './sqlite-workout-store.js';
export type { SqliteWorkoutStoreOptions } from './sqlite-workout-store.js';

export interface NodeFormaOptions {
  readonly databasePath: string;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

/** This host constructs the Node adapters and injects them into the core. */
export function openNodeForma(options: NodeFormaOptions): FormaService {
  return createFormaService({
    store: SqliteWorkoutStore.open({ databasePath: options.databasePath }),
    clock: options.clock ?? { nowUtc: () => new Date().toISOString() },
    ids: options.ids ?? { next: () => randomUUID() },
  });
}
