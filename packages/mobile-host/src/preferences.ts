import { FormaError } from '@forma/core';

export type MobileTheme = 'system' | 'light' | 'dark';

/** The themes the host accepts. The default is the device theme. */
export const MOBILE_THEMES: readonly MobileTheme[] = ['system', 'light', 'dark'];

export interface MobilePreferences {
  readonly version: 1;
  readonly dateContext: 'device';
  readonly weightUnit: 'kg';
  readonly weekStart: 'monday';
  readonly theme: MobileTheme;
}

export const DEFAULT_PREFERENCES: MobilePreferences = Object.freeze({
  version: 1,
  dateContext: 'device',
  weightUnit: 'kg',
  weekStart: 'monday',
  theme: 'system',
});

/** Bounds the persisted text before parsing. */
const MAX_PREFERENCE_TEXT_LENGTH = 4096;
const KNOWN_FIELDS = new Set(['version', 'dateContext', 'weightUnit', 'weekStart', 'theme']);

function preferenceFailure(message: string, cause?: unknown): FormaError {
  return new FormaError('STORAGE_FAILURE', message, { field: 'preferences', cause });
}

export function isMobileTheme(value: unknown): value is MobileTheme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Parse one persisted preference record. A missing record returns the defaults.
 * Corrupt, unknown, or newer records produce a typed failure and keep the bytes.
 */
export function parsePreferences(text: string | null): MobilePreferences {
  if (text === null) return DEFAULT_PREFERENCES;
  if (typeof text !== 'string' || text.length === 0) {
    throw preferenceFailure('The preference record is empty or not text.');
  }
  if (text.length > MAX_PREFERENCE_TEXT_LENGTH) {
    throw preferenceFailure('The preference record is too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw preferenceFailure('The preference record is not valid JSON.', cause);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw preferenceFailure('The preference record is not an object.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_FIELDS.has(key)) throw preferenceFailure('The preference record has an unknown field: ' + key + '.');
  }
  if (record.version !== 1) {
    throw preferenceFailure('The preference record version is not supported.');
  }
  if (record.dateContext !== 'device') {
    throw preferenceFailure('The preference record date context is not supported.');
  }
  if (record.weightUnit !== 'kg') {
    throw preferenceFailure('The preference record weight unit is not supported.');
  }
  if (record.weekStart !== 'monday') {
    throw preferenceFailure('The preference record week start is not supported.');
  }
  if (!isMobileTheme(record.theme)) {
    throw preferenceFailure('The preference record theme is not supported.');
  }
  return Object.freeze({
    version: 1,
    dateContext: 'device',
    weightUnit: 'kg',
    weekStart: 'monday',
    theme: record.theme,
  });
}

/** Serialize exactly the known fields in a stable order. */
export function serializePreferences(preferences: MobilePreferences): string {
  return JSON.stringify({
    version: preferences.version,
    dateContext: preferences.dateContext,
    weightUnit: preferences.weightUnit,
    weekStart: preferences.weekStart,
    theme: preferences.theme,
  });
}
