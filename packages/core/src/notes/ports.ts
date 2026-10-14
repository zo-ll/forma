import type { Clock, IdGenerator, RequestReader, RequestWriter } from '../ports.js';
import type { NoteHistoryFilter, NotePosition, NoteRecord } from './types.js';
import type { NoteFieldConfirmation } from './field-types.js';

export interface NotesStoreQuery {
  readonly filter: NoteHistoryFilter;
  readonly after: NotePosition | null;
  readonly limit: number;
}

export interface NotesSearchQuery extends NotesStoreQuery {
  readonly query: string;
  /** Used only to validate a cursor anchor against the same FTS query. */
  readonly noteId?: string;
}

export interface NotesStorePage {
  readonly items: readonly NoteRecord[];
  readonly hasMore: boolean;
}

export interface NotesReader extends RequestReader {
  getNote(noteId: string): Promise<NoteRecord | null>;
  getNoteConfirmation(noteId: string): Promise<NoteFieldConfirmation | null>;
  /** Includes deleted IDs. Source identities must never be reused. */
  hasNoteId(noteId: string): Promise<boolean>;
  getNotesHistoryRevision(): Promise<number>;
  listNotes(input: NotesStoreQuery): Promise<NotesStorePage>;
  /** Optional for standalone portable stores. Durable Forma adapters provide FTS5. */
  searchNotes?(input: NotesSearchQuery): Promise<NotesStorePage>;
}

export interface NotesWriter extends NotesReader, RequestWriter {
  /** Reserve a new ID and advance notes history revision atomically with this write. */
  saveNote(note: NoteRecord): Promise<void>;
  /** The primary note must already have the exact confirmation source revision. */
  saveNoteConfirmation(confirmation: NoteFieldConfirmation): Promise<void>;
  clearNoteConfirmation(noteId: string): Promise<void>;
  /** Remove the primary record, retain its ID reservation, and advance history revision. */
  deleteNote(noteId: string): Promise<void>;
}

/** Views are coherent, writes are atomic, and close drains accepted operations. */
export interface NotesStore {
  read<T>(run: (reader: NotesReader) => Promise<T>): Promise<T>;
  write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface NotesDependencies {
  readonly store: NotesStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
