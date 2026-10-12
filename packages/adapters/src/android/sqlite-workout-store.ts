import { FormaError } from '@forma/core';
import type { MigrationValue } from '../sqlite/migrations.js';
import type { SqliteConnection, SqliteRow } from '../sqlite/connection.js';
import { SharedSqliteWorkoutStore } from '../sqlite/workout-store.js';

/** Minimal structural surface of OP-SQLite 18.2.5; the host injects its native open binding. */
export interface OpSqliteDatabase {
  executeSync(statement: string, parameters?: MigrationValue[]): { readonly rows: readonly SqliteRow[] };
  close(): void;
}
export type OpSqliteOpener = (options: { name: string }) => OpSqliteDatabase;
export interface AndroidSqliteWorkoutStoreOptions {
  readonly databaseName: string;
  readonly openDatabase: OpSqliteOpener;
}

// Keep ownership across Fast Refresh/module copies within the same JavaScript runtime.
const key = Symbol.for('forma.android.sqlite.owners');
const globals = globalThis as unknown as Record<symbol, Set<string> | undefined>;
const owners = globals[key] ?? (globals[key] = new Set<string>());

function storageError(cause: unknown): FormaError {
  if (cause instanceof FormaError) return cause;
  if (cause !== null && typeof cause === 'object' && 'extendedCode' in cause
    && (cause.extendedCode === 1555 || cause.extendedCode === 2067)) {
    return new FormaError('CONFLICT', 'A stored ID or unique value already exists.', { cause });
  }
  return new FormaError('STORAGE_FAILURE', 'The OP-SQLite operation failed.', { cause });
}

function connection(native: OpSqliteDatabase, name: string): SqliteConnection {
  function query(statement: string, parameters: MigrationValue[]): readonly SqliteRow[] {
    const rows = native.executeSync(statement, parameters).rows;
    if (!Array.isArray(rows)) throw new FormaError('STORAGE_FAILURE', 'The OP-SQLite result has no rows array.');
    return rows;
  }
  return {
    prepare: (statement) => ({
      all: (...parameters) => query(statement, parameters),
      get: (...parameters) => query(statement, parameters)[0],
      run: (...parameters) => { native.executeSync(statement, parameters); },
    }),
    exec: (statement) => { native.executeSync(statement); },
    close: () => { native.close(); owners.delete(name); },
  };
}

/** One owner per database name in this host. All SQL runs through the shared serialized store. */
export class AndroidSqliteWorkoutStore extends SharedSqliteWorkoutStore {
  private constructor(db: SqliteConnection) { super(db, storageError); }

  static open(options: AndroidSqliteWorkoutStoreOptions): AndroidSqliteWorkoutStore {
    if (options === null || typeof options !== 'object') {
      throw new FormaError('INVALID_INPUT', 'Android storage options are required.', { field: 'input' });
    }
    const name = options.databaseName;
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new FormaError('INVALID_INPUT', 'Use a sandbox database filename, not a path.', { field: 'databaseName' });
    }
    if (typeof options.openDatabase !== 'function') {
      throw new FormaError('INVALID_INPUT', 'The host must supply the OP-SQLite open binding.', { field: 'openDatabase' });
    }
    if (owners.has(name)) throw new FormaError('CONFLICT', 'This host already owns the database.', { field: 'databaseName' });
    owners.add(name);
    let native: OpSqliteDatabase | undefined;
    try {
      native = options.openDatabase({ name });
      return new AndroidSqliteWorkoutStore(connection(native, name));
    } catch (cause) {
      if (native === undefined) owners.delete(name);
      else {
        try { native.close(); owners.delete(name); } catch { /* Unknown close state: keep ownership until runtime restart. */ }
      }
      throw storageError(cause);
    }
  }
}
