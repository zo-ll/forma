import { FormaError, noteFieldConfirmationResult, noteFromRecord, validateNoteFields } from '@forma/core';
import type { NoteRecord, NotesStoreQuery, NotesSearchQuery, NotesWriter, RequestWriter } from '@forma/core';
import type { SqliteConnection, SqliteRow } from './connection.js';
import type { MigrationValue } from './migrations.js';

export function noteRecordFromRow(row: SqliteRow): NoteRecord {
  try {
    const { source: _source, ...record } = noteFromRecord({
      id: row.id, date: row.date, text: row.text, kind: row.kind, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
    return record;
  } catch (cause) { throw new FormaError('STORAGE_FAILURE', 'The stored note is invalid.', { cause }); }
}

/** The caller owns the transaction, queue, lifetime, and error translation. */
export function createSqliteNotesView(
  db: SqliteConnection, check: () => void, writable: boolean,
): Omit<NotesWriter, keyof RequestWriter> {
  function write(): void {
    check();
    if (!writable) throw new FormaError('STORAGE_FAILURE', 'The notes view is read-only.');
  }
  function getNote(id: string): NoteRecord | null {
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    return row ? noteRecordFromRow(row) : null;
  }
  function page(input: NotesStoreQuery, search?: NotesSearchQuery) {
    const conditions: string[] = [];
    const values: MigrationValue[] = [];
    const { filter, after } = input;
    if (search !== undefined) {
      // The complete query is one literal phrase. Never pass command text through as MATCH syntax.
      conditions.push('n.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)');
      values.push('"' + search.query.replace(/"/g, '""') + '"');
      if (search.noteId !== undefined) { conditions.push('n.id = ?'); values.push(search.noteId); }
    }
    if (filter.dateFrom !== null) { conditions.push('n.date >= ?'); values.push(filter.dateFrom); }
    if (filter.dateTo !== null) { conditions.push('n.date <= ?'); values.push(filter.dateTo); }
    if (filter.kind !== null) { conditions.push('n.kind = ?'); values.push(filter.kind); }
    if (after !== null) {
      conditions.push('(n.date < ? OR (n.date = ? AND n.created_at < ?) OR (n.date = ? AND n.created_at = ? AND n.id > ?))');
      values.push(after.date, after.date, after.createdAt, after.date, after.createdAt, after.id);
    }
    values.push(input.limit + 1);
    const rows = db.prepare('SELECT n.* FROM notes n' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '')
      + ' ORDER BY n.date DESC, n.created_at DESC, n.id ASC LIMIT ?').all(...values);
    return { items: rows.slice(0, input.limit).map(noteRecordFromRow), hasMore: rows.length > input.limit };
  }
  return {
    getNote: async (id) => { check(); return getNote(id); },
    hasNoteId: async (id) => { check(); return db.prepare('SELECT id FROM note_ids WHERE id = ?').get(id) !== undefined; },
    getNotesHistoryRevision: async () => {
      check();
      const revision = db.prepare('SELECT revision FROM notes_history_state WHERE id = 1').get()?.revision;
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
        throw new FormaError('STORAGE_FAILURE', 'The notes revision is invalid.');
      }
      return revision;
    },
    listNotes: async (input) => { check(); return page(input); },
    searchNotes: async (input) => { check(); return page(input, input); },
    getNoteConfirmation: async (id) => {
      check();
      const row = db.prepare('SELECT confirmation_json FROM note_confirmations WHERE note_id = ?').get(id);
      if (row === undefined) return null;
      try {
        if (typeof row.confirmation_json !== 'string') throw new Error('Expected confirmation text.');
        const confirmation = noteFieldConfirmationResult.parse(JSON.parse(row.confirmation_json));
        if (confirmation.source.noteId !== id) throw new Error('Wrong confirmation identity.');
        return confirmation;
      } catch (cause) { throw new FormaError('STORAGE_FAILURE', 'The stored confirmation is invalid.', { cause }); }
    },
    saveNote: async (value) => {
      write();
      const { source: _source, ...note } = noteFromRecord(value);
      const current = getNote(note.id);
      if (current === null) {
        if (db.prepare('SELECT id FROM note_ids WHERE id = ?').get(note.id)) {
          throw new FormaError('CONFLICT', 'The note ID is reserved.', { field: 'id' });
        }
        if (note.revision !== 1) throw new FormaError('CONFLICT', 'A new note starts at revision 1.');
        db.prepare('INSERT INTO note_ids (id) VALUES (?)').run(note.id);
      } else if (current.createdAt !== note.createdAt || note.revision !== current.revision + 1) {
        throw new FormaError('CONFLICT', 'The note source is obsolete.', { field: 'expectedRevision' });
      }
      db.prepare('INSERT INTO notes (id, date, text, kind, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
        + 'ON CONFLICT(id) DO UPDATE SET date=excluded.date, text=excluded.text, kind=excluded.kind, '
        + 'revision=excluded.revision, updated_at=excluded.updated_at')
        .run(note.id, note.date, note.text, note.kind, note.revision, note.createdAt, note.updatedAt);
    },
    saveNoteConfirmation: async (value) => {
      write();
      const confirmation = noteFieldConfirmationResult.parse(value);
      validateNoteFields(confirmation.fields);
      if (getNote(confirmation.source.noteId)?.revision !== confirmation.source.revision) {
        throw new FormaError('CONFLICT', 'The confirmation source is obsolete.', { field: 'expectedRevision' });
      }
      db.prepare('INSERT INTO note_confirmations (note_id, confirmation_json) VALUES (?, ?) '
        + 'ON CONFLICT(note_id) DO UPDATE SET confirmation_json=excluded.confirmation_json')
        .run(confirmation.source.noteId, JSON.stringify(confirmation));
    },
    clearNoteConfirmation: async (id) => { write(); db.prepare('DELETE FROM note_confirmations WHERE note_id = ?').run(id); },
    deleteNote: async (id) => { write(); db.prepare('DELETE FROM notes WHERE id = ?').run(id); },
  };
}
