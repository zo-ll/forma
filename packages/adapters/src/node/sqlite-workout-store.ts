import { DatabaseSync } from 'node:sqlite';
import { FormaError } from '@forma/core';
import { SharedSqliteWorkoutStore } from '../sqlite/workout-store.js';

function storageError(cause: unknown): FormaError {
  if (cause instanceof FormaError) return cause;
  if (cause !== null && typeof cause === 'object' && 'errcode' in cause
    && (cause.errcode === 1555 || cause.errcode === 2067)) {
    return new FormaError('CONFLICT', 'A stored ID or unique value already exists.', { cause });
  }
  return new FormaError('STORAGE_FAILURE', 'The SQLite operation failed.', { cause });
}

export interface SqliteWorkoutStoreOptions {
  readonly databasePath: string;
}

/** The Node binding is separate from the shared SQL adapter and the core. */
export class SqliteWorkoutStore extends SharedSqliteWorkoutStore {
  private constructor(db: DatabaseSync) { super(db, storageError); }

  static open(options: SqliteWorkoutStoreOptions): SqliteWorkoutStore {
    if (typeof options.databasePath !== 'string' || options.databasePath.trim().length === 0) {
      throw new FormaError('INVALID_INPUT', 'A database path is required.', { field: 'databasePath' });
    }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(options.databasePath);
      return new SqliteWorkoutStore(db);
    } catch (cause) {
      try { db?.close(); } catch { /* Preserve the original failure. */ }
      throw storageError(cause);
    }
  }
}
