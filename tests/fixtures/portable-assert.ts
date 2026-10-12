import type { ContractAssert } from './contract-types.js';

function describe(value: unknown): string {
  if (typeof value === 'string') return "'" + value + "'";
  if (typeof value === 'bigint') return value + 'n';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return 'an array of length ' + value.length;
    return 'an object';
  }
  return String(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function deepEqualValue(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== 'object' || typeof expected !== 'object') return false;
  if (actual === null || expected === null) return false;

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
    if (actual.length !== expected.length) return false;
    for (let index = 0; index < actual.length; index++) {
      if (Object.hasOwn(actual, index) !== Object.hasOwn(expected, index)) return false;
      if (Object.hasOwn(actual, index) && !deepEqualValue(actual[index], expected[index])) return false;
    }
    return true;
  }

  if (actual instanceof Date || expected instanceof Date) {
    return actual instanceof Date && expected instanceof Date && Object.is(actual.getTime(), expected.getTime());
  }

  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;

  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  for (const key of actualKeys) {
    if (!Object.hasOwn(expected, key)) return false;
    if (!deepEqualValue((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key])) return false;
  }
  return true;
}

function validateError(validate: unknown, error: unknown): void {
  if (validate === undefined || typeof validate === 'string') return;
  if (typeof validate !== 'function') fail('The contract validate argument must be a function.');
  if (!(validate as (thrown: unknown) => boolean)(error)) {
    fail('The operation failed with an unexpected error: ' + describe(error));
  }
}

/**
 * A Node-free implementation of the contract assertion surface. It is
 * deliberately small: deep equality covers primitives, arrays, plain objects,
 * and dates, and it keeps the same distinctions as deepStrictEqual for
 * undefined, null, NaN, negative zero, and array length.
 */
export function createPortableAssert(): ContractAssert {
  function assert(value: unknown, message?: string): asserts value {
    if (!value) fail(message ?? 'Expected a truthy value but received ' + describe(value) + '.');
  }

  assert.equal = (actual: unknown, expected: unknown, message?: string): void => {
    if (!Object.is(actual, expected)) {
      fail((message ?? 'Expected equality') + ': ' + describe(actual) + ' !== ' + describe(expected) + '.');
    }
  };

  assert.notEqual = (actual: unknown, expected: unknown, message?: string): void => {
    if (Object.is(actual, expected)) {
      fail((message ?? 'Expected inequality') + ': both values are ' + describe(actual) + '.');
    }
  };

  assert.deepEqual = (actual: unknown, expected: unknown, message?: string): void => {
    if (!deepEqualValue(actual, expected)) {
      fail((message ?? 'Expected deep equality') + ': ' + describe(actual) + ' !== ' + describe(expected) + '.');
    }
  };

  assert.throws = (run: () => unknown, validate?: unknown): void => {
    let thrown = false;
    let error: unknown;
    try {
      run();
    } catch (cause) {
      thrown = true;
      error = cause;
    }
    if (!thrown) fail(typeof validate === 'string' ? validate : 'Expected the operation to throw but it returned normally.');
    validateError(validate, error);
  };

  assert.rejects = async (
    run: (() => Promise<unknown>) | Promise<unknown>,
    validate?: unknown,
  ): Promise<void> => {
    let rejected = false;
    let error: unknown;
    try {
      await (typeof run === 'function' ? run() : run);
    } catch (cause) {
      rejected = true;
      error = cause;
    }
    if (!rejected) fail(typeof validate === 'string' ? validate : 'Expected the operation to reject but its promise fulfilled.');
    validateError(validate, error);
  };

  return assert;
}
