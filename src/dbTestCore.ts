// Pure orchestration for the OP-SQLite validation tests. The code uses only
// the DbTestPort interface. Unit tests use a fake port. The real adapter in
// src/dbTest.ts supplies the OP-SQLite connection.

export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = ReadonlyArray<SqlValue>;
export type DbRow = Record<string, unknown>;
export type DbResult = { rows: DbRow[] };

export interface DbTestPort {
  execute(sql: string, params?: SqlParams): Promise<DbResult>;
  transaction(run: (tx: DbTestPort) => Promise<void>): Promise<void>;
}

export type DbTestStatus = 'passed' | 'failed';

export type DbTestReport = {
  name: string;
  status: DbTestStatus;
  detail: string;
  durationMs: number;
};

export interface DbTestCase {
  name: string;
  run(port: DbTestPort): Promise<string>;
}

/** Convert an unknown error into one short line. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Read one cell from the first row. Reject an empty result. */
export function firstValue(result: DbResult, column: string): unknown {
  const row = result.rows[0];
  if (!row || !(column in row)) {
    throw new Error(`The query returned no value for column "${column}".`);
  }
  return row[column];
}

/** Run every test case. One failure does not stop the other cases. */
export async function runDbSuite(
  port: DbTestPort,
  cases: readonly DbTestCase[],
): Promise<DbTestReport[]> {
  const reports: DbTestReport[] = [];
  for (const testCase of cases) {
    const startedAt = Date.now();
    try {
      const detail = await testCase.run(port);
      reports.push({
        name: testCase.name,
        status: 'passed',
        detail,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      reports.push({
        name: testCase.name,
        status: 'failed',
        detail: describeError(error),
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return reports;
}

/** A repeatable vector for the vector tests. */
export function deterministicVector(dimension: number, seed: number): number[] {
  const values: number[] = [];
  for (let index = 0; index < dimension; index += 1) {
    values.push(Math.sin(seed * (index + 1) * 0.01));
  }
  return values;
}

/** Convert a vector to the little-endian float32 BLOB that sqlite-vec needs. */
export function toFloat32Blob(values: readonly number[]): Uint8Array {
  const floats = new Float32Array(values);
  return new Uint8Array(floats.buffer).slice();
}

export const SCRATCH_TABLES = [
  'forma_val_totals',
  'forma_val_fts',
  'forma_val_vec',
  'forma_val_vec_dim',
  'forma_val_tx',
] as const;

/** Drop the scratch tables. The function never touches user data. */
export async function cleanupScratchTables(port: DbTestPort): Promise<void> {
  for (const table of SCRATCH_TABLES) {
    try {
      await port.execute(`DROP TABLE IF EXISTS ${table}`);
    } catch {
      // Best effort. A missing table is not a test failure.
    }
  }
}

export const opSqliteTestCases: readonly DbTestCase[] = [
  {
    name: 'sqlite_version',
    async run(port) {
      const result = await port.execute('SELECT sqlite_version() AS version');
      const version = firstValue(result, 'version');
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error('The SQLite version is empty.');
      }
      return `SQLite ${version}`;
    },
  },
  {
    name: 'deterministic_sql_totals',
    async run(port) {
      await port.execute('DROP TABLE IF EXISTS forma_val_totals');
      await port.execute(
        'CREATE TABLE forma_val_totals (id INTEGER PRIMARY KEY, kcal INTEGER NOT NULL)',
      );
      await port.execute(
        'INSERT INTO forma_val_totals (id, kcal) VALUES (1, 100), (2, 250), (3, 400)',
      );
      const result = await port.execute(
        'SELECT COUNT(*) AS count, SUM(kcal) AS total FROM forma_val_totals',
      );
      const count = Number(firstValue(result, 'count'));
      const total = Number(firstValue(result, 'total'));
      if (count !== 3 || total !== 750) {
        throw new Error(`Expected count 3 and total 750. Got count ${count} and total ${total}.`);
      }
      return 'COUNT=3 SUM=750';
    },
  },
  {
    name: 'fts5_match',
    async run(port) {
      await port.execute('DROP TABLE IF EXISTS forma_val_fts');
      await port.execute(
        'CREATE VIRTUAL TABLE forma_val_fts USING fts5(note_id UNINDEXED, text)',
      );
      await port.execute(
        'INSERT INTO forma_val_fts (note_id, text) VALUES (?, ?)',
        ['N1', 'Mild ache in my left knee after back squats'],
      );
      await port.execute(
        'INSERT INTO forma_val_fts (note_id, text) VALUES (?, ?)',
        ['N3', 'Lunch was salmon, rice, and broccoli'],
      );
      const result = await port.execute(
        'SELECT note_id FROM forma_val_fts WHERE forma_val_fts MATCH ? ORDER BY rank',
        ['knee'],
      );
      const noteId = firstValue(result, 'note_id');
      if (noteId !== 'N1') {
        throw new Error(`Expected note N1. Got ${String(noteId)}.`);
      }
      return 'MATCH knee returns N1';
    },
  },
  {
    name: 'sqlite_vec_version',
    async run(port) {
      const result = await port.execute('SELECT vec_version() AS version');
      const version = firstValue(result, 'version');
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error('The sqlite-vec version is empty.');
      }
      return `sqlite-vec ${version}`;
    },
  },
  {
    name: 'vector_nearest_neighbor_256',
    async run(port) {
      await port.execute('DROP TABLE IF EXISTS forma_val_vec');
      await port.execute('CREATE VIRTUAL TABLE forma_val_vec USING vec0(embedding float[256])');
      const target = deterministicVector(256, 0.13);
      await port.execute('INSERT INTO forma_val_vec (rowid, embedding) VALUES (?, ?)', [
        1,
        toFloat32Blob(deterministicVector(256, 0.11)),
      ]);
      await port.execute('INSERT INTO forma_val_vec (rowid, embedding) VALUES (?, ?)', [
        2,
        toFloat32Blob(target),
      ]);
      await port.execute('INSERT INTO forma_val_vec (rowid, embedding) VALUES (?, ?)', [
        3,
        toFloat32Blob(deterministicVector(256, 0.5)),
      ]);
      const result = await port.execute(
        'SELECT rowid, distance FROM forma_val_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1',
        [toFloat32Blob(target)],
      );
      const rowid = Number(firstValue(result, 'rowid'));
      if (rowid !== 2) {
        throw new Error(`Expected nearest rowid 2. Got ${rowid}.`);
      }
      return 'nearest rowid 2 for a 256-dimension match';
    },
  },
  {
    name: 'vector_dimension_mismatch',
    async run(port) {
      await port.execute('DROP TABLE IF EXISTS forma_val_vec_dim');
      await port.execute(
        'CREATE VIRTUAL TABLE forma_val_vec_dim USING vec0(embedding float[256])',
      );
      let rejected = false;
      try {
        await port.execute('INSERT INTO forma_val_vec_dim (rowid, embedding) VALUES (?, ?)', [
          1,
          toFloat32Blob(deterministicVector(128, 0.2)),
        ]);
      } catch {
        rejected = true;
      }
      if (!rejected) {
        throw new Error('The 128-dimension vector was accepted. The app expects a rejection.');
      }
      return '128-dimension insert rejected';
    },
  },
  {
    name: 'transaction_rollback',
    async run(port) {
      await port.execute('DROP TABLE IF EXISTS forma_val_tx');
      await port.execute('CREATE TABLE forma_val_tx (id INTEGER PRIMARY KEY)');
      await port.execute('INSERT INTO forma_val_tx (id) VALUES (1)');
      let threw = false;
      try {
        await port.transaction(async (tx) => {
          await tx.execute('INSERT INTO forma_val_tx (id) VALUES (2)');
          throw new Error('rollback-marker');
        });
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error('The transaction did not report the error.');
      }
      const result = await port.execute('SELECT COUNT(*) AS count FROM forma_val_tx');
      const count = Number(firstValue(result, 'count'));
      if (count !== 1) {
        throw new Error(`Expected 1 row after rollback. Got ${count}.`);
      }
      return 'rollback kept 1 row';
    },
  },
];
