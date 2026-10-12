import { calendarDate, invalid, objectInput, utcTimestamp } from './validation.js';

export type CalendarPeriod = 'today' | 'this-week' | 'last-week';

export interface CalendarRangeInput {
  readonly nowUtc: string;
  readonly timeZone: string;
  readonly period: CalendarPeriod;
}

export interface CalendarRange {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly timeZone: string;
  readonly weekStartsOn: 'monday';
  readonly period: CalendarPeriod;
}

function dateText(date: Date): string {
  const text = date.toISOString().slice(0, 10);
  return calendarDate(text, 'date');
}

function shift(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** The host supplies a snapshot of the current device timezone and UTC clock. */
export function resolveCalendarRange(input: CalendarRangeInput): CalendarRange {
  objectInput(input, ['nowUtc', 'timeZone', 'period']);
  const instant = utcTimestamp(input.nowUtc);
  const timeZone = input.timeZone;
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.trim() !== timeZone
    || /^[+-]/.test(timeZone)) {
    invalid('timeZone', 'An IANA timezone name is required.');
  }
  if (!['today', 'this-week', 'last-week'].includes(input.period)) {
    invalid('period', 'The calendar period is not supported.');
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', era: 'short',
    }).formatToParts(new Date(instant));
  } catch {
    invalid('timeZone', 'The timezone is unavailable or invalid.');
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? '';
  if (part('era') !== 'AD') invalid('date', 'The local calendar date is outside the supported year range.');
  const today = calendarDate(part('year').padStart(4, '0') + '-' + part('month') + '-' + part('day'), 'date');
  // Use UTC only as a carrier for Gregorian calendar arithmetic. Do not add 24h to local instants.
  const date = new Date(today + 'T00:00:00.000Z');
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = input.period === 'today' ? date
    : shift(date, -mondayOffset - (input.period === 'last-week' ? 7 : 0));
  const end = input.period === 'today' ? date : shift(start, 6);
  return {
    dateFrom: dateText(start), dateTo: dateText(end), timeZone,
    weekStartsOn: 'monday', period: input.period,
  };
}
