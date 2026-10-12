import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { FormaError, normalizeExerciseAlias } from '@forma/core';
import type {
  Exercise, ListWorkoutsInput, Workout, SplitDay, WorkoutReader, WorkoutSet,
  RequestReceipt, WorkoutStore, WorkoutWriter,
} from '@forma/core';
import { pendingMigrations, runSqliteMigrations } from '../sqlite/migrations.js';
import { SQLITE_MIGRATIONS } from '../sqlite/registry.js';
import type { MigrationDriver } from '../sqlite/migrations.js';

type Row = Record<string, SQLOutputValue>;

function stringValue(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new FormaError('STORAGE_FAILURE', 'Invalid text in storage: ' + column + '.');
  return value;
}

function numberValue(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FormaError('STORAGE_FAILURE', 'Invalid number in storage: ' + column + '.');
  }
  return value;
}

function nullableString(row: Row, column: string): string | null {
  return row[column] === null ? null : stringValue(row, column);
}

function nullableNumber(row: Row, column: string): number | null {
  return row[column] === null ? null : numberValue(row, column);
}

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

/** The Node binding is separate from the portable core. */
export class SqliteWorkoutStore implements WorkoutStore {
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;
  private closePromise: Promise<void> | undefined;

  private constructor(private readonly db: DatabaseSync) {}

