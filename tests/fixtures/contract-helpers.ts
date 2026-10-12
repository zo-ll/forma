import { FormaError } from '@forma/core';

export const TEST_TIME = '2026-10-12T09:00:00.000Z';

let request = 0;
export function nextRequestId(): string {
  return 'portable-request-' + ++request;
}

export function errorCode(code: FormaError['code'], field?: string): (error: unknown) => boolean {
  return (error) => error instanceof FormaError && error.code === code
    && (field === undefined || error.field === field);
}

/** A Node-free replacement for structuredClone that covers plain core DTOs. */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) result[key] = cloneValue((value as Record<string, unknown>)[key]);
    return result as T;
  }
  return value;
}
