import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { collectSessionCases } from './fixtures/session-cases.js';
import type { Fixture } from './helpers.js';

export function sessionContract(
  label: string,
  fixture: (t: TestContext) => Fixture | Promise<Fixture>,
): void {
  for (const testCase of collectSessionCases(assert)) {
    test(label + ': ' + testCase.name, async (t) => testCase.run((await fixture(t)).service));
  }
}