  static open(options: SqliteWorkoutStoreOptions): SqliteWorkoutStore {
    if (typeof options.databasePath !== 'string' || options.databasePath.trim().length === 0) {
      throw new FormaError('INVALID_INPUT', 'A database path is required.', { field: 'databasePath' });
    }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(options.databasePath);
      const store = new SqliteWorkoutStore(db);
      store.initialize();
      return store;
    } catch (cause) {
      try { db?.close(); } catch { /* Preserve the original failure. */ }
      throw storageError(cause);
    }
  }

  private initialize(): void {
    const driver: MigrationDriver = {
      getVersion: () => {
        const row = this.db.prepare('PRAGMA user_version').get();
        if (!row) throw new FormaError('STORAGE_FAILURE', 'The schema version is unavailable.');
        return numberValue(row, 'user_version');
      },
      beginImmediate: () => { this.db.exec('BEGIN IMMEDIATE'); return undefined; },
      execute: (statement) => {
        if (statement.parameters === undefined) this.db.exec(statement.sql);
        else this.db.prepare(statement.sql).run(...statement.parameters);
        return undefined;
      },
      setVersion: (version) => { this.db.exec('PRAGMA user_version = ' + version); return undefined; },
      commit: () => { this.db.exec('COMMIT'); return undefined; },
      rollback: () => { this.db.exec('ROLLBACK'); return undefined; },
    };
    // Reject unsupported schemas before a pragma can change the database.
    pendingMigrations(driver.getVersion(), SQLITE_MIGRATIONS);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    runSqliteMigrations(driver, SQLITE_MIGRATIONS);
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting) {
      return Promise.reject(new FormaError('SERVICE_CLOSED', 'The workout store is closed.'));
    }
    const pending = this.tail.then(run);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending.catch((cause: unknown) => { throw storageError(cause); });
  }

  read<T>(run: (reader: WorkoutReader) => Promise<T>): Promise<T> {
    return this.enqueue(() => this.transaction(false, run));
  }

  write<T>(run: (writer: WorkoutWriter) => Promise<T>): Promise<T> {
    return this.enqueue(() => this.transaction(true, run));
  }

  private async transaction<T>(
    writable: boolean,
    run: (view: WorkoutWriter) => Promise<T>,
  ): Promise<T> {
    this.db.exec(writable ? 'BEGIN IMMEDIATE' : 'BEGIN');
    let active = true;
    const check = (): void => {
      if (!active) throw new FormaError('STORAGE_FAILURE', 'The transaction view has expired.');
    };
    const view: WorkoutWriter = {
      listExercises: async () => { check(); return this.listExercises(); },
      getExercise: async (id) => { check(); return this.getExercise(id); },
      findExerciseByAlias: async (alias) => {
        check();
        const row = this.db.prepare('SELECT exercise_id FROM exercise_aliases WHERE normalized_alias = ?').get(alias);
        return row ? this.getExercise(stringValue(row, 'exercise_id')) : null;
      },
      listSplitDays: async () => { check(); return this.listSplitDays(); },
      getSplitDay: async (id) => { check(); return this.getSplitDay(id); },
      getRequestReceipt: async (id) => { check(); return this.getRequestReceipt(id); },
      saveRequestReceipt: async (receipt) => {
        check();
        if (!writable) throw new FormaError('STORAGE_FAILURE', 'A read transaction cannot save a request receipt.');
        this.db.prepare(
          'INSERT INTO request_receipts (request_id, operation, input_signature, result_json, format_version) VALUES (?, ?, ?, ?, ?)',
        ).run(receipt.requestId, receipt.operation, receipt.inputSignature, receipt.resultJson, receipt.formatVersion);
      },
      getWorkout: async (id) => { check(); return this.getWorkout(id); },
      listWorkouts: async (input) => { check(); return this.listWorkouts(input); },
      saveWorkout: async (workout) => {
        check();
        if (!writable) throw new FormaError('STORAGE_FAILURE', 'A read transaction cannot save a workout.');
        this.saveWorkout(workout);
      },
    };
    try {
      const result = await run(view);
      active = false;
      this.db.exec('COMMIT');
      return result;
    } catch (cause) {
      active = false;
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw cause;
    }
  }

  private getRequestReceipt(id: string): RequestReceipt | null {
    const row = this.db.prepare('SELECT * FROM request_receipts WHERE request_id = ?').get(id);
    if (!row) return null;
    if (numberValue(row, 'format_version') !== 1) {
      throw new FormaError('STORAGE_FAILURE', 'The request receipt format is not supported.');
    }
    return {
      requestId: stringValue(row, 'request_id'), operation: stringValue(row, 'operation'),
      inputSignature: stringValue(row, 'input_signature'), resultJson: stringValue(row, 'result_json'),
      formatVersion: 1,
    };
  }

  private exerciseFromRow(row: Row): Exercise {
    const id = stringValue(row, 'id');
    const name = stringValue(row, 'name');
    const normalizedName = normalizeExerciseAlias(name);
    const aliases = this.db.prepare(
      'SELECT alias FROM exercise_aliases WHERE exercise_id = ? ORDER BY normalized_alias',
    ).all(id).map((alias) => stringValue(alias, 'alias')).filter((alias) => normalizeExerciseAlias(alias) !== normalizedName);
    return {
      id, name, aliases,
      muscleGroup: nullableString(row, 'muscle_group'),
      equipment: nullableString(row, 'equipment'),
    };
  }

  private listExercises(): readonly Exercise[] {
    return this.db.prepare('SELECT * FROM exercises ORDER BY catalog_position').all()
      .map((row) => this.exerciseFromRow(row));
  }

  private getExercise(id: string): Exercise | null {
    const row = this.db.prepare('SELECT * FROM exercises WHERE id = ?').get(id);
    return row ? this.exerciseFromRow(row) : null;
  }

  private splitDayFromRow(row: Row): SplitDay {
    const id = stringValue(row, 'id');
    const exerciseIds = this.db.prepare(
      'SELECT exercise_id FROM workout_group_exercises WHERE group_id = ? ORDER BY position',
    ).all(id).map((member) => stringValue(member, 'exercise_id'));
    return { id, name: stringValue(row, 'name'), exerciseIds };
  }

  private listSplitDays(): readonly SplitDay[] {
    return this.db.prepare('SELECT * FROM workout_groups ORDER BY catalog_position').all()
      .map((row) => this.splitDayFromRow(row));
  }

  private getSplitDay(id: string): SplitDay | null {
    const row = this.db.prepare('SELECT * FROM workout_groups WHERE id = ?').get(id);
    return row ? this.splitDayFromRow(row) : null;
  }

  private workoutFromRow(row: Row): Workout {
    const id = stringValue(row, 'id');
    const sets: WorkoutSet[] = this.db.prepare(
      'SELECT * FROM sets WHERE workout_id = ? ORDER BY position',
    ).all(id).map((set) => ({
      id: stringValue(set, 'id'), exerciseId: stringValue(set, 'exercise_id'),
      reps: numberValue(set, 'reps'), weightKg: numberValue(set, 'weight_kg'),
      rpe: nullableNumber(set, 'rpe'), position: numberValue(set, 'position'),
    }));
    return {
      id, date: stringValue(row, 'date'), splitDayId: nullableString(row, 'group_id'),
      notes: stringValue(row, 'notes'), durationMin: nullableNumber(row, 'duration_min'),
      createdAt: stringValue(row, 'created_at'), updatedAt: stringValue(row, 'updated_at'), sets,
    };
  }

  private getWorkout(id: string): Workout | null {
    const row = this.db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
    return row ? this.workoutFromRow(row) : null;
  }

  private listWorkouts(input: ListWorkoutsInput): readonly Workout[] {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.dateFrom !== undefined) { conditions.push('date >= ?'); values.push(input.dateFrom); }
    if (input.dateTo !== undefined) { conditions.push('date <= ?'); values.push(input.dateTo); }
    const where = conditions.length === 0 ? '' : ' WHERE ' + conditions.join(' AND ');
    return this.db.prepare(
      'SELECT * FROM workouts' + where + ' ORDER BY date DESC, created_at DESC, id ASC',
    ).all(...values).map((row) => this.workoutFromRow(row));
  }

  private saveWorkout(workout: Workout): void {
    this.db.prepare(
      'INSERT INTO workouts (id, date, group_id, notes, duration_min, created_at, updated_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET '
      + 'date = excluded.date, group_id = excluded.group_id, notes = excluded.notes, '
      + 'duration_min = excluded.duration_min, updated_at = excluded.updated_at',
    ).run(
      workout.id, workout.date, workout.splitDayId, workout.notes, workout.durationMin,
      workout.createdAt, workout.updatedAt,
    );
    this.db.prepare('DELETE FROM sets WHERE workout_id = ?').run(workout.id);
    const insert = this.db.prepare(
      'INSERT INTO sets (id, workout_id, exercise_id, reps, weight_kg, rpe, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const set of workout.sets) {
      insert.run(set.id, workout.id, set.exerciseId, set.reps, set.weightKg, set.rpe, set.position);
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.accepting = false;
      this.closePromise = this.tail.then(() => {
        try { this.db.close(); } catch (cause) { throw storageError(cause); }
      });
    }
    return this.closePromise;
  }
}
