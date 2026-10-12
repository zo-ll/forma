import type { FormaService } from '@forma/core';

/**
 * A single reusable contract case. Cases hold only plain data and call the
 * public FormaService API. They never create or close a service.
 */
export interface ContractCase {
  readonly name: string;
  readonly ids?: readonly string[];
  run(service: FormaService): Promise<void>;
}

/**
 * The structural assertion surface used by the shared cases. It mirrors the
 * subset of the Node strict assert API that the suites need. Node wrappers
 * pass the strict assert module. A native host passes createPortableAssert().
 */
export interface ContractAssert {
  (value: unknown, message?: string): asserts value;
  equal(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  throws(run: () => unknown, message?: string): void;
  throws(run: () => unknown, validate: (error: unknown) => boolean): void;
  rejects(run: (() => Promise<unknown>) | Promise<unknown>, message?: string): Promise<void>;
  rejects(
    run: (() => Promise<unknown>) | Promise<unknown>,
    validate: (error: unknown) => boolean,
  ): Promise<void>;
}
