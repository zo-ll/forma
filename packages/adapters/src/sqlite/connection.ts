import type { MigrationValue } from './migrations.js';

export type SqliteRow = Record<string, unknown>;
export interface SqliteStatement {
  all(...parameters: MigrationValue[]): readonly SqliteRow[];
  get(...parameters: MigrationValue[]): SqliteRow | undefined;
  run(...parameters: MigrationValue[]): void;
}
/** Synchronous platform binding. exec accepts one complete SQL statement. */
export interface SqliteConnection {
  prepare(statement: string): SqliteStatement;
  exec(statement: string): void;
  close(): void;
}
