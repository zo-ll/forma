import { FormaError } from '../errors.js';
import { canonicalJson } from '../requests/service.js';
import { calendarDate, invalid, objectInput, utcTimestamp } from '../validation.js';
import type { NotesStore } from './ports.js';
import { notesHistoryRevision, requiredNote, storedNote } from './records.js';
import type { NoteHistoryFilter, NoteHistoryInput, NoteHistoryPage, NotePosition } from './types.js';
import { NOTE_LIMITS, noteId, noteKind, noteRevision } from './validation.js';

export function compareNotePositions(a: NotePosition, b: NotePosition): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  const left = Array.from(a.id, (char) => char.codePointAt(0)!);
  const right = Array.from(b.id, (char) => char.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]! - right[i]!;
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

interface Cursor {
  readonly version: 1;
  readonly filter: NoteHistoryFilter;
  readonly revision: number;
  readonly after: NotePosition;
}

const prefix = 'forma-notes-v1:';

function parseCursor(value: unknown, filter: NoteHistoryFilter, search: boolean): Cursor {
  try {
    if (typeof value !== 'string' || !value.startsWith(search ? 'forma-notes-search-v1:' : prefix) || value.length > NOTE_LIMITS.maxCursorCharacters) {
      invalid('cursor', 'Invalid notes cursor.');
    }
    const parsed = JSON.parse(decodeURIComponent(value.slice((search ? 'forma-notes-search-v1:' : prefix).length))) as Cursor;
    objectInput(parsed, ['version', 'filter', 'revision', 'after']);
    objectInput(parsed.filter, search ? ['query', 'dateFrom', 'dateTo', 'kind'] : ['dateFrom', 'dateTo', 'kind']);
    if (parsed.version !== 1 || canonicalJson(parsed.filter) !== canonicalJson(filter)) {
      invalid('cursor', 'The cursor does not match this query.');
    }
    noteRevision(parsed.revision, 'cursor', 0);
    objectInput(parsed.after, ['date', 'createdAt', 'id']);
    calendarDate(parsed.after.date, 'cursor');
    utcTimestamp(parsed.after.createdAt);
    noteId(parsed.after.id, 'cursor');
    return parsed;
  } catch (cause) {
    throw new FormaError('INVALID_INPUT', 'The notes cursor is malformed or mismatched.', { field: 'cursor', cause });
  }
}

function matches(note: NotePosition & { readonly kind: string }, filter: NoteHistoryFilter): boolean {
  return (filter.dateFrom === null || note.date >= filter.dateFrom)
    && (filter.dateTo === null || note.date <= filter.dateTo)
    && (filter.kind === null || note.kind === filter.kind);
}

export async function noteHistory(store: NotesStore, input: NoteHistoryInput, query?: string): Promise<NoteHistoryPage> {
  objectInput(input, ['dateFrom', 'dateTo', 'kind', 'limit', 'cursor']);
  const filter: NoteHistoryFilter = {
    ...(query === undefined ? {} : { query }),
    dateFrom: input.dateFrom === undefined ? null : calendarDate(input.dateFrom, 'dateFrom'),
    dateTo: input.dateTo === undefined ? null : calendarDate(input.dateTo, 'dateTo'),
    kind: input.kind === undefined ? null : noteKind(input.kind),
  };
  if (filter.dateFrom !== null && filter.dateTo !== null && filter.dateFrom > filter.dateTo) {
    invalid('dateTo', 'The end date must not precede the start date.');
  }
  const limit = input.limit === undefined ? NOTE_LIMITS.defaultPageSize : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > NOTE_LIMITS.maxPageSize) {
    invalid('limit', 'The notes page size must be a safe integer from 1 through 100.');
  }
  const cursor = input.cursor === undefined ? null : parseCursor(input.cursor, filter, query !== undefined);
  return store.read(async (reader) => {
    if (query !== undefined && reader.searchNotes === undefined) {
      throw new FormaError('STORAGE_FAILURE', 'This notes store does not provide FTS5 search.');
    }
    const revision = await notesHistoryRevision(reader);
    if (cursor !== null) {
      if (cursor.revision !== revision) {
        throw new FormaError('CONFLICT', 'Notes changed. Restart the query.', { field: 'cursor' });
      }
      let anchor;
      try { anchor = await requiredNote(reader, cursor.after.id); }
      catch (cause) {
        if (!(cause instanceof FormaError) || cause.code !== 'NOT_FOUND') throw cause;
        invalid('cursor', 'The cursor anchor no longer exists.');
      }
      const textMatches = query === undefined || (await reader.searchNotes!({
        filter, query, noteId: anchor.id, limit: 1, after: null,
      })).items.some((item) => item.id === anchor.id);
      if (!textMatches || !matches(anchor, filter) || compareNotePositions(anchor, cursor.after) !== 0) {
        invalid('cursor', 'The cursor anchor does not match this query.');
      }
    }
    const pageQuery = { filter, limit, after: cursor?.after ?? null };
    const page = query === undefined ? await reader.listNotes(pageQuery) : await reader.searchNotes!({ ...pageQuery, query });
    if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
      || page.items.length > limit || (page.hasMore && page.items.length !== limit)) {
      throw new FormaError('STORAGE_FAILURE', 'The notes adapter returned an invalid bounded page.');
    }
    const items = page.items.map(storedNote);
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw new FormaError('STORAGE_FAILURE', 'The notes page repeats a record ID.');
    }
    let previous: NotePosition | null = cursor?.after ?? null;
    for (const item of items) {
      if (!matches(item, filter) || (previous !== null && compareNotePositions(previous, item) >= 0)) {
        throw new FormaError('STORAGE_FAILURE', 'The notes page has invalid filters or order.');
      }
      previous = item;
    }
    const last = items.at(-1);
    const nextCursor = page.hasMore && last ? (query === undefined ? prefix : 'forma-notes-search-v1:') + encodeURIComponent(JSON.stringify({
      version: 1, filter, revision, after: { id: last.id, date: last.date, createdAt: last.createdAt },
    })) : null;
    if (nextCursor !== null && nextCursor.length > NOTE_LIMITS.maxCursorCharacters) {
      invalid('cursor', 'The note identifiers exceed the cursor budget.');
    }
    return { items, filter, revision, nextCursor };
  });
}
