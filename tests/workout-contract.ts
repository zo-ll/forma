import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { collectWorkoutCases } from './fixtures/workout-cases.js';
import type { Fixture } from './helpers.js';

export function workoutContract(
  label: string,
  fixture: (t: TestContext) => Fixture | Promise<Fixture>,
): void {
  for (const testCase of collectWorkoutCases(assert)) {
    test(label + ': ' + testCase.name, async (t) => testCase.run((await fixture(t)).service));
  }
}
