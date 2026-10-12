import type { DatabaseSync } from 'node:sqlite';
import type { MigrationDriver } from '@forma/adapters/sqlite';

export function migrationDriver(db: DatabaseSync): MigrationDriver {
  return {
    getVersion: () => Number(db.prepare('PRAGMA user_version').get()?.user_version),
    beginImmediate: () => { db.exec('BEGIN IMMEDIATE'); return undefined; },
    execute: (statement) => {
      if (statement.parameters === undefined) db.exec(statement.sql);
      else db.prepare(statement.sql).run(...statement.parameters);
      return undefined;
    },
    setVersion: (version) => { db.exec('PRAGMA user_version = ' + version); return undefined; },
    commit: () => { db.exec('COMMIT'); return undefined; },
    rollback: () => { db.exec('ROLLBACK'); return undefined; },
  };
}
