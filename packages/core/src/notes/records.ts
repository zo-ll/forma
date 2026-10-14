import { FormaError } from '../errors.js';
import type { NotesReader } from './ports.js';
import type { Note } from './types.js';
import { noteFromRecord, noteRevision } from './validation.js';

export function storedNote(value: unknown): Note {
  try { return noteFromRecord(value); }
  catch (cause) {
    throw new FormaError('STORAGE_FAILURE', 'The stored note is invalid.', { cause });
  }
}

export async function requiredNote(reader: NotesReader, id: string): Promise<Note> {
  const record = await reader.getNote(id);
  if (record === null) throw new FormaError('NOT_FOUND', 'The note does not exist.', { field: 'noteId' });
  const note = storedNote(record);
  if (note.id !== id) throw new FormaError('STORAGE_FAILURE', 'The stored note has a different ID.');
  return note;
}

export async function notesHistoryRevision(reader: NotesReader): Promise<number> {
  const value = await reader.getNotesHistoryRevision();
  try { return noteRevision(value, 'revision', 0); }
  catch (cause) {
    throw new FormaError('STORAGE_FAILURE', 'The notes history revision is invalid.', { cause });
  }
}

export function expectRevision(note: Note, expected: number): void {
  if (note.revision !== expected) {
    throw new FormaError('CONFLICT', 'The note changed. Retrieve it before editing.', { field: 'expectedRevision' });
  }
}
