import { FormaError } from './errors.js';

export function invalid(field: string, message: string): never {
  throw new FormaError('INVALID_INPUT', message, { field });
}

export function objectInput(value: unknown, keys: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid('input', 'The input must be an object.');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(key, 'The input has an unsupported field: ' + key + '.');
  }
}

export function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    invalid(field, field + ' must be a non-empty ID without outer whitespace.');
  }
  return value;
}

export function finiteNumber(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    invalid(field, field + ' must be a finite number of at least ' + minimum + '.');
  }
  return value;
}

export function repetitions(value: unknown): number {
  const reps = finiteNumber(value, 'reps', 1);
  if (!Number.isSafeInteger(reps)) invalid('reps', 'Reps must be a positive safe integer.');
  return reps;
}

export function effort(value: unknown): number {
  const rpe = finiteNumber(value, 'rpe', 1);
  if (rpe > 10) invalid('rpe', 'RPE must be between 1 and 10.');
  return rpe;
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field, field + ' must be text.');
  return value;
}

export function calendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid(field, field + ' must be a calendar date in YYYY-MM-DD format.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximum = days[month - 1];
  if (year < 1 || maximum === undefined || day < 1 || day > maximum) {
    invalid(field, field + ' is not a valid calendar date.');
  }
  return value;
}

export function utcTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    invalid('clock', 'The clock must return a UTC timestamp with milliseconds.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid('clock', 'The clock returned an invalid UTC timestamp.');
  }
  return value;
}

export function normalizeExerciseAlias(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid('alias', 'The exercise alias must be non-empty text.');
  }
  return value.trim().replace(/\s+/gu, ' ').toLowerCase();
}
