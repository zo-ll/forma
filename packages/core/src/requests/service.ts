import { FormaError } from '../errors.js';
import type { RequestWriter } from '../ports.js';
import { identifier, invalid } from '../validation.js';

export interface ResultCodec<T> {
  parse(value: unknown): T;
}

/** Only validated, normalized DTOs belong in a command signature. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + Array.from(value, canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().filter((key) => object[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}';
  }
  throw new FormaError('INVALID_INPUT', 'The normalized command input must contain JSON values.');
}

function parseResult<T>(json: string, codec: ResultCodec<T>): T {
  try { return codec.parse(JSON.parse(json) as unknown); }
  catch (cause) {
    throw new FormaError('STORAGE_FAILURE', 'The saved request result is invalid.', { cause });
  }
}

/** A module supplies its writer capabilities and result codec; the receipt contract stays shared. */
export function withRequest<W extends RequestWriter, T>(
  store: { write<R>(run: (writer: W) => Promise<R>): Promise<R> },
  requestId: string,
  operation: string,
  input: Readonly<Record<string, unknown>>,
  codec: ResultCodec<T>,
  run: (writer: W) => Promise<T>,
): Promise<T> {
  for (const [field, value] of [['requestId', requestId], ['operation', operation]] as const) {
    identifier(value, field);
    if (/[\u0000\uD800-\uDFFF]/u.test(value)) invalid(field, field + ' must contain valid Unicode characters without NUL.');
  }
  // Capture the signature before the store queues this command.
  const inputSignature = canonicalJson(input);
  return store.write(async (writer) => {
    const existing = await writer.getRequestReceipt(requestId);
    if (existing) {
      if (existing.formatVersion !== 1 || existing.requestId !== requestId) {
        throw new FormaError('STORAGE_FAILURE', 'The request receipt format is not supported.');
      }
      if (existing.operation !== operation || existing.inputSignature !== inputSignature) {
        throw new FormaError('CONFLICT', 'The requestId already identifies a different command.', { field: 'requestId' });
      }
      return parseResult(existing.resultJson, codec);
    }
    const result = await run(writer);
    const resultJson = JSON.stringify(result === undefined ? null : result);
    if (resultJson === undefined) throw new FormaError('STORAGE_FAILURE', 'The command result must contain JSON values.');
    const original = parseResult(resultJson, codec);
    await writer.saveRequestReceipt({ requestId, operation, inputSignature, resultJson, formatVersion: 1 });
    return original;
  });
}
