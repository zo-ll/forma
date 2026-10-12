import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCalendarRange } from '@forma/core';
import type { CalendarRangeInput } from '@forma/core';
import { errorCode } from './helpers.js';

function range(nowUtc: string, timeZone = 'UTC', period: CalendarRangeInput['period'] = 'today') {
  return resolveCalendarRange({ nowUtc, timeZone, period });
}

const cases: [string, string, CalendarRangeInput['period'], string, string][] = [
  ['2026-10-12T00:00:00.000Z', 'UTC', 'today', '2026-10-12', '2026-10-12'],
  ['2026-10-11T23:59:59.999Z', 'UTC', 'today', '2026-10-11', '2026-10-11'],
  ['2026-10-11T22:00:00.000Z', 'Europe/Rome', 'today', '2026-10-12', '2026-10-12'],
  ['2026-10-11T21:59:59.999Z', 'Europe/Rome', 'today', '2026-10-11', '2026-10-11'],
  ['2026-10-12T12:00:00.000Z', 'UTC', 'this-week', '2026-10-12', '2026-10-18'],
  ['2026-10-18T23:59:59.999Z', 'UTC', 'this-week', '2026-10-12', '2026-10-18'],
  ['2026-10-19T00:00:00.000Z', 'UTC', 'this-week', '2026-10-19', '2026-10-25'],
  ['2026-10-12T12:00:00.000Z', 'UTC', 'last-week', '2026-10-05', '2026-10-11'],
  ['2026-01-01T12:00:00.000Z', 'UTC', 'this-week', '2025-12-29', '2026-01-04'],
  ['2026-01-01T12:00:00.000Z', 'UTC', 'last-week', '2025-12-22', '2025-12-28'],
  ['2024-02-29T12:00:00.000Z', 'UTC', 'today', '2024-02-29', '2024-02-29'],
  ['2024-03-01T12:00:00.000Z', 'UTC', 'this-week', '2024-02-26', '2024-03-03'],
  ['2000-02-29T12:00:00.000Z', 'UTC', 'today', '2000-02-29', '2000-02-29'],
  ['1900-03-01T00:00:00.000Z', 'UTC', 'today', '1900-03-01', '1900-03-01'],
  ['2026-03-29T00:59:59.999Z', 'Europe/Rome', 'this-week', '2026-03-23', '2026-03-29'],
  ['2026-03-29T01:00:00.000Z', 'Europe/Rome', 'this-week', '2026-03-23', '2026-03-29'],
  ['2026-10-25T00:59:59.999Z', 'Europe/Rome', 'this-week', '2026-10-19', '2026-10-25'],
  ['2026-10-25T01:00:00.000Z', 'Europe/Rome', 'this-week', '2026-10-19', '2026-10-25'],
  ['2026-03-29T22:00:00.000Z', 'Europe/Rome', 'last-week', '2026-03-23', '2026-03-29'],
  ['2026-10-25T23:00:00.000Z', 'Europe/Rome', 'last-week', '2026-10-19', '2026-10-25'],
  ['2026-10-12T18:15:00.000Z', 'Asia/Kathmandu', 'today', '2026-10-13', '2026-10-13'],
  ['2026-10-12T10:00:00.000Z', 'Pacific/Kiritimati', 'today', '2026-10-13', '2026-10-13'],
  ['0099-10-12T12:00:00.000Z', 'UTC', 'today', '0099-10-12', '0099-10-12'],
];
for (const [instant, zone, period, from, to] of cases) {
  test('calendar ' + instant + ' ' + zone + ' ' + period, () => {
    assert.deepEqual(range(instant, zone, period), {
      dateFrom: from, dateTo: to, timeZone: zone, weekStartsOn: 'monday', period,
    });
  });
}

test('a device timezone change changes relative dates but not the supplied instant', () => {
  const instant = '2026-10-12T00:30:00.000Z';
  assert.equal(range(instant, 'Europe/Rome').dateFrom, '2026-10-12');
  assert.equal(range(instant, 'America/New_York').dateFrom, '2026-10-11');
  assert.equal(range(instant, 'Europe/Rome', 'this-week').dateFrom, '2026-10-12');
  assert.equal(range(instant, 'America/New_York', 'this-week').dateFrom, '2026-10-05');
});

const invalidCases: [Record<string, unknown>, string][] = [
  [{ timeZone: '' }, 'timeZone'], [{ timeZone: ' Europe/Rome' }, 'timeZone'],
  [{ timeZone: 'Not/AZone' }, 'timeZone'], [{ timeZone: '+02:00' }, 'timeZone'],
  [{ timeZone: null }, 'timeZone'], [{ period: 'rolling-week' }, 'period'],
  [{ period: null }, 'period'], [{ nowUtc: '2026-02-29T00:00:00.000Z' }, 'clock'],
  [{ nowUtc: '2026-10-12T00:00:00Z' }, 'clock'], [{ unexpected: true }, 'unexpected'],
];
for (const [patch, field] of invalidCases) {
  test('calendar rejects ' + JSON.stringify(patch), () => {
    assert.throws(() => resolveCalendarRange({
      nowUtc: '2026-10-12T12:00:00.000Z', timeZone: 'UTC', period: 'today', ...patch,
    } as CalendarRangeInput), errorCode('INVALID_INPUT', field));
  });
}

test('calendar rejects null input and dates outside the supported calendar range', () => {
  assert.throws(() => resolveCalendarRange(null as unknown as CalendarRangeInput), errorCode('INVALID_INPUT', 'input'));
  assert.throws(() => range('0001-01-01T00:00:00.000Z', 'America/New_York'), errorCode('INVALID_INPUT', 'date'));
  assert.throws(() => range('0001-01-01T12:00:00.000Z', 'UTC', 'last-week'), errorCode('INVALID_INPUT', 'date'));
  assert.throws(() => range('9999-12-31T12:00:00.000Z', 'UTC', 'this-week'), errorCode('INVALID_INPUT', 'date'));
});
