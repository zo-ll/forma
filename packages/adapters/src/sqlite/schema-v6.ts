/** Primary note identities and confirmations. All statements run in one migration transaction. */
export const SCHEMA_V6: readonly string[] = Object.freeze([
  `CREATE TABLE note_ids (id TEXT PRIMARY KEY NOT NULL) STRICT`,
  `CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL REFERENCES note_ids(id),
    date TEXT NOT NULL, text TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('general', 'pain', 'sleep', 'personal-best')),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE note_confirmations (
    note_id TEXT PRIMARY KEY NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    confirmation_json TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE notes_history_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991)
  ) STRICT`,
  'INSERT INTO notes_history_state (id, revision) VALUES (1, 0)',
  ...['INSERT', 'UPDATE', 'DELETE'].map((operation) =>
    `CREATE TRIGGER notes_history_${operation.toLowerCase()} AFTER ${operation} ON notes
      BEGIN UPDATE notes_history_state SET revision = revision + 1 WHERE id = 1; END`),
  `CREATE TRIGGER notes_clear_confirmation AFTER UPDATE ON notes
    BEGIN DELETE FROM note_confirmations WHERE note_id = old.id; END`,
  'CREATE INDEX notes_history ON notes(date DESC, created_at DESC, id)',
]);
