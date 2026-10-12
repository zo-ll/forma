import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PREFERENCES, MOBILE_THEMES, isMobileTheme, parsePreferences, serializePreferences,
} from '@forma/mobile-host';
import { errorCode } from './helpers.js';

test('default preferences are device-scoped kilograms with a Monday week and system theme', () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    version: 1, dateContext: 'device', weightUnit: 'kg', weekStart: 'monday', theme: 'system',
  });
  assert.equal(Object.isFrozen(DEFAULT_PREFERENCES), true);
  assert.deepEqual(MOBILE_THEMES, ['system', 'light', 'dark']);
});

test('a missing preference record returns the exact defaults', () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.equal(parsePreferences(null), DEFAULT_PREFERENCES);
});

test('serialize and parse round-trip every known theme', () => {
  for (const theme of MOBILE_THEMES) {
    const preferences = { ...DEFAULT_PREFERENCES, theme };
    assert.deepEqual(parsePreferences(serializePreferences(preferences)), preferences);
  }
});

test('serialized text keeps the exact version and field order', () => {
  const text = serializePreferences({ ...DEFAULT_PREFERENCES, theme: 'dark' });
  assert.equal(text, '{"version":1,"dateContext":"device","weightUnit":"kg","weekStart":"monday","theme":"dark"}');
  assert.equal((JSON.parse(text) as { version: unknown }).version, 1);
});

test('corrupt preference text fails with a typed storage error', () => {
  for (const text of ['', '   ', 'not json', '[]', 'null', '42', '"text"', '{}', '{"version":1}']) {
    assert.throws(() => parsePreferences(text), errorCode('STORAGE_FAILURE', 'preferences'));
  }
});

test('unsupported versions and field values fail with a typed storage error', () => {
  const cases: Record<string, unknown>[] = [
    { version: 2, dateContext: 'device', weightUnit: 'kg', weekStart: 'monday', theme: 'system' },
    { version: 1, dateContext: 'utc', weightUnit: 'kg', weekStart: 'monday', theme: 'system' },
    { version: 1, dateContext: 'device', weightUnit: 'lb', weekStart: 'monday', theme: 'system' },
    { version: 1, dateContext: 'device', weightUnit: 'kg', weekStart: 'sunday', theme: 'system' },
    { version: 1, dateContext: 'device', weightUnit: 'kg', weekStart: 'monday', theme: 'midnight' },
    { version: 1, dateContext: 'device', weightUnit: 'kg', weekStart: 'monday' },
  ];
  for (const value of cases) {
    assert.throws(() => parsePreferences(JSON.stringify(value)), errorCode('STORAGE_FAILURE', 'preferences'));
  }
});

test('unknown fields and prototype keys are rejected without pollution', () => {
  const base = '{"version":1,"dateContext":"device","weightUnit":"kg","weekStart":"monday","theme":"system"';
  for (const extra of [',"extra":true', ',"__proto__":{"polluted":true}', ',"constructor":{}}']) {
    assert.throws(() => parsePreferences(base + extra + '}'), errorCode('STORAGE_FAILURE', 'preferences'));
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('preference text is bounded before parsing', () => {
  assert.throws(() => parsePreferences('x'.repeat(5000)), errorCode('STORAGE_FAILURE', 'preferences'));
  assert.throws(() => parsePreferences('x'.repeat(4097)), errorCode('STORAGE_FAILURE', 'preferences'));
});

test('the theme guard accepts exactly the known themes', () => {
  for (const theme of MOBILE_THEMES) assert.equal(isMobileTheme(theme), true);
  for (const value of ['dark ', 'Dark', '', null, undefined, 1, {}, []]) assert.equal(isMobileTheme(value), false);
});
