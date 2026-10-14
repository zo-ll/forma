import type { SqliteConnection, SqliteRow as Row } from './connection.js';
import { FormaError, normalizeExerciseAlias, validateSetLoadDetails, validateWorkoutSession, WORKOUT_HISTORY_LIMITS } from '@forma/core';
import type {
  Exercise, ListWorkoutsInput, Workout, SplitDay, WorkoutReader, WorkoutSet,
  ArchiveCounts, ArchiveRecords, HistoryStorePage, HistoryStoreQuery, RequestReceipt, SetLoadDetails, WorkoutSessionDetails, WorkoutStore, WorkoutWriter,
} from '@forma/core';
import { createSqliteNotesView } from './notes-view.js';
import { pendingMigrations, runSqliteMigrations } from './migrations.js';
import { SQLITE_MIGRATIONS } from './registry.js';
import type { MigrationDriver, MigrationValue } from './migrations.js';

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

/** Shared SQL mapping and lifecycle; each platform owns its native binding and error translation. */
export class SharedSqliteWorkoutStore implements WorkoutStore {
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;
  private closePromise: Promise<void> | undefined;

  protected constructor(
    private readonly db: SqliteConnection,
    private readonly storageError: (cause: unknown) => FormaError,
  ) { this.initialize(); }

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
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA journal_mode = WAL');
    runSqliteMigrations(driver, SQLITE_MIGRATIONS);
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting) {
      return Promise.reject(new FormaError('SERVICE_CLOSED', 'The workout store is closed.'));
    }
    const pending = this.tail.then(run);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending.catch((cause: unknown) => { throw this.storageError(cause); });
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
      ...createSqliteNotesView(this.db, check, writable),
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
      getInProgressWorkout: async () => {
        check();
        const row = this.db.prepare("SELECT * FROM workouts WHERE status = 'in-progress'").get();
        return row ? this.workoutFromRow(row) : null;
      },
      deleteWorkout: async (id) => {
        check();
        if (!writable) throw new FormaError('STORAGE_FAILURE', 'A read transaction cannot delete a workout.');
        this.db.prepare('DELETE FROM workouts WHERE id = ?').run(id);
      },
      listWorkouts: async (input) => { check(); return this.listWorkouts(input); },
      listHistoryWorkouts: async (input) => { check(); return this.listHistoryWorkouts(input); },
      getHistoryRevision: async () => {
        check();
        const row = this.db.prepare('SELECT revision FROM workout_history_state WHERE id = 1').get();
        if (!row) throw new FormaError('STORAGE_FAILURE', 'The history revision is missing.');
        const revision = numberValue(row, 'revision');
        if (!Number.isSafeInteger(revision) || revision < 0) throw new FormaError('STORAGE_FAILURE', 'Invalid history revision.');
        return revision;
      },
      saveWorkout: async (workout) => {
        check();
        if (!writable) throw new FormaError('STORAGE_FAILURE', 'A read transaction cannot save a workout.');
        this.saveWorkout(workout);
      },
      listRequestReceipts: async () => {
        check();
        return this.db.prepare('SELECT * FROM request_receipts ORDER BY request_id').all().map((row) => this.receiptFromRow(row));
      },
      countArchiveRecords: async () => { check(); return this.countArchiveRecords(); },
      replaceArchiveRecords: async (records) => {
        check();
        if (!writable) throw new FormaError('STORAGE_FAILURE', 'A read transaction cannot replace records.');
        this.replaceArchiveRecords(records);
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
    return row ? this.receiptFromRow(row) : null;
  }

  private requireWorkoutOnlyArchive(): void {
    // Notes archive integration is not released yet. Never silently export an incomplete backup
    // or replace receipts while note identities still exist.
    if (this.db.prepare('SELECT id FROM note_ids LIMIT 1').get() !== undefined) {
      throw new FormaError('STORAGE_FAILURE', 'This archive version cannot preserve notes or reserved note IDs.', { field: 'archive.notes' });
    }
  }

  private countArchiveRecords(): ArchiveCounts {
    this.requireWorkoutOnlyArchive();
    const row = this.db.prepare('SELECT (SELECT COUNT(*) FROM workouts) AS workouts, (SELECT COUNT(*) FROM sets) AS sets, '
      + "(SELECT COUNT(*) FROM request_receipts) AS receipts, (SELECT COUNT(*) FROM workouts WHERE status = 'in-progress') AS in_progress").get();
    if (!row) throw new FormaError('STORAGE_FAILURE', 'The record counts are unavailable.');
    return {
      workouts: numberValue(row, 'workouts'), sets: numberValue(row, 'sets'),
      receipts: numberValue(row, 'receipts'), inProgress: numberValue(row, 'in_progress'),
    };
  }

  /** Full replacement inside the caller's write transaction. Catalog rows stay unchanged. */
  private replaceArchiveRecords(records: ArchiveRecords): void {
    this.requireWorkoutOnlyArchive();
    this.db.exec('DELETE FROM sets');
    this.db.exec('DELETE FROM workouts');
    this.db.exec('DELETE FROM request_receipts');
    for (const workout of records.workouts) this.saveWorkout(workout);
    const insert = this.db.prepare(
      'INSERT INTO request_receipts (request_id, operation, input_signature, result_json, format_version) VALUES (?, ?, ?, ?, ?)',
    );
    for (const receipt of records.receipts) {
      insert.run(receipt.requestId, receipt.operation, receipt.inputSignature, receipt.resultJson, receipt.formatVersion);
    }
    // Advance the local revision also for an empty replacement. An archive never supplies a revision.
    this.db.exec('UPDATE workout_history_state SET revision = revision + 1 WHERE id = 1');
  }

  private receiptFromRow(row: Row): RequestReceipt {
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

  private workoutFromRow(row: Row, bounds?: { exerciseId: string | null; limit: number }): Workout {
    const id = stringValue(row, 'id');
    const conditions = bounds?.exerciseId == null ? '' : ' AND exercise_id = ?';
    const limit = bounds === undefined ? '' : ' LIMIT ?';
    const parameters: MigrationValue[] = [id];
    if (bounds?.exerciseId != null) parameters.push(bounds.exerciseId);
    if (bounds !== undefined) parameters.push(bounds.limit);
    const sets: WorkoutSet[] = this.db.prepare(
      'SELECT * FROM sets WHERE workout_id = ?' + conditions + ' ORDER BY position' + limit,
    ).all(...parameters).map((set) => ({
      id: stringValue(set, 'id'), exerciseId: stringValue(set, 'exercise_id'),
      reps: numberValue(set, 'reps'), weightKg: numberValue(set, 'weight_kg'),
      rpe: nullableNumber(set, 'rpe'), position: numberValue(set, 'position'),
      ...this.loadDetailsFromRow(set),
    }));
    return {
      id, date: stringValue(row, 'date'), splitDayId: nullableString(row, 'group_id'),
      notes: stringValue(row, 'notes'), durationMin: nullableNumber(row, 'duration_min'),
      createdAt: stringValue(row, 'created_at'), updatedAt: stringValue(row, 'updated_at'), sets,
      ...this.sessionFromRow(row),
    };
  }

  private loadDetailsFromRow(row: Row): SetLoadDetails {
    try {
      return validateSetLoadDetails(stringValue(row, 'load_convention'), nullableNumber(row, 'implement_count'));
    } catch (cause) {
      throw new FormaError('STORAGE_FAILURE', 'Invalid load convention in storage.', { cause });
    }
  }

  private sessionFromRow(row: Row): WorkoutSessionDetails {
    try {
      return validateWorkoutSession(stringValue(row, 'status'), nullableString(row, 'finished_at'));
    } catch (cause) {
      throw new FormaError('STORAGE_FAILURE', 'Invalid workout session in storage.', { cause });
    }
  }

  private getWorkout(id: string): Workout | null {
    const row = this.db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
    return row ? this.workoutFromRow(row) : null;
  }

  private listWorkouts(input: ListWorkoutsInput): readonly Workout[] {
    const conditions: string[] = [];
    const values: MigrationValue[] = [];
    if (input.dateFrom !== undefined) { conditions.push('date >= ?'); values.push(input.dateFrom); }
    if (input.dateTo !== undefined) { conditions.push('date <= ?'); values.push(input.dateTo); }
    const where = conditions.length === 0 ? '' : ' WHERE ' + conditions.join(' AND ');
    return this.db.prepare(
      'SELECT * FROM workouts' + where + ' ORDER BY date DESC, created_at DESC, id ASC',
    ).all(...values).map((row) => this.workoutFromRow(row));
  }

  private listHistoryWorkouts(input: HistoryStoreQuery): HistoryStorePage {
    const { filter, after } = input;
    const conditions: string[] = [];
    const values: MigrationValue[] = [];
    if (filter.dateFrom !== null) { conditions.push('w.date >= ?'); values.push(filter.dateFrom); }
    if (filter.dateTo !== null) { conditions.push('w.date <= ?'); values.push(filter.dateTo); }
    if (filter.status !== 'all') { conditions.push('w.status = ?'); values.push(filter.status); }
    if (filter.exerciseId !== null) {
      conditions.push('EXISTS (SELECT 1 FROM sets s WHERE s.workout_id = w.id AND s.exercise_id = ?)');
      values.push(filter.exerciseId);
    }
    if (after !== null) {
      conditions.push('(w.date < ? OR (w.date = ? AND w.created_at < ?) OR (w.date = ? AND w.created_at = ? AND w.id > ?))');
      values.push(after.date, after.date, after.createdAt, after.date, after.createdAt, after.id);
    }
    const where = conditions.length === 0 ? '' : ' WHERE ' + conditions.join(' AND ');
    values.push(input.limit + 1);
    const rows = this.db.prepare('SELECT w.* FROM workouts w' + where
      + ' ORDER BY w.date DESC, w.created_at DESC, w.id ASC LIMIT ?').all(...values);
    const result: Workout[] = [];
    let remainingSets = WORKOUT_HISTORY_LIMITS.maxPageSets;
    for (const row of rows.slice(0, input.limit)) {
      const workout = this.workoutFromRow(row, {
        exerciseId: input.sets === 'matching' ? filter.exerciseId : null, limit: remainingSets + 1,
      });
      if (workout.sets.length > remainingSets) {
        throw new FormaError('INVALID_INPUT', 'The query exceeds the 10000-set page budget.', {
          field: input.sets === 'matching' ? 'dateRange' : 'limit',
        });
      }
      remainingSets -= workout.sets.length;
      result.push(workout);
    }
    return { items: result, hasMore: rows.length > input.limit };
  }

  private saveWorkout(workout: Workout): void {
    this.db.prepare(
      'INSERT INTO workouts (id, date, group_id, notes, duration_min, created_at, updated_at, status, finished_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET '
      + 'date = excluded.date, group_id = excluded.group_id, notes = excluded.notes, '
      + 'duration_min = excluded.duration_min, updated_at = excluded.updated_at, '
      + 'status = excluded.status, finished_at = excluded.finished_at',
    ).run(
      workout.id, workout.date, workout.splitDayId, workout.notes, workout.durationMin,
      workout.createdAt, workout.updatedAt, workout.status, workout.finishedAt,
    );
    this.db.prepare('DELETE FROM sets WHERE workout_id = ?').run(workout.id);
    const insert = this.db.prepare(
      'INSERT INTO sets (id, workout_id, exercise_id, reps, weight_kg, rpe, position, load_convention, implement_count) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const set of workout.sets) {
      insert.run(set.id, workout.id, set.exerciseId, set.reps, set.weightKg, set.rpe, set.position, set.loadConvention, set.implementCount);
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.accepting = false;
      this.closePromise = this.tail.then(() => {
        try { this.db.close(); } catch (cause) { throw this.storageError(cause); }
      });
    }
    return this.closePromise;
  }
}
