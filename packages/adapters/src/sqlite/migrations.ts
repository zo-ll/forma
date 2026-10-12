import { FormaError } from '@forma/core';

export type MigrationValue = string | number | null | Uint8Array;

/** One complete SQL statement, not a script of several statements. */
export interface MigrationStatement {
  readonly sql: string;
  readonly parameters?: readonly MigrationValue[];
}

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly MigrationStatement[];
}

/** Bind these methods to synchronous database operations, such as executeSync. */
export interface MigrationDriver {
  getVersion(): number;
  beginImmediate(): undefined;
  execute(statement: MigrationStatement): undefined;
  setVersion(version: number): undefined;
  commit(): undefined;
  rollback(): undefined;
}

export function pendingMigrations(
  currentVersion: number,
  migrations: readonly SqliteMigration[],
): readonly SqliteMigration[] {
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new FormaError('STORAGE_FAILURE', 'The database schema version is invalid.');
  }
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1 || !Number.isSafeInteger(migration.version)) {
      throw new FormaError('STORAGE_FAILURE', 'Schema migrations must have consecutive versions starting at 1.');
    }
  });
  const supported = migrations.length;
  if (currentVersion > supported) {
    throw new FormaError('STORAGE_FAILURE', 'This database schema version is not supported.');
  }
  return migrations.slice(currentVersion);
}

/** Apply every pending version in one transaction before the host exposes its service. */
export function runSqliteMigrations(
  driver: MigrationDriver,
  migrations: readonly SqliteMigration[],
): readonly number[] {
  let transactionStarted = false;
  try {
    if (pendingMigrations(driver.getVersion(), migrations).length === 0) return [];
    driver.beginImmediate();
    transactionStarted = true;
    // Another connection can upgrade the database before this connection acquires its lock.
    const pending = pendingMigrations(driver.getVersion(), migrations);
    const applied: number[] = [];
    for (const migration of pending) {
      for (const statement of migration.statements) driver.execute(statement);
      driver.setVersion(migration.version);
      applied.push(migration.version);
    }
    driver.commit();
    transactionStarted = false;
    return applied;
  } catch (cause) {
    if (transactionStarted) {
      try { driver.rollback(); } catch { /* Preserve the original failure. */ }
    }
    if (cause instanceof FormaError) throw cause;
    throw new FormaError('STORAGE_FAILURE', 'The SQLite schema migration failed.', { cause });
  }
}
