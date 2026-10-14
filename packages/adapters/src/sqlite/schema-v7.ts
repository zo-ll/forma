/** An actual FTS5 table is the capability probe. Missing FTS5 fails the migration atomically. */
export const SCHEMA_V7: readonly string[] = Object.freeze([
  `CREATE VIRTUAL TABLE notes_fts USING fts5(text, content='notes', content_rowid='rowid', tokenize='unicode61 remove_diacritics 0')`,
  `CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, text) VALUES (new.rowid, new.text); END`,
  `CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, text) VALUES ('delete', old.rowid, old.text); END`,
  `CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO notes_fts(rowid, text) VALUES (new.rowid, new.text); END`,
  "INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')",
]);
