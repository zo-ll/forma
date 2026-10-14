import type { ResultCodec } from '../requests/service.js';
import { invalid, objectInput } from '../validation.js';
import type { Note } from './types.js';
import { noteFromRecord } from './validation.js';

export const noteResult: ResultCodec<Note> = {
  parse(value) {
    objectInput(value, ['id', 'date', 'text', 'kind', 'revision', 'createdAt', 'updatedAt', 'source']);
    const row = value as Note;
    const { source, ...record } = row;
    const note = noteFromRecord(record);
    objectInput(source, ['module', 'noteId', 'revision']);
    if (source.module !== 'notes' || source.noteId !== note.id || source.revision !== note.revision) {
      invalid('source', 'The saved source must identify this exact note revision.');
    }
    return note;
  },
};

export const noteDeleteResult: ResultCodec<void> = {
  parse(value) {
    if (value !== null) invalid('result', 'The saved deletion result must be null.');
  },
};
