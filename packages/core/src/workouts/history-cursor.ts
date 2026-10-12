import { FormaError } from '../errors.js';
import { WORKOUT_HISTORY_LIMITS } from './history-limits.js';
import { calendarDate, identifier, invalid, objectInput, utcTimestamp } from '../validation.js';
import type { HistoryFilter, HistoryPosition } from './history-types.js';

interface HistoryCursor {
  readonly version: 1;
  readonly filter: HistoryFilter;
  readonly revision: number;
  readonly after: HistoryPosition;
}
const prefix = 'forma-history-v1:';

export function historyCursor(filter: HistoryFilter, revision: number, after: HistoryPosition): string {
  const cursor = prefix + encodeURIComponent(JSON.stringify({ version: 1, filter, revision, after }));
  if (cursor.length > WORKOUT_HISTORY_LIMITS.maxCursorCharacters) invalid('cursor', 'The stored identifiers are too large for a history cursor.');
  return cursor;
}

export function parseHistoryCursor(value: unknown, filter: HistoryFilter): HistoryCursor {
  try {
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > WORKOUT_HISTORY_LIMITS.maxCursorCharacters) invalid('cursor', 'Invalid history cursor.');
    const parsed = JSON.parse(decodeURIComponent(value.slice(prefix.length))) as HistoryCursor;
    objectInput(parsed, ['version', 'filter', 'revision', 'after']);
    objectInput(parsed.filter, ['dateFrom', 'dateTo', 'exerciseId', 'status']);
    if (parsed.version !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0
      || JSON.stringify({ dateFrom: parsed.filter.dateFrom, dateTo: parsed.filter.dateTo,
        exerciseId: parsed.filter.exerciseId, status: parsed.filter.status }) !== JSON.stringify(filter)) {
      invalid('cursor', 'The cursor does not match this history query.');
    }
    objectInput(parsed.after, ['date', 'createdAt', 'id']);
    calendarDate(parsed.after.date, 'cursor');
    utcTimestamp(parsed.after.createdAt);
    identifier(parsed.after.id, 'cursor');
    return parsed;
  } catch (cause) {
    if (cause instanceof FormaError && cause.field === 'cursor') throw cause;
    throw new FormaError('INVALID_INPUT', 'The history cursor is malformed.', { field: 'cursor', cause });
  }
}
