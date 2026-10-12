import {
  cleanupScratchTables,
  describeError,
  deterministicVector,
  firstValue,
  opSqliteTestCases,
  runDbSuite,
  toFloat32Blob,
  type DbTestCase,
  type DbTestPort,
} from '../src/dbTestCore';

function createFakePort(): DbTestPort {
  return {
    async execute() {
      return { rows: [] };
    },
    async transaction(run) {
      await run(createFakePort());
    },
  };
}

// A DbTestCase alias keeps the fake cases independent of the SQL cases.
const fakeCase = (name: string, run: DbTestCase['run']): DbTestCase => ({ name, run });

describe('runDbSuite', () => {
  it('reports pass and fail and continues after a failure', async () => {
    const reports = await runDbSuite(createFakePort(), [
      fakeCase('first', async () => 'ok'),
      fakeCase('second', async () => {
        throw new Error('boom');
      }),
      fakeCase('third', async () => 'after'),
    ]);

    expect(reports.map((report) => report.name)).toEqual(['first', 'second', 'third']);
    expect(reports.map((report) => report.status)).toEqual(['passed', 'failed', 'passed']);
    expect(reports[1].detail).toBe('boom');
    expect(reports[2].detail).toBe('after');
  });

  it('returns an empty list for no cases', async () => {
    await expect(runDbSuite(createFakePort(), [])).resolves.toEqual([]);
  });
});

describe('describeError', () => {
  it('reads the message from an Error', () => {
    expect(describeError(new Error('nope'))).toBe('nope');
  });

  it('converts a non-Error value', () => {
    expect(describeError('plain')).toBe('plain');
  });
});

describe('firstValue', () => {
  it('returns the cell', () => {
    expect(firstValue({ rows: [{ count: 3 }] }, 'count')).toBe(3);
  });

  it('rejects an empty result', () => {
    expect(() => firstValue({ rows: [] }, 'count')).toThrow('no value');
  });

  it('rejects a missing column', () => {
    expect(() => firstValue({ rows: [{ other: 1 }] }, 'count')).toThrow('no value');
  });
});

describe('toFloat32Blob', () => {
  it('makes four bytes per value and round-trips', () => {
    const values = deterministicVector(256, 0.3);
    const blob = toFloat32Blob(values);
    expect(blob).toHaveLength(256 * 4);
    const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    expect(floats).toHaveLength(256);
    expect(floats[0]).toBeCloseTo(values[0], 5);
  });
});

describe('deterministicVector', () => {
  it('is repeatable and has the requested length', () => {
    const first = deterministicVector(256, 0.13);
    const second = deterministicVector(256, 0.13);
    expect(first).toHaveLength(256);
    expect(first).toEqual(second);
  });
});

describe('opSqliteTestCases', () => {
  it('lists the required OP-SQLite checks', () => {
    const names = opSqliteTestCases.map((testCase) => testCase.name);
    expect(names).toEqual([
      'sqlite_version',
      'deterministic_sql_totals',
      'fts5_match',
      'sqlite_vec_version',
      'vector_nearest_neighbor_256',
      'vector_dimension_mismatch',
      'transaction_rollback',
    ]);
  });
});

describe('cleanupScratchTables', () => {
  it('drops every scratch table and ignores an error', async () => {
    const dropped: string[] = [];
    const port: DbTestPort = {
      async execute(sql) {
        dropped.push(sql);
        if (sql.includes('forma_val_fts')) {
          throw new Error('missing');
        }
        return { rows: [] };
      },
      async transaction(run) {
        await run(port);
      },
    };
    await cleanupScratchTables(port);
    expect(dropped).toHaveLength(5);
    expect(dropped[0]).toContain('forma_val_totals');
  });
});
