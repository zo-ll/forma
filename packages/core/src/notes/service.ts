import { FormaError } from '../errors.js';
import { withRequest } from '../requests/service.js';
import { calendarDate, invalid, objectInput, utcTimestamp } from '../validation.js';
import { noteHistory } from './history.js';
import { createNoteFieldsApi } from './fields.js';
import type { NotesDependencies } from './ports.js';
import { expectRevision, requiredNote } from './records.js';
import { noteDeleteResult, noteResult } from './results.js';
import type { NoteRecord, NotesModule } from './types.js';
import { noteFromRecord, noteId, noteKind, noteRevision, noteText } from './validation.js';

/** Core-only composition. Integrated hosts must supply a shared lifetime and archive owner later. */
export function createNotesModule({ store, clock, ids }: NotesDependencies): NotesModule {
  let closed = false;
  let closePromise: Promise<void> | undefined;
  function ensureOpen(): void {
    if (closed) throw new FormaError('SERVICE_CLOSED', 'The notes module is closed.');
  }
  return {
    notes: {
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

      async history(input = {}) {
        ensureOpen();
        return noteHistory(store, input);
      },
    },

    close() {
      if (!closePromise) {
        closed = true;
        closePromise = store.close();
      }
      return closePromise;
    },
  };
}
