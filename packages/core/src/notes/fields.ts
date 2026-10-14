import { FormaError } from '../errors.js';
import type { Clock } from '../ports.js';
import { canonicalJson, withRequest } from '../requests/service.js';
import { invalid, objectInput, utcTimestamp } from '../validation.js';
import { noteFieldConfirmationResult, readReleasedNoteFields, validateNoteFields } from './field-validation.js';
import { suggestNoteFields } from './field-rules.js';
import type { NoteFieldConfirmation } from './field-types.js';
import type { NotesStore } from './ports.js';
import { expectRevision, requiredNote } from './records.js';
import type { NoteRecord, NotesApi } from './types.js';
import { noteId, noteRevision } from './validation.js';

export function createNoteFieldsApi(
  store: NotesStore, clock: Clock, ensureOpen: () => void,
): Pick<NotesApi, 'fields' | 'confirmFields'> {
  return {
    async fields(value) {
      ensureOpen();
      const id = noteId(value);
      return store.read(async (reader) => {
        const note = await requiredNote(reader, id);
        const stored = await reader.getNoteConfirmation(id);
        let confirmation: NoteFieldConfirmation | null = null;
        if (stored !== null) {
          try { confirmation = noteFieldConfirmationResult.parse(stored); }
          catch (cause) { throw new FormaError('STORAGE_FAILURE', 'The stored note confirmation is invalid.', { cause }); }
          if (confirmation.source.noteId !== id) throw new FormaError('STORAGE_FAILURE', 'The confirmation has a different note ID.');
          if (confirmation.source.revision !== note.revision) confirmation = null;
        }
        const suggestions = suggestNoteFields({ source: note.source, text: note.text });
        const groups = [suggestions.pain, suggestions.sleep, suggestions.personalBest];
        const state = confirmation !== null ? 'confirmed' : groups.some((group) => group.state === 'uncertain')
          ? 'uncertain' : groups.some((group) => group.state === 'pending') ? 'pending' : 'missing';
        return { source: note.source, state, confirmation, suggestions };
      });
    },

    async confirmFields(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'noteId', 'expectedRevision', 'fields']);
      const id = noteId(input.noteId);
      const expectedRevision = noteRevision(input.expectedRevision);
      // Released cross-alias inputs may replay only an existing exact receipt.
      const fields = readReleasedNoteFields(input.fields);
      let newInputFailure: unknown;
      try { validateNoteFields(input.fields); } catch (cause) { newInputFailure = cause; }
      const fieldsSignature = canonicalJson(fields);
      const resultCodec = {
        parse(value: unknown) {
          const result = noteFieldConfirmationResult.parse(value);
          if (result.source.noteId !== id || result.source.revision !== expectedRevision + 1
            || canonicalJson(result.fields) !== fieldsSignature) {
            invalid('result', 'The saved confirmation does not match this command.');
          }
          return result;
        },
      };
      return withRequest(store, input.requestId, 'notes.confirmFields', { noteId: id, expectedRevision, fields },
        resultCodec, async (writer) => {
          if (newInputFailure !== undefined) throw newInputFailure;
          const note = await requiredNote(writer, id);
          expectRevision(note, expectedRevision);
          if (note.revision === Number.MAX_SAFE_INTEGER) invalid('revision', 'The note revision is exhausted.');
          const confirmedAt = utcTimestamp(clock.nowUtc());
          const record: NoteRecord = {
            id, date: note.date, text: note.text, kind: note.kind, createdAt: note.createdAt,
            revision: note.revision + 1, updatedAt: confirmedAt,
          };
          const result: NoteFieldConfirmation = {
            formatVersion: 1, source: { module: 'notes', noteId: id, revision: record.revision }, confirmedAt, fields,
          };
          await writer.saveNote(record);
          await writer.saveNoteConfirmation(result);
          return result;
        });
    },
  };
}
