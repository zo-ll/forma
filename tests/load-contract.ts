import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { collectLoadCases } from './fixtures/load-cases.js';
import type { Fixture } from './helpers.js';

export function loadContract(
  label: string,
  fixture: (t: TestContext) => Fixture | Promise<Fixture>,
): void {
  for (const testCase of collectLoadCases(assert)) {
    test(label + ': ' + testCase.name, async (t) => testCase.run((await fixture(t)).service));
  }
}
