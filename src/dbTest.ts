// Real OP-SQLite adapter for the database validation tests.
//
// The FTS5 and sqlite-vec features come from the compiled SQLite build. The
// flags come from the "op-sqlite" section of package.json:
//   "fts5": true and "sqliteVec": true.
//
// This module imports the native library. Unit tests do not import it. Unit
// tests use the pure orchestrator in src/dbTestCore.ts instead.
import { open, type DB } from '@op-engineering/op-sqlite';
import {
  cleanupScratchTables,
  describeError,
  firstValue,
  opSqliteTestCases,
  runDbSuite,
  type DbTestPort,
  type DbTestReport,
  type SqlParams,
} from './dbTestCore';

const VALIDATION_DB_NAME = 'fitrag_validation.sqlite';
const PERSISTENCE_DB_NAME = 'fitrag_validation_persistence.sqlite';

function portForDb(db: DB): DbTestPort {
  return {
    execute: async (sql: string, params?: SqlParams) => {
      const result = await db.execute(sql, params ? [...params] : undefined);
      return { rows: result.rows ?? [] };
    },
    transaction: (run) =>
      db.transaction(async (tx) => {
        const inner: DbTestPort = {
          execute: async (sql: string, params?: SqlParams) => {
            const result = await tx.execute(sql, params ? [...params] : undefined);
            return { rows: result.rows ?? [] };
          },
          transaction: () => Promise.reject(new Error('Nested transactions are not supported.')),
        };
        await run(inner);
      }),
  };
}

/** Check that a row survives close and reopen. */
async function runPersistenceCheck(): Promise<DbTestReport> {
  const startedAt = Date.now();
  const name = 'close_reopen_persistence';
  try {
    const first = open({ name: PERSISTENCE_DB_NAME });
    const firstPort = portForDb(first);
    await firstPort.execute('DROP TABLE IF EXISTS fitrag_val_persist');
    await firstPort.execute(
      'CREATE TABLE fitrag_val_persist (id INTEGER PRIMARY KEY, label TEXT NOT NULL)',
    );
    await firstPort.execute('INSERT INTO fitrag_val_persist (id, label) VALUES (1, ?)', [
      'persisted',
    ]);
    first.close();

    const second = open({ name: PERSISTENCE_DB_NAME });
    const secondPort = portForDb(second);
    const result = await secondPort.execute('SELECT label FROM fitrag_val_persist WHERE id = 1');
    const label = firstValue(result, 'label');
    await secondPort.execute('DROP TABLE IF EXISTS fitrag_val_persist');
    second.close();
    second.delete();

    if (label !== 'persisted') {
      throw new Error(`Expected the label "persisted". Got ${String(label)}.`);
    }
    return {
      name,
      status: 'passed',
      detail: 'the row survived close and reopen',
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      status: 'failed',
      detail: describeError(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Open a scratch database, run the OP-SQLite cases, check close and reopen,
 * then remove the scratch database. The function does not touch user data.
 */
export async function runDatabaseTests(): Promise<DbTestReport[]> {
  const db = open({ name: VALIDATION_DB_NAME });
  const port = portForDb(db);
  const reports: DbTestReport[] = [];
  try {
    reports.push(...(await runDbSuite(port, opSqliteTestCases)));
    reports.push(await runPersistenceCheck());
  } finally {
    await cleanupScratchTables(port).catch(() => undefined);
    db.close();
    db.delete();
  }
  return reports;
}
