import { FormaError } from '../errors.js';
import { withRequest } from '../requests/service.js';
import { calendarDate, invalid, objectInput, utcTimestamp } from '../validation.js';
import { noteHistory } from './history.js';
import { createNoteFieldsApi } from './fields.js';
import type { NotesDependencies } from './ports.js';
import { expectRevision, requiredNote } from './records.js';
import { noteDeleteResult, noteResult } from './results.js';
import type { NoteRecord, NotesModule, NotesApi } from './types.js';
import { NOTE_LIMITS, noteFromRecord, noteId, noteKind, noteRevision, noteText } from './validation.js';

/** Compose with the caller's store, lifetime, and restore exclusion. This function owns no close. */
export function createNotesApi({ store, clock, ids }: NotesDependencies, ensureOpen: () => void): NotesApi {
  return {
    ...createNoteFieldsApi(store, clock, ensureOpen),
    async create(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'date', 'text', 'kind']);
      const requestId = input.requestId;
      const date = calendarDate(input.date, 'date');
      const text = noteText(input.text);
      const kind = input.kind === undefined ? 'general' : noteKind(input.kind);
      return withRequest(store, requestId, 'notes.create', { date, text, kind }, noteResult, async (writer) => {
        const id = noteId(ids.next(), 'id');
        if (await writer.hasNoteId(id)) {
          throw new FormaError('CONFLICT', 'The generated note ID is already reserved.', { field: 'id' });
        }
        const timestamp = utcTimestamp(clock.nowUtc());
        const record: NoteRecord = { id, date, text, kind, revision: 1, createdAt: timestamp, updatedAt: timestamp };
        await writer.saveNote(record);
        return noteFromRecord(record);
      });
    },

    async get(value) {
      ensureOpen();
      const id = noteId(value);
      return store.read((reader) => requiredNote(reader, id));
    },

    async update(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'noteId', 'expectedRevision', 'date', 'text', 'kind']);
      const requestId = input.requestId;
      const id = noteId(input.noteId);
      const expectedRevision = noteRevision(input.expectedRevision);
      const date = input.date === undefined ? undefined : calendarDate(input.date, 'date');
      const text = input.text === undefined ? undefined : noteText(input.text);
      const kind = input.kind === undefined ? undefined : noteKind(input.kind);
      if ([date, text, kind].every((value) => value === undefined)) {
        invalid('input', 'A note update must contain at least one record field.');
      }
      return withRequest(store, requestId, 'notes.update', { noteId: id, expectedRevision, date, text, kind },
        noteResult, async (writer) => {
          const current = await requiredNote(writer, id);
          expectRevision(current, expectedRevision);
          if (current.revision === Number.MAX_SAFE_INTEGER) invalid('revision', 'The note revision is exhausted.');
          const record: NoteRecord = {
            id, date: date ?? current.date, text: text ?? current.text, kind: kind ?? current.kind,
            revision: current.revision + 1, createdAt: current.createdAt, updatedAt: utcTimestamp(clock.nowUtc()),
          };
          await writer.saveNote(record);
          await writer.clearNoteConfirmation(id);
          return noteFromRecord(record);
        });
    },

    async delete(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'noteId', 'expectedRevision']);
      const id = noteId(input.noteId);
      const expectedRevision = noteRevision(input.expectedRevision);
      return withRequest(store, input.requestId, 'notes.delete', { noteId: id, expectedRevision },
        noteDeleteResult, async (writer) => {
          expectRevision(await requiredNote(writer, id), expectedRevision);
          await writer.deleteNote(id);
          await writer.clearNoteConfirmation(id);
        });
    },

    async searchText(input) {
      ensureOpen();
      objectInput(input, ['query', 'dateFrom', 'dateTo', 'kind', 'limit', 'cursor']);
      const query = input.query;
      if (typeof query !== 'string' || !query.trim() || query.length > NOTE_LIMITS.maxSearchQueryCharacters || /[\u0000\uD800-\uDFFF]/u.test(query)) {
        invalid('query', 'The query must contain 1–512 characters of nonblank valid Unicode without NUL.');
      }
      const { query: _query, ...historyInput } = input;
      const page = await noteHistory(store, historyInput, query);
      return { ...page, filter: { ...page.filter, query } };
    },

    async history(input = {}) {
      ensureOpen();
      return noteHistory(store, input);
    },
  };
}

/** Standalone owner. Integrated services call createNotesApi instead. */
export function createNotesModule(dependencies: NotesDependencies): NotesModule {
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const ensureOpen = (): void => {
    if (closed) throw new FormaError('SERVICE_CLOSED', 'The notes module is closed.');
  };
  return {
    notes: createNotesApi(dependencies, ensureOpen),
    close() {
      if (!closePromise) {
        closed = true;
        closePromise = dependencies.store.close();
      }
      return closePromise;
    },
  };
}
