import { identifier, invalid, objectInput, calendarDate, utcTimestamp } from '../validation.js';
import type { Note, NoteKind, NoteRecord } from './types.js';

export const NOTE_LIMITS = Object.freeze({
  maxTextCharacters: 16_384,
  maxIdCharacters: 256,
  maxSearchQueryCharacters: 512,
  defaultPageSize: 20,
  maxPageSize: 100,
  maxCursorCharacters: 8_192,
});

export function noteId(value: unknown, field = 'noteId'): string {
  const id = identifier(value, field);
  if (id.length > NOTE_LIMITS.maxIdCharacters || /[\u0000\uD800-\uDFFF]/u.test(id)) {
    invalid(field, 'A note ID must be bounded valid Unicode without NUL.');
  }
  return id;
}

export function noteText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0
    || value.length > NOTE_LIMITS.maxTextCharacters || /[\u0000\uD800-\uDFFF]/u.test(value)) {
    invalid('text', 'Note text must be nonempty bounded valid Unicode without NUL.');
  }
  return value;
}

export function noteKind(value: unknown): NoteKind {
  if (value !== 'general' && value !== 'pain' && value !== 'sleep' && value !== 'personal-best') {
    invalid('kind', 'The note kind is not supported.');
  }
  return value;
}

export function noteRevision(value: unknown, field = 'expectedRevision', minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid(field, 'The revision must be a safe integer of at least ' + minimum + '.');
  }
  return value;
}

/** Validate primary rows and make a detached DTO with a computed exact source. */
export function noteFromRecord(value: unknown): Note {
  objectInput(value, ['id', 'date', 'text', 'kind', 'revision', 'createdAt', 'updatedAt']);
  const row = value as NoteRecord;
  const id = noteId(row.id, 'id');
  const revision = noteRevision(row.revision, 'revision');
  return {
    id, date: calendarDate(row.date, 'date'), text: noteText(row.text), kind: noteKind(row.kind),
    revision, createdAt: utcTimestamp(row.createdAt), updatedAt: utcTimestamp(row.updatedAt),
    source: { module: 'notes', noteId: id, revision },
  };
}
