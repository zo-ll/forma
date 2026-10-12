import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NATIVE_STORAGE_CASES } from './fixtures/native-storage-cases.js';
import type { OpSqliteDatabase } from '@forma/adapters/android';

// Exercise shared diagnostic cases in Node before device execution. This is not Android proof.
for (const item of NATIVE_STORAGE_CASES) {
  test('Node shim diagnostic: ' + item.name, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'forma-native-diagnostic-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await item.run(({ name }): OpSqliteDatabase => {
      const db = new DatabaseSync(join(directory, name));
      return { close: () => db.close(), executeSync: (sql, parameters = []) => {
        try { return { rows: db.prepare(sql).all(...parameters) }; }
        catch (cause) {
          if (cause !== null && typeof cause === 'object' && 'errcode' in cause && typeof cause.errcode === 'number') {
            throw Object.assign(new Error('OP-style error', { cause }), { code: cause.errcode & 255, extendedCode: cause.errcode });
          }
          throw cause;
        }
      } };
    });
  });
}
