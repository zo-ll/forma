import nodeAssert from 'node:assert/strict';
import { test } from 'node:test';
import { createPortableAssert } from './fixtures/portable-assert.js';
import type { ContractAssert } from './fixtures/contract-types.js';
import { collectLoadCases } from './fixtures/load-cases.js';
import { collectRequestCases } from './fixtures/request-cases.js';
import { collectSessionCases } from './fixtures/session-cases.js';
import { collectWorkoutCases } from './fixtures/workout-cases.js';
import { memoryFixture } from './helpers.js';

test('portable assertions accept matching values and reject mismatches', () => {
  const portable: ContractAssert = createPortableAssert();
  for (const value of [true, 1, -1, 'text', [], {}, Infinity]) portable(value);
  for (const value of [false, 0, -0, '', null, undefined, NaN]) {
    nodeAssert.throws(() => portable(value));
  }
  portable.equal(1, 1);
  portable.equal(NaN, NaN);
  portable.equal(null, null);
  portable.equal(undefined, undefined);
  nodeAssert.throws(() => portable.equal(1, 2));
  nodeAssert.throws(() => portable.equal(-0, 0));
  nodeAssert.throws(() => portable.equal(null, undefined));
  portable.notEqual(1, 2);
  nodeAssert.throws(() => portable.notEqual(1, 1));

  const maybe: { readonly name: string } | null = { name: 'narrowed' };
  portable(maybe);
  nodeAssert.equal(maybe.name, 'narrowed');
});

test('deep equality ignores property order but keeps the exact key set', () => {
  const portable: ContractAssert = createPortableAssert();
  portable.deepEqual({ a: 1, b: 2, c: 3 }, { c: 3, a: 1, b: 2 });
  nodeAssert.throws(() => portable.deepEqual({ a: 1 }, { a: 1, b: 2 }));
  nodeAssert.throws(() => portable.deepEqual({ a: 1, b: 2 }, { a: 1 }));
  nodeAssert.throws(() => portable.deepEqual({ a: undefined }, {}));
  portable.deepEqual({ a: undefined }, { a: undefined });
  const nested = { outer: { list: [1, 2, 3], flag: true } };
  portable.deepEqual(nested, { outer: { flag: true, list: [1, 2, 3] } });
  nodeAssert.throws(() => portable.deepEqual(nested, { outer: { flag: false, list: [1, 2, 3] } }));
});

test('deep equality compares arrays in order and by length', () => {
  const portable: ContractAssert = createPortableAssert();
  portable.deepEqual([1, 2, 3], [1, 2, 3]);
  portable.deepEqual([], []);
  portable.deepEqual([[1], [2]], [[1], [2]]);
  nodeAssert.throws(() => portable.deepEqual([1, 2, 3], [3, 2, 1]));
  nodeAssert.throws(() => portable.deepEqual([1, 2], [1, 2, 3]));
  nodeAssert.throws(() => portable.deepEqual([1, 2, 3], [1, 2]));
  nodeAssert.throws(() => portable.deepEqual([1, 2], { 0: 1, 1: 2 }));
  const values: unknown[] = [];
  values.push(undefined);
  portable.deepEqual(values, [undefined]);
});

test('deep equality keeps undefined, null, NaN, and negative zero distinct', () => {
  const portable: ContractAssert = createPortableAssert();
  portable.deepEqual(undefined, undefined);
  portable.deepEqual(null, null);
  nodeAssert.throws(() => portable.deepEqual(undefined, null));
  nodeAssert.throws(() => portable.deepEqual(null, undefined));
  portable.deepEqual(NaN, NaN);
  nodeAssert.throws(() => portable.deepEqual(NaN, 0));
  nodeAssert.throws(() => portable.deepEqual(NaN, null));
  portable.deepEqual(-0, -0);
  nodeAssert.throws(() => portable.deepEqual(-0, 0));
  nodeAssert.throws(() => portable.deepEqual({ value: -0 }, { value: 0 }));
  nodeAssert.throws(() => portable.deepEqual([-0], [0]));
  portable.deepEqual(-Infinity, -Infinity);
  nodeAssert.throws(() => portable.deepEqual(Infinity, -Infinity));
});

test('deep equality compares dates and plain-object prototypes', () => {
  const portable: ContractAssert = createPortableAssert();
  portable.deepEqual(new Date(0), new Date(0));
  nodeAssert.throws(() => portable.deepEqual(new Date(0), new Date(1)));
  nodeAssert.throws(() => portable.deepEqual(new Date(0), {}));
});

test('synchronous throws use predicates and detect missing exceptions', () => {
  const portable: ContractAssert = createPortableAssert();
  const boom = new Error('boom');
  portable.throws(() => { throw boom; });
  portable.throws(() => { throw boom; }, (error) => error === boom);
  nodeAssert.throws(() => portable.throws(() => undefined));
  nodeAssert.throws(() => portable.throws(() => { throw boom; }, () => false));
  nodeAssert.throws(() => portable.throws(() => { throw boom; }, (error) => error instanceof RangeError));
});

test('asynchronous rejects use predicates and detect fulfilled promises', async () => {
  const portable: ContractAssert = createPortableAssert();
  const boom = new Error('boom');
  await portable.rejects(Promise.reject(boom));
  await portable.rejects(async () => { throw boom; });
  await portable.rejects(Promise.reject(boom), (error) => error === boom);
  await nodeAssert.rejects(portable.rejects(Promise.resolve('value')));
  await nodeAssert.rejects(portable.rejects(Promise.reject(boom), () => false));
  await nodeAssert.rejects(portable.rejects(Promise.reject(boom), (error) => error instanceof RangeError));
});

test('the portable assertion executes every extracted contract case', async (t) => {
  const portable: ContractAssert = createPortableAssert();
  const collectors = [collectWorkoutCases, collectRequestCases, collectLoadCases, collectSessionCases];
  let executed = 0;
  for (const collect of collectors) {
    for (const contractCase of collect(portable)) {
      const fixture = await memoryFixture(t);
      await contractCase.run(fixture.service);
      executed++;
    }
  }
  nodeAssert.equal(executed, 116);
});
