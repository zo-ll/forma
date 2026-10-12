import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { Fixture } from './helpers.js';
import { HISTORY_CASES } from './fixtures/history-cases.js';

export function historyContract(label: string,
  fixture: (t: TestContext, ids?: readonly string[]) => Fixture | Promise<Fixture>): void {
  for (const item of HISTORY_CASES) {
    test(label + ': ' + item.name, async (t) => item.run((await fixture(t, item.ids)).service));
  }
}
